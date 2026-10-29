/*
 * Durable, idempotent reporting for the Google Apps Script statistics receiver.
 * A no-cors POST is only a dispatch attempt. Only the matching read-only receipt
 * can mark a report sent. Original JSON bytes and their UUID are never rebuilt.
 */
(function (global) {
  'use strict';

  const PREFIX = 'fiction-annotation.report.v1.';
  const COUNTS = ['genders_marked', 'genders_corrected', 'dialogues_identified', 'dialogues_corrected', 'not_dialogue'];
  const PAYLOAD_FIELDS = ['schema_version', 'submission_id', 'session_id', 'editor_id', 'editor_name',
    'document_id', 'file_name', 'started_at', 'ended_at', 'active_seconds'].concat(COUNTS);
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  let callbackCounter = 0;

  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function failure(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
  function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function text(value, max) {
    return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max &&
      !/[\u0000-\u001f\u007f]/.test(value.trim());
  }
  function integer(value, max) { return Number.isSafeInteger(value) && value >= 0 && value <= max; }
  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === (value.length === 20 ? value.replace('Z', '.000Z') : value);
  }
  function dateOnly(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function utf8(value) {
    if (typeof global.TextEncoder === 'function') return new global.TextEncoder().encode(value);
    const bytes = [];
    for (let i = 0; i < value.length; i++) {
      let n = value.charCodeAt(i);
      if (n >= 0xd800 && n <= 0xdbff) {
        const next = value.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { n = ((n - 0xd800) << 10) + next - 0xdc00 + 0x10000; i++; }
        else n = 0xfffd;
      } else if (n >= 0xdc00 && n <= 0xdfff) n = 0xfffd;
      if (n < 0x80) bytes.push(n);
      else if (n < 0x800) bytes.push(0xc0 | (n >>> 6), 0x80 | (n & 63));
      else if (n < 0x10000) bytes.push(0xe0 | (n >>> 12), 0x80 | ((n >>> 6) & 63), 0x80 | (n & 63));
      else bytes.push(0xf0 | (n >>> 18), 0x80 | ((n >>> 12) & 63), 0x80 | ((n >>> 6) & 63), 0x80 | (n & 63));
    }
    return new Uint8Array(bytes);
  }

  // SHA-256 fallback for browsers that do not expose SubtleCrypto on file://.
  // It hashes exactly the same UTF-8 bytes as the Apps Script receiver.
  function sha256Fallback(bytes) {
    const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const state = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    padded.set(bytes); padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    const bitLength = bytes.length * 8;
    view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(padded.length - 4, bitLength >>> 0, false);
    const w = new Uint32Array(64);
    const rotr = (v, n) => (v >>> n) | (v << (32 - n));
    for (let block = 0; block < padded.length; block += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a,b,c,d,e,f,g,h] = state;
      for (let i = 0; i < 64; i++) {
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + s1 + ch + k[i] + w[i]) >>> 0;
        const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (s0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a,b,c,d,e,f,g,h].forEach((n, i) => { state[i] = (state[i] + n) >>> 0; });
    }
    return state.map(n => n.toString(16).padStart(8, '0')).join('');
  }

  async function sha256(value) {
    const bytes = utf8(String(value));
    if (global.crypto && global.crypto.subtle) {
      try {
        const result = await global.crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('');
      } catch (_) { /* Fall through to the local implementation. */ }
    }
    return sha256Fallback(bytes);
  }

  function validatePayload(payload, raw) {
    const invalid = message => { throw failure('INVALID_REPORT', message); };
    if (!plainObject(payload) || Object.keys(payload).some(key => !PAYLOAD_FIELDS.includes(key))) invalid('The report contains an unsupported field.');
    if (payload.schema_version !== undefined && payload.schema_version !== 1) invalid('The report schema is not supported.');
    if (!UUID.test(payload.submission_id || '')) invalid('The report needs a valid submission ID.');
    ['session_id', 'editor_id', 'document_id'].forEach(key => {
      if (typeof payload[key] !== 'string' || !IDENTIFIER.test(payload[key])) invalid('The report has an invalid ' + key + '.');
    });
    if (!text(payload.editor_name, 100) || !text(payload.file_name, 255)) invalid('The report needs a valid editor name and file name.');
    if (!timestamp(payload.started_at) || !timestamp(payload.ended_at)) invalid('The report has an invalid work date.');
    const span = (Date.parse(payload.ended_at) - Date.parse(payload.started_at)) / 1000;
    if (span < 0 || span > 2678400) invalid('This work interval is too long to submit as one report.');
    if (!integer(payload.active_seconds, 604800) || payload.active_seconds > Math.ceil(span) + 5) invalid('The recorded active time is outside the supported range.');
    COUNTS.forEach(key => { if (!integer(payload[key], 100000)) invalid('The report has an invalid ' + key + ' count.'); });
    if (utf8(raw).length > 16384) invalid('The report is too large to submit.');
  }

  function validateBoard(body) {
    if (!plainObject(body) || body.ok !== true || !Array.isArray(body.entries) || body.entries.length > 10000) {
      throw failure('INVALID_RESPONSE', 'The leaderboard service returned an unexpected response.');
    }
    if (body.week_start === null && body.week_end === null && !body.entries.length) {
      return { ok: true, week_start: null, week_end: null, entries: [] };
    }
    if (!dateOnly(body.week_start) || !dateOnly(body.week_end)) throw failure('INVALID_RESPONSE', 'The leaderboard has invalid week dates.');
    const start = new Date(body.week_start + 'T00:00:00Z');
    if (start.getUTCDay() !== 1 || Date.parse(body.week_end + 'T00:00:00Z') - start.getTime() !== 6 * 86400000) {
      throw failure('INVALID_RESPONSE', 'The leaderboard has an invalid work week.');
    }
    const entries = body.entries.map((row, i) => {
      if (!plainObject(row) || !text(row.editor_name, 100) || !text(row.file_name, 2000)) throw failure('INVALID_RESPONSE', 'A leaderboard entry is incomplete.');
      const entry = { editor_name: row.editor_name, file_name: row.file_name };
      COUNTS.forEach(key => {
        if (!integer(row[key], Math.floor(Number.MAX_SAFE_INTEGER / 10))) throw failure('INVALID_RESPONSE', 'A leaderboard count is invalid.');
        entry[key] = row[key];
      });
      entry.points = COUNTS.reduce((total, key) => total + entry[key], 0);
      if (!Number.isSafeInteger(entry.points) || row.points !== entry.points || !integer(row.rank, body.entries.length) || row.rank < 1) {
        throw failure('INVALID_RESPONSE', 'A leaderboard score is invalid.');
      }
      if (i > 0 && row.points > body.entries[i - 1].points) throw failure('INVALID_RESPONSE', 'The leaderboard order is invalid.');
      const expectedRank = i > 0 && row.points === body.entries[i - 1].points ? body.entries[i - 1].rank : i + 1;
      if (row.rank !== expectedRank) throw failure('INVALID_RESPONSE', 'The leaderboard ranking is invalid.');
      entry.rank = row.rank;
      return entry;
    });
    return { ok: true, week_start: body.week_start, week_end: body.week_end, entries };
  }

  class AnnotationStatsService {
    constructor(options) {
      options = options || {};
      let url;
      try { url = new URL(options.endpoint); } catch (_) { throw failure('INVALID_ENDPOINT', 'Configure the deployed statistics Web app URL.'); }
      if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' ||
          !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.username || url.password) {
        throw failure('INVALID_ENDPOINT', 'Use the deployed Google Apps Script URL ending in /exec.');
      }
      url.search = ''; url.hash = '';
      this.endpoint = url.toString();
      this.storage = null;
      try { this.storage = options.storage === undefined ? global.localStorage : options.storage; } catch (_) { /* Browser denied storage. */ }
      this.storageAvailable = false;
      this.storageWarning = '';
      this.corruptionDetected = false;
      this._records = new Map();
      this._flights = new Map();
      this._subscribers = new Set();
      this._onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
      this._readyPromise = null;
      this._storageListener = event => {
        if (event.storageArea && event.storageArea !== this.storage) return;
        if (event.key === null) {
          this.storageWarning = 'Browser storage was cleared. Keep this page open until any pending reports are sent.';
          this._emit(); return;
        }
        if (!event.key || !event.key.startsWith(PREFIX)) return;
        if (event.newValue === null) {
          const id = event.key.slice(PREFIX.length);
          const record = this._records.get(id);
          if (record && record.status === 'sent') this._records.delete(id);
          else if (record) this.storageWarning = 'A pending report was removed from browser storage. Keep this page open and send it before leaving.';
          this._emit(); return;
        }
        this._hydrate(event.key, event.newValue).then(() => this._emit());
      };
      if (global.addEventListener) global.addEventListener('storage', this._storageListener);
    }

    ready() {
      if (!this._readyPromise) this._readyPromise = this._load();
      return this._readyPromise;
    }

    async _load() {
      if (!this.storage) {
        this._storageFailed(); this._emit(); return this;
      }
      try {
        const keys = [];
        for (let i = 0; i < this.storage.length; i++) {
          const key = this.storage.key(i);
          if (key && key.startsWith(PREFIX)) keys.push(key);
        }
        for (const key of keys) await this._hydrate(key, this.storage.getItem(key));
        // Read existing reports even if a full quota prevents new writes.
        const probe = 'fiction-annotation.storage-probe.' + Date.now() + '-' + Math.random().toString(36).slice(2);
        this.storage.setItem(probe, 'ok');
        if (this.storage.getItem(probe) !== 'ok') throw new Error('Storage did not retain the test value.');
        this.storage.removeItem(probe);
        this.storageAvailable = true;
      } catch (_) { this._storageFailed(); }
      this._emit();
      return this;
    }

    _storageFailed() {
      this.storageAvailable = false;
      this.storageWarning = 'This browser cannot save reports reliably. Allow site storage or use a regular browser window before creating a report.';
    }

    async _hydrate(key, raw) {
      if (raw === null) return false;
      try {
        const record = JSON.parse(raw);
        if (!plainObject(record) || record.version !== 1 || typeof record.body !== 'string' ||
            typeof record.hash !== 'string' || !/^[a-f0-9]{64}$/.test(record.hash) ||
            !['pending', 'sent', 'conflict'].includes(record.status) || !UUID.test(record.id || '') ||
            key !== PREFIX + record.id || !timestamp(record.created_at) || !timestamp(record.updated_at) ||
            !integer(record.attempts, Number.MAX_SAFE_INTEGER)) throw new Error('Invalid saved report.');
        const payload = JSON.parse(record.body);
        validatePayload(payload, record.body);
        if (payload.submission_id.toLowerCase() !== record.id || await sha256(record.body) !== record.hash) throw new Error('The saved report checksum does not match.');
        record.payload = payload;
        record.last_error = typeof record.last_error === 'string' ? record.last_error.slice(0, 1000) : '';
        record.sent_at = timestamp(record.sent_at) ? record.sent_at : null;
        const previous = this._records.get(record.id);
        if (!previous || previous.status !== 'sent' || record.status === 'sent') this._records.set(record.id, record);
        return true;
      } catch (_) {
        // Never overwrite a damaged or unfamiliar record: it may contain work.
        this.corruptionDetected = true;
        this.storageWarning = 'Some saved reports could not be read. They have been preserved in browser storage; ask the project administrator for help.';
        return false;
      }
    }

    _emit() {
      const reports = this.getReports();
      [this._onChange, ...this._subscribers].forEach(fn => { try { fn(reports, this); } catch (_) { /* UI listeners cannot interrupt durable writes. */ } });
    }

    subscribe(fn) {
      if (typeof fn !== 'function') throw new TypeError('A listener function is required.');
      this._subscribers.add(fn);
      return () => this._subscribers.delete(fn);
    }

    getReports() {
      return Array.from(this._records.values()).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).map(copy);
    }

    getReport(id) {
      const record = this._records.get(String(id).toLowerCase());
      return record ? copy(record) : null;
    }

    pendingCount() { return Array.from(this._records.values()).filter(record => record.status !== 'sent').length; }
    isSending(id) { return this._flights.has(String(id).toLowerCase()); }

    async enqueue(payload) {
      await this.ready();
      if (!this.storageAvailable) throw failure('STORAGE_UNAVAILABLE', this.storageWarning);
      let body, frozenPayload;
      try { body = JSON.stringify(payload); frozenPayload = JSON.parse(body); }
      catch (_) { throw failure('INVALID_REPORT', 'The report could not be encoded.'); }
      validatePayload(frozenPayload, body);
      const id = frozenPayload.submission_id.toLowerCase();
      const hash = await sha256(body);
      const key = PREFIX + id;
      let existingRaw;
      try { existingRaw = this.storage.getItem(key); } catch (_) { this._storageFailed(); throw failure('STORAGE_UNAVAILABLE', this.storageWarning); }
      if (existingRaw !== null) {
        const valid = await this._hydrate(key, existingRaw);
        const existing = this._records.get(id);
        if (!valid || !existing || existing.body !== body || existing.hash !== hash) throw failure('LOCAL_CONFLICT', 'This report ID is already saved with different data. The existing report has been preserved.');
        return copy(existing);
      }
      const now = new Date().toISOString();
      const record = { version: 1, id, payload: frozenPayload, body, hash, status: 'pending',
        created_at: now, updated_at: now, attempts: 0, last_error: '', sent_at: null };
      // Persist before exposing the report or allowing a caller to advance its baseline.
      try {
        this.storage.setItem(key, JSON.stringify(record));
        if (this.storage.getItem(key) !== JSON.stringify(record)) throw new Error('Storage verification failed.');
      } catch (_) { this._storageFailed(); this._emit(); throw failure('STORAGE_UNAVAILABLE', this.storageWarning); }
      this._records.set(id, record);
      this._emit();
      return copy(record);
    }

    _update(id, changes) {
      let record = this._records.get(id);
      if (!record) return null;
      let preserveDisk = false;
      try {
        const raw = this.storage && this.storage.getItem(PREFIX + id);
        if (raw) {
          let newest;
          try { newest = JSON.parse(raw); } catch (_) { newest = null; }
          if (!plainObject(newest) || newest.body !== record.body || newest.hash !== record.hash) {
            preserveDisk = true;
            this.corruptionDetected = true;
            this.storageWarning = 'A saved report changed unexpectedly. It has been preserved; ask the project administrator for help.';
            changes = { status: 'conflict', last_error: this.storageWarning };
          } else if (newest.status === 'sent') {
            record = Object.assign({}, record, { status: 'sent', sent_at: newest.sent_at, last_error: '',
              attempts: Math.max(record.attempts, Number(newest.attempts) || 0) });
          }
        }
      } catch (_) { this._storageFailed(); }
      if (record.status === 'sent' && changes.status !== 'sent') changes = { attempts: Math.max(record.attempts, changes.attempts || 0) };
      const updated = Object.assign({}, record, changes, { updated_at: new Date().toISOString() });
      this._records.set(id, updated);
      try {
        if (!this.storage) throw new Error('Storage is not available.');
        if (!preserveDisk) this.storage.setItem(PREFIX + id, JSON.stringify(updated));
      } catch (_) { this._storageFailed(); }
      if (updated.status === 'sent') this._pruneSent();
      this._emit();
      return copy(updated);
    }

    _pruneSent() {
      const old = this.getReports().filter(record => record.status === 'sent').slice(100);
      for (const record of old) {
        try {
          const current = JSON.parse(this.storage.getItem(PREFIX + record.id));
          if (current && current.status === 'sent' && current.hash === record.hash && current.body === record.body) {
            this.storage.removeItem(PREFIX + record.id);
            this._records.delete(record.id);
          }
        } catch (_) { /* Cleanup failure never risks unsent work. */ }
      }
    }

    async send(submissionId) {
      await this.ready();
      const id = String(submissionId).toLowerCase();
      if (this._flights.has(id)) return this._flights.get(id);
      const record = this._records.get(id);
      if (!record) throw failure('MISSING_REPORT', 'This saved report could not be found.');
      if (record.status === 'sent' || record.status === 'conflict') return copy(record);
      const flight = this._send(id).finally(() => { this._flights.delete(id); this._emit(); });
      this._flights.set(id, flight);
      this._emit();
      return flight;
    }

    async _send(id) {
      let record = this._records.get(id);
      if (global.navigator && global.navigator.onLine === false) {
        return this._update(id, { last_error: 'You are offline. This report is saved on this device; retry when connected.' });
      }
      const previousAttempts = record.attempts;
      record = this._update(id, { attempts: record.attempts + 1, last_error: '' });
      if (record.status === 'sent' || record.status === 'conflict') return record;
      const deadline = Date.now() + 22000;
      const remaining = cap => Math.max(1, Math.min(cap, deadline - Date.now()));
      const finishReceipt = response => {
        if (response.conflict) return this._update(id, { status: 'conflict', last_error: 'This report ID already belongs to different data. The saved report was kept; ask the project administrator to review it.' });
        if (response.received) return this._update(id, { status: 'sent', sent_at: new Date().toISOString(), last_error: '' });
        return null;
      };
      let detail = '';
      if (previousAttempts > 0) {
        try {
          const result = finishReceipt(await this._receipt(record, remaining(4000)));
          if (result) return result;
        } catch (error) { detail = error.message; }
      }
      try { await this._post(record.body, remaining(6000)); }
      catch (error) { detail = error.message; }
      // A rejected fetch may still have reached the receiver. Always check the
      // receipt, including after a redirect, connection, or local timeout error.
      for (let attempt = 0; attempt < 4 && Date.now() < deadline - 50; attempt++) {
        if (attempt) await new Promise(resolve => global.setTimeout(resolve, remaining(Math.min(1800, attempt * 600))));
        if (Date.now() >= deadline - 50) break;
        try {
          const result = finishReceipt(await this._receipt(record, remaining(4000)));
          if (result) return result;
        } catch (error) { detail = error.message; }
      }
      let message = 'Delivery is not confirmed yet. This report is saved on this device; retry to check or send the same report.';
      if (detail && !/timed out|network|fetch|load/i.test(detail)) message += ' ' + detail.slice(0, 300);
      return this._update(id, { status: 'pending', last_error: message });
    }

    _post(body, timeout) {
      return new Promise((resolve, reject) => {
        if (typeof global.fetch !== 'function') { reject(failure('NETWORK', 'This browser cannot send reports.')); return; }
        const controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
        let finished = false;
        const settle = (fn, value) => {
          if (finished) return;
          finished = true; global.clearTimeout(timer); fn(value);
        };
        const timer = global.setTimeout(() => {
          if (controller) controller.abort();
          settle(reject, failure('TIMEOUT', 'The report dispatch timed out.'));
        }, timeout);
        const options = { method: 'POST', mode: 'no-cors', credentials: 'omit', redirect: 'follow', cache: 'no-store',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body };
        if (controller) options.signal = controller.signal;
        try {
          Promise.resolve(global.fetch(this.endpoint, options)).then(
            () => settle(resolve), error => settle(reject, error)
          );
        } catch (error) { settle(reject, error); }
      });
    }

    async _receipt(record, timeout) {
      const result = await this._jsonp({ action: 'receipt', submission_id: record.id, payload_hash: record.hash }, timeout);
      if (!plainObject(result) || result.ok !== true || typeof result.received !== 'boolean' || typeof result.conflict !== 'boolean' || (result.received && result.conflict)) {
        throw failure('INVALID_RESPONSE', 'The service did not return a valid delivery receipt.');
      }
      return result;
    }

    async fetchLeaderboard() {
      return validateBoard(await this._jsonp({ action: 'leaderboard' }, 10000));
    }

    _jsonp(params, timeout) {
      return new Promise((resolve, reject) => {
        if (!global.document || !global.document.createElement) { reject(failure('BROWSER_REQUIRED', 'Open the editor in a browser to connect to the statistics service.')); return; }
        const callback = '__fictionStatsCb_' + Date.now().toString(36) + '_' + (++callbackCounter).toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        const url = new URL(this.endpoint);
        Object.keys(params).forEach(key => url.searchParams.set(key, params[key]));
        url.searchParams.set('callback', callback);
        url.searchParams.set('_', Date.now().toString() + '-' + callbackCounter);
        const script = global.document.createElement('script');
        script.async = true;
        script.referrerPolicy = 'no-referrer';
        let finished = false;
        const cleanup = late => {
          global.clearTimeout(timer);
          script.onerror = null;
          if (script.parentNode) script.parentNode.removeChild(script);
          if (late) {
            // An already downloaded JSONP script can finish after removal. A
            // temporary no-op prevents a late callback from touching other work.
            global[callback] = () => {};
            global.setTimeout(() => { delete global[callback]; }, 30000);
          } else delete global[callback];
        };
        global[callback] = body => {
          if (finished) return;
          finished = true; cleanup(false);
          if (plainObject(body) && body.ok === false) {
            reject(failure(typeof body.error === 'string' ? body.error : 'SERVICE_ERROR',
              typeof body.message === 'string' ? body.message.slice(0, 500) : 'The statistics service could not complete this request.'));
          } else resolve(body);
        };
        const timer = global.setTimeout(() => {
          if (finished) return;
          finished = true; cleanup(true);
          reject(failure('TIMEOUT', 'The statistics service timed out.'));
        }, timeout);
        script.onerror = () => {
          if (finished) return;
          finished = true; cleanup(true);
          reject(failure('NETWORK', 'Could not load the statistics service. Check the connection and Web app access settings.'));
        };
        script.src = url.toString();
        try { (global.document.head || global.document.body).appendChild(script); }
        catch (error) { finished = true; cleanup(false); reject(error); }
      });
    }
  }

  AnnotationStatsService.sha256 = sha256;
  AnnotationStatsService.storagePrefix = PREFIX;
  global.AnnotationStatsService = AnnotationStatsService;
})(typeof window !== 'undefined' ? window : globalThis);
