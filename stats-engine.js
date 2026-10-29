/*
 * Annotation contribution counting and effective-time measurement.
 * This module has no network, storage, or UI side effects.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AnnotationStatsEngine = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const COUNT_KEYS = Object.freeze([
    'genders_marked', 'genders_corrected', 'dialogues_identified',
    'dialogues_corrected', 'not_dialogue'
  ]);
  const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

  function normalizeGender(value) {
    const gender = String(value == null ? '' : value).trim().toLowerCase();
    if (!gender || gender === 'unknown' || gender === '#unknown') return 'unknown';
    return gender === 'non-binary' ? 'gender-ambiguous' : gender;
  }

  function normalizeSpeaker(value) {
    const speaker = String(value == null ? '' : value).trim();
    return !speaker || /^#?unknown$/i.test(speaker) ? '#unknown' : speaker;
  }

  function normalizeDialogue(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.status === 'not_dialogue') return { status: 'not_dialogue' };
    if (value.status !== 'dialogue') return null;
    return { status: 'dialogue', speaker: normalizeSpeaker(value.speaker) };
  }

  /**
   * Compare the final item states against the previous export's baseline.
   * Each item receives at most one category in this batch. Deliberately setting
   * a known value back to unknown is a correction; deleting an item is not.
   * Exclusions need an explicit not_dialogue state, never an inferred deletion.
   * Neither input is modified. `changes` contains normalized, independent values.
   */
  function diffSnapshots(before, after) {
    const previous = before || {};
    const current = after || {};
    const previousGenders = previous.genders || {};
    const currentGenders = current.genders || {};
    const previousDialogues = previous.dialogues || {};
    const currentDialogues = current.dialogues || {};
    const counts = Object.fromEntries(COUNT_KEYS.map(key => [key, 0]));
    const changes = [];

    function add(kind, itemId, oldValue, newValue) {
      counts[kind] += 1;
      changes.push({ kind, item_id: itemId, before: oldValue, after: newValue });
    }

    Object.keys(currentGenders).forEach(itemId => {
      const existed = hasOwn(previousGenders, itemId);
      const oldGender = normalizeGender(existed ? previousGenders[itemId] : null);
      const newGender = normalizeGender(currentGenders[itemId]);
      if (oldGender === newGender) return;
      if (oldGender === 'unknown' && newGender !== 'unknown') {
        add('genders_marked', itemId, existed ? oldGender : null, newGender);
      } else if (oldGender !== 'unknown') {
        add('genders_corrected', itemId, oldGender, newGender);
      }
    });

    Object.keys(currentDialogues).forEach(itemId => {
      const oldState = hasOwn(previousDialogues, itemId)
        ? normalizeDialogue(previousDialogues[itemId]) : null;
      const newState = normalizeDialogue(currentDialogues[itemId]);
      if (!newState) return;

      // A final exclusion replaces any speaker assignment in this batch.
      if (newState.status === 'not_dialogue') {
        if (!oldState || oldState.status !== 'not_dialogue') {
          add('not_dialogue', itemId, oldState, newState);
        }
        return;
      }

      // Reserved for a future review workflow that restores an exclusion.
      if (oldState && oldState.status === 'not_dialogue') {
        add('dialogues_corrected', itemId, oldState, newState);
        return;
      }

      const oldSpeaker = oldState ? oldState.speaker : '#unknown';
      if (oldSpeaker === newState.speaker) return;
      if (oldSpeaker === '#unknown' && newState.speaker !== '#unknown') {
        add('dialogues_identified', itemId, oldState, newState);
      } else if (oldSpeaker !== '#unknown') {
        add('dialogues_corrected', itemId, oldState, newState);
      }
    });

    return {
      counts,
      changes,
      points: COUNT_KEYS.reduce((sum, key) => sum + counts[key], 0)
    };
  }

  function localName(node) {
    return node.localName || String(node.nodeName || '').split(':').pop();
  }

  function itemId(node) {
    return (typeof node.getAttributeNS === 'function' && node.getAttributeNS(XML_NAMESPACE, 'id')) ||
      node.getAttribute('xml:id') || node.getAttribute('id') || '';
  }

  function exclusionKeys(excludedIds) {
    if (!excludedIds) return [];
    if (typeof excludedIds === 'string') return [excludedIds];
    if (typeof Map !== 'undefined' && excludedIds instanceof Map) return Array.from(excludedIds.keys());
    if (typeof excludedIds[Symbol.iterator] === 'function') return Array.from(excludedIds);
    return Object.keys(excludedIds).filter(key => excludedIds[key]);
  }

  /**
   * Snapshot an XML Document (or Element) after stable IDs have been assigned.
   * Namespace prefixes are ignored when identifying person/sex/q/quotation.
   * excludedIds may be a Set/array of IDs, a Map, or an own-key metadata object.
   * Explicit exclusion records win over a quotation with the same ID.
   * Missing IDs are skipped: the editor must persist IDs before its baseline.
   */
  function snapshotXml(xmlDoc, excludedIds) {
    const snapshot = {
      genders: Object.create(null),
      dialogues: Object.create(null)
    };
    if (!xmlDoc || typeof xmlDoc.getElementsByTagName !== 'function') return snapshot;
    const nodes = Array.from(xmlDoc.getElementsByTagName('*'));
    if (xmlDoc.nodeType === 1) nodes.unshift(xmlDoc);

    nodes.forEach(node => {
      const tag = localName(node);
      if (tag !== 'person' && tag !== 'q' && tag !== 'quotation') return;
      const id = itemId(node);
      if (!id) return;
      if (tag === 'person') {
        const sex = Array.from(node.children || node.childNodes || []).find(child =>
          child.nodeType === 1 && localName(child) === 'sex');
        snapshot.genders[id] = normalizeGender(sex
          ? (sex.getAttribute('value') || sex.textContent) : null);
      } else {
        snapshot.dialogues[id] = {
          status: 'dialogue',
          speaker: normalizeSpeaker(node.getAttribute('who'))
        };
      }
    });

    exclusionKeys(excludedIds).forEach(value => {
      const id = String(value == null ? '' : value);
      if (id) snapshot.dialogues[id] = { status: 'not_dialogue' };
    });
    return snapshot;
  }

  /**
   * Foreground effective-work clock. The UI must pause it for hidden/unfocused
   * pages, dialogs and export waiting, and call activity() for reading actions.
   *
   * Default elapsed time uses performance.now(), independent of wall-clock
   * adjustments. Supplying `now` replaces both clocks for deterministic tests;
   * `monotonicNow` can override the elapsed-time clock separately.
   *
   * sample(): {activeMs, activeSeconds, startedAt, endedAt}; ISO UTC dates.
   * reset(): clear elapsed time and restart the interval, retaining pause reasons.
   * restore({activeMs, startedAt}): retain saved work, never count the closed gap.
   * start()/stop() preserve totals. No interval or event listener is installed.
   */
  class ActiveTimer {
    constructor(options = {}) {
      const idleMs = options.idleMs === undefined ? 600000 : Number(options.idleMs);
      if (!Number.isFinite(idleMs) || idleMs <= 0) throw new TypeError('idleMs must be positive.');
      if (options.now !== undefined && typeof options.now !== 'function') {
        throw new TypeError('now must be a function.');
      }
      this.idleMs = idleMs;
      this._wallNow = options.now || Date.now;
      this._clockNow = options.monotonicNow || options.now ||
        (typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now.bind(performance) : Date.now);
      if (typeof this._clockNow !== 'function') throw new TypeError('monotonicNow must be a function.');
      this._activeMs = 0;
      this._startedAt = null;
      this._running = false;
      this._pauses = new Set();
      this._lastTick = this._readClock();
      this._lastActivity = this._lastTick;
    }

    _readClock() {
      const value = Number(this._clockNow());
      return Number.isFinite(value) ? value : (this._lastTick || 0);
    }

    _wallTime() {
      const value = Number(this._wallNow());
      return Number.isFinite(value) && Math.abs(value) <= 8640000000000000 ? value : Date.now();
    }

    _checkpoint(now = this._readClock()) {
      if (now < this._lastTick) {
        // A fallback clock moved backwards. Start a fresh anchor without
        // subtracting earned work or crediting the discontinuity.
        this._lastActivity = Math.min(this._lastActivity, now);
      } else if (this._running && this._pauses.size === 0) {
        const eligibleEnd = Math.min(now, this._lastActivity + this.idleMs);
        this._activeMs += Math.max(0, eligibleEnd - this._lastTick);
      }
      this._lastTick = now;
      return now;
    }

    start() {
      const now = this._checkpoint();
      if (!this._running) {
        this._running = true;
        if (this._startedAt === null) this._startedAt = this._wallTime();
        this._lastActivity = now;
      }
      return this;
    }

    stop() {
      this._checkpoint();
      this._running = false;
      return this;
    }

    activity() {
      const now = this._checkpoint();
      if (this._running && this._pauses.size === 0) this._lastActivity = now;
      return this;
    }

    pause(reason = 'manual') {
      this._checkpoint();
      this._pauses.add(reason);
      return this;
    }

    resume(reason = 'manual') {
      const now = this._checkpoint();
      const removed = this._pauses.delete(reason);
      if (removed && this._pauses.size === 0) this._lastActivity = now;
      return this;
    }

    sample() {
      this._checkpoint();
      const endedAt = this._wallTime();
      // If the system clock moved backwards, keep a valid enclosing wall-time
      // interval without changing elapsed work or inventing a future end time.
      if (this._startedAt !== null) {
        this._startedAt = Math.min(this._startedAt, endedAt - this._activeMs);
      }
      return {
        activeMs: this._activeMs,
        activeSeconds: Math.floor(this._activeMs / 1000),
        startedAt: this._startedAt === null ? null : new Date(this._startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString()
      };
    }

    reset() {
      const now = this._readClock();
      this._activeMs = 0;
      this._startedAt = this._running ? this._wallTime() : null;
      this._lastTick = now;
      this._lastActivity = now;
      return this;
    }

    restore(saved = {}) {
      const activeMs = saved.activeMs === undefined ? 0 : Number(saved.activeMs);
      const startedAt = saved.startedAt == null ? this._wallTime() : Date.parse(saved.startedAt);
      if (!Number.isFinite(activeMs) || activeMs < 0 || activeMs > Number.MAX_SAFE_INTEGER ||
          !Number.isFinite(startedAt)) {
        throw new TypeError('Saved timer state is invalid.');
      }
      const now = this._readClock();
      this._activeMs = activeMs;
      this._startedAt = Math.min(startedAt, this._wallTime() - activeMs);
      this._lastTick = now;
      this._lastActivity = now;
      return this;
    }

    get running() { return this._running; }
    get paused() { return this._pauses.size > 0; }
  }

  return Object.freeze({ COUNT_KEYS, diffSnapshots, snapshotXml, ActiveTimer });
});
