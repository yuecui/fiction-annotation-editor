/* Connects the local XML workflow, contribution ledger, reward UI and reports.
 * Neither the XML nor its per-item audit records are sent to the statistics API.
 */
(function () {
  'use strict';
  const config = window.ANNOTATION_STATS_CONFIG;
  const engine = window.AnnotationStatsEngine;
  const KEYS = {
    profile: 'fiction-annotation.editor.v1',
    document: 'fiction-annotation.document.v1.',
    work: 'fiction-annotation.work.v1.',
    prepared: 'fiction-annotation.export.v1.',
    seenBoard: 'fiction-annotation.leaderboard.seen.v1'
  };
  const LABELS = {
    genders_marked: 'Genders marked', genders_corrected: 'Genders corrected',
    dialogues_identified: 'Dialogues identified', dialogues_corrected: 'Dialogues corrected',
    not_dialogue: 'Not dialogue'
  };
  const copy = value => JSON.parse(JSON.stringify(value));
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const zeroCounts = () => Object.fromEntries(engine.COUNT_KEYS.map(key => [key, 0]));
  const score = counts => engine.COUNT_KEYS.reduce((sum, key) => sum + (Number(counts[key]) || 0), 0);
  const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const TIME_ROLLOVER_MS = 24 * 60 * 60 * 1000;
  const SUSPENDED_CHECKPOINT_MS = 60 * 1000;
  let state = null;
  let profile = null;
  let modalMode = null;
  let currentSummary = null;
  let board = null;
  let boardError = '';
  let boardLoading = false;
  let identityPromise = null;
  let storageWarning = '';
  let modalReturnFocus = null;
  let committing = false;
  let bulkSending = false;
  let timeFlight = null;
  const sendingIds = new Set();
  const memoryReports = new Map();
  const dialog = document.getElementById('stats-dialog');
  const service = new AnnotationStatsService({ endpoint: config.endpoint, onChange: updateToolbar });

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function readStored(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function writeStored(key, value) {
    try {
      const raw = JSON.stringify(value);
      localStorage.setItem(key, raw);
      if (localStorage.getItem(key) !== raw) throw new Error('Storage verification failed.');
      return true;
    } catch (_) {
      storageWarning = 'This browser could not save your work reports locally. Keep this page open and try again before leaving. Your XML can still be exported.';
      showNotice(storageWarning);
      return false;
    }
  }

  function removeStored(key) {
    try { localStorage.removeItem(key); } catch (_) { /* Existing recovery data is safe to retain. */ }
  }

  function showNotice(message) {
    const element = document.getElementById('stats-notice');
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
  }

  function workKey(documentId) { return KEYS.work + profile.editor_id + '.' + documentId; }
  function preparedKey(documentId, submissionId) { return KEYS.prepared + profile.editor_id + '.' + documentId + '.' + submissionId; }
  function storedKeys(prefix) {
    try { return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(key => key && key.startsWith(prefix)); }
    catch (_) { return []; }
  }
  function validProfile(value) {
    return value && idPattern.test(value.editor_id || '') && typeof value.editor_name === 'string' &&
      value.editor_name.trim() && value.editor_name.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value.editor_name);
  }

  function snapshot(doc) {
    return engine.snapshotXml(doc, AnnotationXml.readExclusions(doc).map(record => record.quote_id));
  }

  function validSnapshot(value) {
    return value && typeof value === 'object' && value.genders && value.dialogues &&
      !Array.isArray(value.genders) && !Array.isArray(value.dialogues);
  }

  function mergeLoadedSnapshot(saved, loaded) {
    const result = copy(saved);
    for (const group of ['genders', 'dialogues']) {
      // An annotation already present on first encounter is never new work.
      for (const id of Object.keys(loaded[group])) {
        if (!own(result[group], id)) Object.defineProperty(result[group], id,
          { value: copy(loaded[group][id]), enumerable: true, writable: true, configurable: true });
      }
    }
    return result;
  }

  function nextBaseline(current) {
    const next = copy(state.baseline);
    for (const [group, touched] of [['genders', state.genders], ['dialogues', state.dialogues]]) {
      for (const id of touched) {
        if (own(current[group], id)) Object.defineProperty(next[group], id,
          { value: copy(current[group][id]), enumerable: true, writable: true, configurable: true });
        else delete next[group][id];
      }
    }
    return next;
  }

  function validTimerSample(sample) {
    const start = Date.parse(sample && sample.startedAt);
    const end = Date.parse(sample && sample.endedAt);
    return sample && Number.isFinite(sample.activeMs) && sample.activeMs >= 0 &&
      Number.isFinite(start) && Number.isFinite(end) && end >= start &&
      end - start <= 31 * 86400000 && sample.activeMs <= 7 * 86400000 &&
      sample.activeMs <= end - start + 5000;
  }

  function remainingSample(raw, pending, intervalStart) {
    if (!pending) return copy(raw);
    const activeMs = Math.max(0, raw.activeMs - pending.reservedMs);
    const end = Date.parse(raw.endedAt);
    const start = Math.min(Date.parse(intervalStart || pending.checkpoint.endedAt), end - activeMs);
    return { activeMs, activeSeconds: Math.floor(activeMs / 1000),
      startedAt: new Date(start).toISOString(), endedAt: raw.endedAt };
  }

  function workRecord(target, raw = target.timer.sample()) {
    const effective = remainingSample(raw, target.pendingTime, target.timeIntervalStart);
    return {
      version: 1, document_id: target.documentId, editor_id: profile.editor_id,
      baseline: target.baseline, session_id: target.sessionId,
      last_export_id: target.lastExportId, last_time_report_id: target.lastTimeReportId || null,
      timer_session_id: target.timerSessionId,
      pending_time_report_id: target.pendingTime?.payload.submission_id || null,
      timer_interval_started_at: target.timeIntervalStart || null,
      timer: raw, timer_checkpoint: effective
    };
  }

  function persistWork() {
    if (!state || committing) return false;
    const record = workRecord(state);
    // pagehide/blur may be the first callback after a long suspension. Never
    // overwrite the last valid dated sample with an interval containing that
    // unobserved gap; resume maintenance will close the preserved sample.
    if (!validTimerSample(record.timer_checkpoint) && validTimerSample(state.lastCheckpoint)) {
      record.timer_checkpoint = copy(state.lastCheckpoint);
      record.timer = state.pendingTime ? {
        ...state.lastCheckpoint,
        activeMs: state.pendingTime.reservedMs + state.lastCheckpoint.activeMs,
        activeSeconds: Math.floor((state.pendingTime.reservedMs + state.lastCheckpoint.activeMs) / 1000),
        startedAt: state.pendingTime.checkpoint.startedAt
      } : copy(state.lastCheckpoint);
    }
    const stored = writeStored(workKey(state.documentId), record);
    if (stored && validTimerSample(record.timer_checkpoint)) state.lastCheckpoint = copy(record.timer_checkpoint);
    return stored;
  }

  function refreshPauseReasons() {
    if (!state) return;
    document.hidden ? state.timer.pause('hidden') : state.timer.resume('hidden');
    document.hasFocus() ? state.timer.resume('unfocused') : state.timer.pause('unfocused');
    dialog.open ? state.timer.pause('modal') : state.timer.resume('modal');
  }

  function setModal(html, mode) {
    if (!dialog.open) modalReturnFocus = document.activeElement;
    modalMode = mode;
    dialog.innerHTML = html;
    dialog.classList.remove('stats-no-motion');
    if (!dialog.open) dialog.showModal();
    if (state) state.timer.pause('modal');
    dialog.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
  }

  function closeModal() {
    if (modalMode === 'identity') return;
    dialog.close();
  }

  dialog.addEventListener('cancel', event => {
    if (modalMode === 'identity') event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    modalMode = null;
    if (state) { state.timer.resume('modal'); refreshPauseReasons(); }
    if (modalReturnFocus && modalReturnFocus.isConnected) modalReturnFocus.focus({ preventScroll: true });
  });

  async function ensureEditor() {
    if (profile) return profile;
    const saved = readStored(KEYS.profile);
    if (validProfile(saved)) {
      profile = saved;
      return profile;
    }
    if (identityPromise) return identityPromise;
    identityPromise = new Promise(resolve => {
      setModal(`<form id="stats-identity-form">
        <div class="stats-modal-header"><p class="stats-eyebrow">Your next chapter</p>
          <h2 class="stats-title" id="stats-dialog-title">Let’s make your work count.</h2>
          <p class="stats-description">Enter the name you use with your project team. We’ll remember it on this browser for your reports and weekly leaderboard.</p></div>
        <div class="stats-modal-body"><label class="stats-name-label" for="stats-editor-name">Your name</label>
          <input class="stats-name-input" id="stats-editor-name" name="editor_name" autocomplete="name" maxlength="100" required placeholder="e.g. Alex Smith" autofocus>
          <p class="stats-inline-error" id="stats-name-error" role="alert"></p></div>
        <div class="stats-modal-footer"><button class="stats-button stats-button-primary" type="submit">Start editing <span aria-hidden="true">→</span></button>
          <p class="stats-footnote">Your story stays on your device. You choose when to send each work report.</p></div>
      </form>`, 'identity');
      document.getElementById('stats-identity-form').addEventListener('submit', event => {
        event.preventDefault();
        const name = document.getElementById('stats-editor-name').value.trim().normalize('NFC');
        if (!name || /[\u0000-\u001f\u007f]/.test(name)) {
          document.getElementById('stats-name-error').textContent = 'Please enter a name without line breaks or control characters.';
          return;
        }
        profile = { version: 1, editor_id: uuid(), editor_name: name };
        writeStored(KEYS.profile, profile);
        modalMode = null;
        dialog.close();
        identityPromise = null;
        resolve(profile);
      });
    });
    return identityPromise;
  }

  function makePayload(counts, timer, documentId, file, sessionId, submissionId = uuid()) {
    return {
      schema_version: 1, submission_id: submissionId, session_id: sessionId,
      editor_id: profile.editor_id, editor_name: profile.editor_name,
      document_id: documentId, file_name: file,
      started_at: timer.startedAt || timer.endedAt, ended_at: timer.endedAt,
      active_seconds: timer.activeSeconds, ...counts
    };
  }

  function exportChainContains(currentId, olderId, links) {
    const visited = new Set();
    while (currentId && !visited.has(currentId)) {
      if (currentId === olderId) return true;
      visited.add(currentId);
      const checkpoint = links.get(currentId);
      if (!checkpoint || checkpoint.kind === 'time') return false;
      currentId = checkpoint.previousExportId || null;
    }
    return false;
  }

  async function recoverPrepared(prepared, key, knownLinks = null) {
    await service.enqueue(prepared.payload);
    const work = KEYS.work + prepared.payload.editor_id + '.' + prepared.payload.document_id;
    const saved = readStored(work);
    const reportId = prepared.payload.submission_id;
    if (prepared.kind === 'time') {
      if (saved && saved.last_time_report_id === reportId) {
        removeStored(key); memoryReports.delete(reportId); return true;
      }
      // A time-only checkpoint never advances the XML/export chain. Its
      // explicit timer linkage also protects a newer interval from being reset.
      if (saved && saved.pending_time_report_id !== reportId &&
          (saved.timer_session_id || saved.session_id) !== prepared.previousTimerSessionId) return false;
      const live = state && state.documentId === prepared.payload.document_id &&
        state.pendingTime?.payload.submission_id === reportId ? state : null;
      const remainder = live
        ? remainingSample(live.timer.sample(), prepared, live.timeIntervalStart)
        : saved && saved.pending_time_report_id === reportId && validTimerSample(saved.timer_checkpoint)
          ? saved.timer_checkpoint
          : saved && saved.timer ? remainingSample(saved.timer, prepared, saved.timer_interval_started_at)
            : { activeMs: prepared.checkpoint.activeMs - prepared.reservedMs,
              activeSeconds: 0, startedAt: prepared.checkpoint.endedAt, endedAt: prepared.checkpoint.endedAt };
      const next = { ...(saved || {}), version: 1, document_id: prepared.payload.document_id,
        editor_id: prepared.payload.editor_id,
        baseline: saved?.baseline || prepared.baseline,
        session_id: saved && saved.session_id !== prepared.payload.session_id ? saved.session_id : prepared.nextTimerSessionId,
        last_export_id: saved?.last_export_id || prepared.previousExportId || null,
        last_time_report_id: reportId, pending_time_report_id: null,
        timer_session_id: prepared.nextTimerSessionId, timer_interval_started_at: null,
        timer: remainder, timer_checkpoint: remainder };
      if (!writeStored(work, next)) return false;
      // Only now is the old interval both queued and replaced durably.
      if (live) {
        live.timer.restore(remainder);
        live.timerSessionId = prepared.nextTimerSessionId;
        if (live.sessionId === prepared.payload.session_id) live.sessionId = prepared.nextTimerSessionId;
        live.lastTimeReportId = reportId;
        live.pendingTime = null;
        live.timeIntervalStart = null;
        live.lastCheckpoint = copy(remainder);
      }
      removeStored(key); memoryReports.delete(reportId); return true;
    }
    if (saved && saved.last_export_id === reportId) {
      removeStored(key); memoryReports.delete(reportId); return true;
    }
    const links = knownLinks || new Map(storedKeys(KEYS.prepared)
      .map(candidate => readStored(candidate)).filter(candidate => candidate?.payload)
      .map(candidate => [candidate.payload.submission_id, candidate]));
    if (saved && exportChainContains(saved.last_export_id, reportId, links)) {
      removeStored(key); memoryReports.delete(reportId); return true;
    }
    // Do not use timestamps to infer export order: the system clock can move
    // backwards. Keep unmatched checkpoints until their predecessor commits.
    if (!saved && prepared.previousExportId) return false;
    if (saved && (saved.last_export_id || null) !== (prepared.previousExportId || null)) return false;
    if (prepared.timeReservationId && saved?.pending_time_report_id === prepared.timeReservationId) return false;
    const nextSessionId = prepared.nextSessionId || uuid();
    const persisted = writeStored(work, { ...(saved || {}), version: 1,
      document_id: prepared.payload.document_id, editor_id: prepared.payload.editor_id,
      baseline: prepared.nextBaseline, session_id: nextSessionId,
      timer_session_id: nextSessionId,
      last_export_id: reportId, timer: prepared.carryTimer || null,
      timer_checkpoint: prepared.carryTimer || null, timer_interval_started_at: null });
    if (!persisted) return false;
    removeStored(key); memoryReports.delete(reportId); return true;
  }

  async function recoverCheckpointChain(recoveries) {
    let pending = recoveries.slice();
    const links = new Map(recoveries.map(item => [item.prepared.payload.submission_id, item.prepared]));
    let progressed = true;
    while (pending.length && progressed) {
      progressed = false;
      const unmatched = [];
      for (const item of pending) {
        try {
          if (await recoverPrepared(item.prepared, item.key, links)) progressed = true;
          else unmatched.push(item);
        } catch (_) {
          memoryReports.set(item.prepared.payload.submission_id, item.prepared);
          unmatched.push(item);
        }
      }
      pending = unmatched;
    }
  }

  function runTimeRollover(target) {
    if (timeFlight) return timeFlight;
    const prepared = target.pendingTime;
    if (!prepared) return Promise.resolve(true);
    target.timer.pause('time-checkpoint');
    const key = preparedKey(target.documentId, prepared.payload.submission_id);
    // Freeze the UUID, exact sample and timer linkage before asynchronous
    // hashing or queue writes. A crash can replay this same zero-point record.
    if (!writeStored(key, prepared)) {
      memoryReports.set(prepared.payload.submission_id, prepared);
      target.timer.resume('time-checkpoint');
      return Promise.resolve(false);
    }
    persistWork();
    timeFlight = (async () => {
      try {
        const done = await recoverPrepared(prepared, key);
        if (!done) memoryReports.set(prepared.payload.submission_id, prepared);
        return done;
      } catch (error) {
        prepared.reportError = error.message;
        memoryReports.set(prepared.payload.submission_id, prepared);
        showNotice('A work report could not be saved locally. Keep this page open and retry it from Reports.');
        return false;
      } finally {
        target.timer.resume('time-checkpoint');
        timeFlight = null;
        if (state === target) { persistWork(); updateToolbar(); }
      }
    })();
    return timeFlight;
  }

  function maintainTime({ resuming = false } = {}) {
    const target = state;
    if (!target || committing || target.exporting) return timeFlight || Promise.resolve(false);
    const checkpoint = target.lastCheckpoint;
    const suspended = resuming && validTimerSample(checkpoint) &&
      Date.now() - Date.parse(checkpoint.endedAt) > SUSPENDED_CHECKPOINT_MS;
    if (suspended) {
      // A suspended/closed page has no observable work after its last durable
      // sample. Re-anchor there before inspecting the resumed clock, preserving
      // its original dates instead of counting a sleep gap or compressing it.
      const raw = target.pendingTime ? {
        activeMs: target.pendingTime.reservedMs + checkpoint.activeMs,
        startedAt: target.pendingTime.checkpoint.startedAt
      } : checkpoint;
      target.timer.restore(raw);
    }
    if (target.pendingTime) return runTimeRollover(target);
    const sample = suspended ? checkpoint : target.timer.sample();
    const age = Date.now() - Date.parse(sample.startedAt);
    if (!suspended && age < TIME_ROLLOVER_MS) { persistWork(); return Promise.resolve(false); }
    if (!validTimerSample(sample)) {
      showNotice('An older work interval needs coordinator review before it can be reported. Its original dates and duration have been kept in this browser.');
      return Promise.resolve(false);
    }
    if (!sample.activeSeconds) {
      // Retain fractional work when an empty/paused interval crosses a day.
      const next = { activeMs: sample.activeMs, activeSeconds: 0,
        startedAt: new Date(Date.now() - sample.activeMs).toISOString(), endedAt: new Date().toISOString() };
      const record = workRecord(target);
      record.timer = next; record.timer_checkpoint = next;
      if (writeStored(workKey(target.documentId), record)) {
        target.timer.restore(next); target.lastCheckpoint = copy(next);
      }
      return Promise.resolve(true);
    }
    const payload = makePayload(zeroCounts(), sample, target.documentId, target.sourceName, target.sessionId);
    target.pendingTime = { kind: 'time', stage: 'time-prepared', payload,
      checkpoint: copy(sample), reservedMs: payload.active_seconds * 1000,
      previousTimerSessionId: target.timerSessionId,
      nextTimerSessionId: uuid(), previousTimeReportId: target.lastTimeReportId || null,
      previousExportId: target.lastExportId || null, baseline: copy(target.baseline),
      counts: zeroCounts(), points: 0, sourceName: target.sourceName,
      editorName: profile.editor_name, outputName: '', outcome: 'report', reportError: '' };
    target.timeIntervalStart = suspended ? new Date().toISOString() : sample.endedAt;
    return runTimeRollover(target);
  }

  async function beginDocument(doc, options) {
    if (state) { persistWork(); state.timer.stop(); }
    if (timeFlight) await timeFlight;
    await ready;
    await ensureEditor();
    const rawHash = await AnnotationStatsService.sha256(options.rawContent);
    let record = AnnotationXml.getDocumentRecord(doc);
    const remembered = readStored(KEYS.document + rawHash);
    const documentId = record && idPattern.test(record.document_id || '') ? record.document_id :
      (remembered && idPattern.test(remembered.document_id || '') ? remembered.document_id : uuid());
    const sourceName = record && typeof record.source_file === 'string' && record.source_file.trim() &&
      record.source_file.length <= 255 && !/[\u0000-\u001f\u007f]/.test(record.source_file)
      ? record.source_file : options.fileName.replace(/^(?:resolved_)+/i, '');
    record = { version: 1, document_id: documentId, source_file: sourceName,
      last_export_id: record && record.last_export_id || null };
    AnnotationXml.setDocumentRecord(doc, record);
    writeStored(KEYS.document + rawHash, { document_id: documentId });

    // An exported XML contains its frozen batch ID. It can recover an export
    // interrupted between the file write and the local report commit.
    const exportedIds = new Set(AnnotationXml.readBatches(doc).map(batch => batch.submission_id));
    const recoveries = storedKeys(KEYS.prepared + profile.editor_id + '.' + documentId + '.')
      .map(key => ({ key, prepared: readStored(key) }))
      .filter(({ prepared }) => prepared && prepared.payload && prepared.payload.editor_id === profile.editor_id &&
        (prepared.kind === 'time' || prepared.stage === 'exported' || exportedIds.has(prepared.payload.submission_id)));
    await recoverCheckpointChain(recoveries);

    const saved = readStored(workKey(documentId));
    const loaded = snapshot(doc);
    const baseline = saved && validSnapshot(saved.baseline) ? mergeLoadedSnapshot(saved.baseline, loaded) : loaded;
    const timer = new engine.ActiveTimer({ idleMs: config.idleMs });
    const sessionId = saved && idPattern.test(saved.session_id || '') ? saved.session_id : uuid();
    state = { doc, documentId, sourceName, record, sessionId, timer, baseline,
      lastExportId: saved && saved.last_export_id || record.last_export_id,
      lastTimeReportId: saved?.last_time_report_id || null,
      timerSessionId: saved?.timer_session_id || sessionId,
      pendingTime: saved?.pending_time_report_id
        ? readStored(preparedKey(documentId, saved.pending_time_report_id)) || memoryReports.get(saved.pending_time_report_id) || null : null,
      timeIntervalStart: saved?.timer_interval_started_at || null,
      lastCheckpoint: saved?.timer_checkpoint || saved?.timer || null,
      exporting: false, genders: new Set(), dialogues: new Set(), excluded: new Set() };
    timer.start();
    if (saved && saved.timer && Number.isFinite(saved.timer.activeMs) && saved.timer.activeMs >= 0 &&
        Number.isFinite(Date.parse(saved.timer.startedAt))) {
      timer.restore(saved.timer);
    }
    refreshPauseReasons();
    await maintainTime({ resuming: true });
    if (saved && saved.last_export_id && saved.last_export_id !== record.last_export_id) {
      showNotice('This file is older than your latest export in this browser. Open your latest resolved_ XML to continue from the most recent changes. Previously credited items will not be counted again.');
    } else if (!storageWarning && !service.storageWarning) showNotice('');
    refreshPauseReasons();
    persistWork();
    maybeShowBoard();
    updateToolbar();
  }

  function touchGender(id) { if (state) { state.genders.add(id); state.timer.activity(); } }
  function touchDialogue(id) { if (state) { state.dialogues.add(id); state.timer.activity(); } }
  function ignoreAutomaticDialogueReset(id) { if (state) state.dialogues.delete(id); }

  function excludeQuotation(node) {
    if (!state) return;
    const id = AnnotationXml.id(node);
    AnnotationXml.addExclusion(state.doc, node, { editor_id: profile.editor_id,
      editor_name: profile.editor_name, changed_at: new Date().toISOString(), submission_id: null });
    state.excluded.add(id);
    touchDialogue(id);
  }

  function prepareExport(outputName) {
    if (!state) return null;
    // Start/resume a due checkpoint synchronously. The save picker may open
    // immediately; completeExport waits for this handoff after the file write.
    maintainTime({ resuming: true });
    state.exporting = true;
    state.timer.pause('export');
    const current = snapshot(state.doc);
    const diff = engine.diffSnapshots(state.baseline, current);
    const changes = diff.changes.filter(change =>
      (change.kind.startsWith('genders_') ? state.genders : state.dialogues).has(change.item_id));
    const counts = zeroCounts();
    changes.forEach(change => counts[change.kind]++);
    const sample = remainingSample(state.timer.sample(), state.pendingTime, state.timeIntervalStart);
    const points = score(counts);
    const payload = points > 0 || sample.activeSeconds > 0
      ? makePayload(counts, sample, state.documentId, state.sourceName, state.sessionId) : null;
    const exportDoc = state.doc.cloneNode(true);
    const next = nextBaseline(current);
    let batch = null;
    if (payload) {
      batch = { version: 1, submission_id: payload.submission_id, session_id: payload.session_id,
        document_id: state.documentId, editor_id: profile.editor_id, editor_name: profile.editor_name,
        exported_at: sample.endedAt, counts, changes };
      AnnotationXml.setDocumentRecord(exportDoc, { ...state.record, last_export_id: payload.submission_id });
      AnnotationXml.setExclusionSubmission(exportDoc, Array.from(state.excluded), payload.submission_id);
      AnnotationXml.appendBatch(exportDoc, batch);
    }
    const transaction = { payload, counts, points, changes, outputName, exportDoc,
      nextBaseline: next, batch, excluded: Array.from(state.excluded), sourceName: state.sourceName,
      editorName: profile.editor_name, stage: 'prepared', reportError: '', previousExportId: state.lastExportId || null,
      timeSample: sample, timeReservationId: state.pendingTime?.payload.submission_id || null,
      timeHandoff: timeFlight, nextSessionId: uuid() };
    if (payload) writeStored(preparedKey(state.documentId, payload.submission_id), serializableTransaction(transaction));
    return transaction;
  }

  function serializableTransaction(transaction) {
    return { payload: transaction.payload, nextBaseline: transaction.nextBaseline,
      stage: transaction.stage, counts: transaction.counts, points: transaction.points,
      outputName: transaction.outputName, sourceName: transaction.sourceName,
      editorName: transaction.editorName, batch: transaction.batch, excluded: transaction.excluded,
      previousExportId: transaction.previousExportId || null, reportError: transaction.reportError || '',
      timeReservationId: transaction.timeReservationId || null,
      nextSessionId: transaction.nextSessionId, carryTimer: transaction.carryTimer || null };
  }

  function cancelExport(transaction) {
    if (!state) return;
    if (transaction && transaction.payload) removeStored(preparedKey(state.documentId, transaction.payload.submission_id));
    state.exporting = false;
    state.timer.resume('export');
    refreshPauseReasons();
    persistWork();
  }

  async function completeExport(transaction, outcome) {
    if (!transaction || !state) return;
    if (transaction.timeHandoff) await transaction.timeHandoff;
    committing = true;
    try {
    transaction.outcome = outcome;
    transaction.stage = 'exported';
    const carryMs = Math.max(0, (transaction.timeSample?.activeMs || 0) - (transaction.payload?.active_seconds || 0) * 1000);
    transaction.carryTimer = { activeMs: carryMs, activeSeconds: Math.floor(carryMs / 1000),
      startedAt: new Date(Date.now() - carryMs).toISOString(), endedAt: new Date().toISOString() };
    if (transaction.payload) {
      // First persist the fact that the XML operation completed. On refresh,
      // this can be re-enqueued with exactly the same payload and UUID.
      writeStored(preparedKey(state.documentId, transaction.payload.submission_id), serializableTransaction(transaction));
      try {
        await service.enqueue(transaction.payload);
        memoryReports.delete(transaction.payload.submission_id);
      } catch (error) {
        transaction.reportError = error.message;
        memoryReports.set(transaction.payload.submission_id, serializableTransaction(transaction));
      }
      // The live XML now matches the saved audit, without reparsing or replacing
      // character element references held by the editor.
      AnnotationXml.setDocumentRecord(state.doc, { ...state.record, last_export_id: transaction.payload.submission_id });
      AnnotationXml.setExclusionSubmission(state.doc, transaction.excluded, transaction.payload.submission_id);
      AnnotationXml.appendBatch(state.doc, transaction.batch);
      state.record.last_export_id = transaction.payload.submission_id;
      state.lastExportId = transaction.payload.submission_id;
    }
    state.baseline = transaction.nextBaseline;
    state.genders.clear(); state.dialogues.clear(); state.excluded.clear();
    if (state.pendingTime) {
      // A failed time checkpoint still owns its reserved duration. Preserve it
      // while removing only the separately exported interval from the clock.
      state.timer.restore({ activeMs: state.pendingTime.reservedMs + carryMs,
        startedAt: state.pendingTime.checkpoint.startedAt });
      state.timeIntervalStart = transaction.carryTimer.startedAt;
    } else {
      state.timer.restore(transaction.carryTimer);
      state.timerSessionId = transaction.nextSessionId;
    }
    state.sessionId = transaction.nextSessionId;
    committing = false;
    const baselinePersisted = persistWork();
    if (transaction.payload && !transaction.reportError && baselinePersisted) removeStored(preparedKey(state.documentId, transaction.payload.submission_id));
    // A frozen report is also retained in memory if storage is full. Its ID is
    // reused by Retry; the new baseline prevents duplicate credit this visit.
    renderSummary(transaction, true);
    state.timer.resume('export');
    refreshPauseReasons();
    updateToolbar();
    } finally {
      committing = false;
      state.exporting = false;
      state.timer.resume('export');
      refreshPauseReasons();
    }
  }

  function header(title, eyebrow = 'Fiction annotation', extra = '') {
    return `<div class="stats-modal-header"><button class="stats-modal-close" type="button" data-close-modal aria-label="Close dialog">×</button>
      <p class="stats-eyebrow">${esc(eyebrow)}</p><h2 class="stats-title" id="stats-dialog-title">${esc(title)}</h2>${extra}</div>`;
  }

  function metricMarkup(counts) {
    return `<div class="stats-metrics">${engine.COUNT_KEYS.map(key => `<div class="stats-metric" data-positive="${counts[key] > 0}">
      <span class="stats-metric-number">${counts[key]}</span><span class="stats-metric-label">${LABELS[key]}</span></div>`).join('')}</div>`;
  }

  function confettiMarkup() {
    const colors = ['#818cf8', '#34d399', '#fbbf24', '#c4b5fd', '#f9a8d4'];
    return `<div class="stats-confetti" aria-hidden="true">${Array.from({ length: 24 }, (_, i) =>
      `<i style="--confetti-left:${(i * 37) % 100}%;--confetti-delay:${(i % 6) * .07}s;--confetti-color:${colors[i % 5]};--confetti-rotation:${120 + i * 29}deg"></i>`).join('')}</div>`;
  }

  function reportStatus(transaction, report) {
    if (!transaction.payload) return { state: 'idle', text: 'No new annotation changes in this export. You can keep editing whenever you’re ready.', label: 'Nothing new to send', disabled: true };
    if (report && report.status === 'sent') return { state: 'sent', text: 'Report received by your project’s Google Sheet. Your contribution is recorded.', label: 'Report sent ✓', disabled: true };
    if (report && report.status === 'conflict') return { state: 'error', text: report.last_error, label: 'Needs coordinator review', disabled: true };
    if (sendingIds.has(transaction.payload.submission_id) || service.isSending(transaction.payload.submission_id)) return { state: 'sending', text: 'Sending your report and waiting for confirmation…', label: 'Confirming…', disabled: true };
    if (transaction.reportError) return { state: 'error', text: 'Your XML export completed, but the report could not be saved for later. Keep this page open and retry. ' + transaction.reportError, label: 'Retry report', disabled: false };
    if (report && report.last_error) return { state: 'error', text: report.last_error + ' Your report is still saved here for retry.', label: 'Retry report', disabled: false };
    return { state: 'pending', text: 'Ready to send. This report is saved on this browser until Google Sheet confirms it.', label: 'Send report', disabled: false };
  }

  function renderSummary(transaction, celebrate = false) {
    currentSummary = transaction;
    const report = transaction.payload && service.getReport(transaction.payload.submission_id);
    const status = reportStatus(transaction, report);
    const positive = transaction.points > 0;
    const title = positive ? 'A chapter well done!' : 'All set for this export.';
    const exportLabel = transaction.outcome === 'saved' ? 'XML saved' : transaction.outcome === 'download' ? 'Download started' : 'Work report';
    setModal(`<div class="stats-modal-header stats-summary-top ${celebrate && positive ? 'stats-celebrate' : ''}">
        ${celebrate && positive ? confettiMarkup() : ''}<button class="stats-modal-close" type="button" data-close-modal aria-label="Close summary">×</button>
        <p class="stats-eyebrow">${exportLabel} · ${positive ? 'contribution unlocked' : 'work summary'}</p>
        <div class="stats-medal" aria-hidden="true">${positive ? '✦' : '✓'}</div>
        <h2 class="stats-title" id="stats-dialog-title">${title}</h2>
        <div class="stats-xp"><span class="stats-xp-number">+${transaction.points}</span><span class="stats-xp-label">XP</span></div>
        <p class="stats-summary-meta"><strong>${esc(transaction.editorName)}</strong> · ${esc(transaction.sourceName)}</p>
        ${celebrate && positive ? '<button type="button" class="stats-link stats-skip" id="stats-skip-animation">Skip animation</button>' : ''}
      </div><div class="stats-modal-body">${metricMarkup(transaction.counts)}
        <div class="stats-status" id="stats-send-status" data-state="${status.state}" role="status"><span class="stats-status-dot" aria-hidden="true"></span><span>${esc(status.text)}</span></div>
        <p class="stats-quiet-line">Each final change earns 1 XP. Corrections count, too.</p></div>
      <div class="stats-modal-footer"><div class="stats-actions">
        <button type="button" class="stats-button stats-button-primary" id="stats-send-report" ${status.disabled ? 'disabled' : ''}>${status.state === 'sending' ? '<span class="stats-spinner" aria-hidden="true"></span>' : ''}${status.label}</button>
        <button type="button" class="stats-button" data-close-modal>Continue editing</button></div>
        <p class="stats-footnote">${transaction.outcome === 'download' ? 'Check your Downloads folder for ' + esc(transaction.outputName) + '. ' : ''}Sending this report shares your work totals with the project. Your XML stays on your device.</p>
      </div>`, 'summary');
    const skip = document.getElementById('stats-skip-animation');
    if (skip) skip.addEventListener('click', () => { dialog.classList.add('stats-no-motion'); skip.hidden = true; });
    document.getElementById('stats-send-report').addEventListener('click', () => sendTransaction(transaction));
  }

  async function sendTransaction(transaction) {
    if (!transaction.payload) return;
    const id = transaction.payload.submission_id;
    if (sendingIds.has(id)) return;
    sendingIds.add(id);
    if (modalMode === 'summary' && currentSummary === transaction) renderSummary(transaction);
    else if (modalMode === 'reports') renderReports();
    try {
      if (!service.getReport(transaction.payload.submission_id)) {
        await service.enqueue(transaction.payload);
        transaction.reportError = '';
        memoryReports.delete(transaction.payload.submission_id);
        const key = preparedKey(transaction.payload.document_id, transaction.payload.submission_id);
        const pending = readStored(key);
        if (pending && pending.payload && pending.payload.submission_id === transaction.payload.submission_id) await recoverPrepared(pending, key);
      }
      const sending = service.send(transaction.payload.submission_id);
      if (modalMode === 'summary' && currentSummary === transaction) renderSummary(transaction);
      else if (modalMode === 'reports') renderReports();
      await sending;
    } catch (error) { transaction.reportError = error.message; }
    finally { sendingIds.delete(id); }
    if (modalMode === 'summary' && currentSummary === transaction) renderSummary(transaction);
    else if (modalMode === 'reports') renderReports();
    updateToolbar();
  }

  function transactionForReport(report) {
    const counts = Object.fromEntries(engine.COUNT_KEYS.map(key => [key, report.payload[key]]));
    return { payload: report.payload, counts, points: score(counts),
      sourceName: report.payload.file_name, editorName: report.payload.editor_name,
      outputName: '', outcome: 'report', reportError: '' };
  }

  function reportDate(payload) {
    return new Date(payload.ended_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function renderReports() {
    const reports = service.getReports();
    const pending = reports.filter(report => report.status === 'pending');
    setModal(header('Your work reports', 'Every contribution counts', '<p class="stats-description">Reopen a summary or send a report that is still waiting for confirmation.</p>') +
      `<div class="stats-modal-body"><div class="stats-reports-list">${memoryReports.size ? '<div class="stats-status" data-state="error" role="alert">Some exported reports could not be saved locally. Keep this page open and retry them below.</div>' : ''}
      ${Array.from(memoryReports.values()).map(tx => `<div class="stats-report"><p class="stats-report-file">${esc(tx.sourceName)}</p><p class="stats-report-details">Report needs to be saved on this browser.</p><button type="button" class="stats-button stats-button-soft" data-memory-report="${esc(tx.payload.submission_id)}">Retry report</button></div>`).join('')}
      ${reports.map(report => `<article class="stats-report"><div class="stats-report-line"><p class="stats-report-file">${esc(report.payload.file_name)}</p><span class="stats-report-score">+${score(report.payload)} XP</span></div>
        <p class="stats-report-date">${esc(report.payload.editor_name)} · ${esc(reportDate(report.payload))}</p>
        <div class="stats-report-line"><span class="stats-tag ${report.status === 'sent' ? 'stats-tag-sent' : ''}">${report.status === 'sent' ? 'Received' : report.status === 'conflict' ? 'Needs review' : service.isSending(report.id) ? 'Confirming…' : 'Pending'}</span>
          <button class="stats-button stats-button-soft" type="button" data-open-report="${esc(report.id)}">${report.status === 'sent' ? 'View summary' : 'Open report'}</button></div></article>`).join('')}
      ${!reports.length && !memoryReports.size ? '<div class="stats-empty">Your reports will appear here after you export an XML file.<br>Finish a few annotations, then choose Save XML.</div>' : ''}</div></div>
      <div class="stats-modal-footer"><div class="stats-actions">${pending.length > 1 ? `<button type="button" class="stats-button stats-button-primary" id="stats-send-all" ${bulkSending ? 'disabled' : ''}>${bulkSending ? 'Sending reports…' : 'Send ' + pending.length + ' pending reports'}</button>` : ''}
      <button type="button" class="stats-button" data-close-modal>Back to editing</button></div>
      <p class="stats-footnote">Pending reports stay in this browser. Keep its site data until your reports show Received.</p></div>`, 'reports');
    dialog.querySelectorAll('[data-open-report]').forEach(button => button.addEventListener('click', () => {
      const report = service.getReport(button.dataset.openReport);
      if (report) renderSummary(transactionForReport(report));
    }));
    dialog.querySelectorAll('[data-memory-report]').forEach(button => button.addEventListener('click', () => {
      const transaction = memoryReports.get(button.dataset.memoryReport);
      if (transaction) renderSummary(transaction);
    }));
    const sendAll = document.getElementById('stats-send-all');
    if (sendAll) sendAll.addEventListener('click', async () => {
      if (bulkSending) return;
      bulkSending = true;
      sendAll.disabled = true;
      try { for (const report of pending) await sendTransaction(transactionForReport(report)); }
      finally { bulkSending = false; if (modalMode === 'reports') renderReports(); }
    });
  }

  function updateToolbar() {
    const button = document.getElementById('stats-reports-button');
    const badge = document.getElementById('stats-pending-count');
    if (!button || !badge) return;
    const count = service.pendingCount() + memoryReports.size;
    badge.textContent = count;
    badge.hidden = !count;
    button.setAttribute('aria-label', count ? `Reports, ${count} waiting for confirmation` : 'Your work reports');
  }

  function boardSignature(value) { return value && value.week_start || ''; }
  function maybeShowBoard() {
    if (!board || !board.entries.length || dialog.open || !document.hasFocus() || document.hidden) return;
    if (readStored(KEYS.seenBoard) !== boardSignature(board)) renderBoard();
  }

  function formatWeek(value) {
    const format = date => new Date(date + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${format(value.week_start)} – ${format(value.week_end)}, ${value.week_start.slice(0, 4)}`;
  }

  function renderBoard() {
    const hasEntries = board && board.entries.length > 0;
    let content;
    if (boardLoading && !board) content = '<div class="stats-empty"><span class="stats-spinner" aria-hidden="true"></span><br>Loading the weekly leaderboard…</div>';
    else if (!hasEntries) content = `<div class="stats-empty"><div class="stats-board-icon" aria-hidden="true">✦</div><br>${boardError ? esc(boardError) : 'The first weekly leaderboard is on its way.<br>Your coordinator will publish it after reviewing the team’s reports.'}</div>`;
    else content = `<div class="stats-board-banner"><span class="stats-board-icon" aria-hidden="true">♛</span><div><strong>${esc(formatWeek(board))}</strong><p>A week of careful reading. A team of thoughtful editors.</p></div></div>
      <table class="stats-board-table"><caption class="sr-only">Published weekly annotation leaderboard</caption><thead><tr><th scope="col">Rank</th><th scope="col">Editor &amp; file</th><th scope="col">XP</th></tr></thead><tbody>${board.entries.map(entry =>
        `<tr><td><span class="stats-board-rank" data-rank="${entry.rank}">${entry.rank}</span></td><td><div class="stats-board-name">${esc(entry.editor_name)}</div><div class="stats-board-file">${esc(entry.file_name)}</div>
        <details class="stats-board-breakdown"><summary>See contributions</summary><p>${engine.COUNT_KEYS.map(key => `${esc(LABELS[key])}: <strong>${entry[key]}</strong>`).join('<br>')}</p></details></td><td><span class="stats-board-score">${entry.points}</span></td></tr>`).join('')}</tbody></table>`;
    setModal(header('This week’s celebration', 'Weekly leaderboard', '<p class="stats-description">Recognizing the team’s published contributions from the previous work week.</p>') +
      `<div class="stats-modal-body">${content}${boardError && hasEntries ? `<p class="stats-inline-error">${esc(boardError)}</p>` : ''}</div>
      <div class="stats-modal-footer"><div class="stats-actions"><button type="button" class="stats-button stats-button-primary" data-close-modal>Let’s keep going <span aria-hidden="true">→</span></button>
      <button type="button" class="stats-button" id="stats-refresh-board" ${boardLoading ? 'disabled' : ''}>${boardLoading ? 'Loading…' : 'Refresh'}</button></div>
      <p class="stats-footnote">Ranked by the five contribution totals. Equal scores share the same rank.</p></div>`, 'leaderboard');
    if (hasEntries) writeStored(KEYS.seenBoard, boardSignature(board));
    document.getElementById('stats-refresh-board').addEventListener('click', () => loadBoard(true));
  }

  async function loadBoard(show) {
    if (boardLoading) { if (show) renderBoard(); return; }
    boardLoading = true;
    if (show) renderBoard();
    try { board = await service.fetchLeaderboard(); boardError = ''; }
    catch (_) { boardError = 'The leaderboard is unavailable right now. Your editing and saved reports are unaffected. Try Refresh when you’re online.'; }
    boardLoading = false;
    if (modalMode === 'leaderboard') renderBoard();
    else if (!show) maybeShowBoard();
  }

  // Recover only exports explicitly marked completed. Prepared-only records
  // require the matching exported XML and are handled by beginDocument().
  const ready = service.ready().then(async () => {
    const savedProfile = readStored(KEYS.profile);
    if (validProfile(savedProfile)) {
      profile = savedProfile;
    }
    try {
      const recoveries = storedKeys(KEYS.prepared).map(key => ({ key, prepared: readStored(key) }))
        .filter(({ prepared }) => prepared && prepared.payload &&
          (prepared.kind === 'time' || prepared.stage === 'exported'));
      await recoverCheckpointChain(recoveries);
    } catch (_) { /* Storage warning is already presented by the service. */ }
    if (service.storageWarning) showNotice(service.storageWarning);
    updateToolbar();
  });

  document.getElementById('stats-reports-button').addEventListener('click', async () => { await ready; renderReports(); });
  document.getElementById('stats-leaderboard-button').addEventListener('click', () => loadBoard(true));
  ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart'].forEach(type => document.addEventListener(type, event => {
    if (state && !dialog.open && !document.hidden && event.target.closest && event.target.closest('#screen-editor')) {
      maintainTime({ resuming: true }); state.timer.activity();
    }
  }, { passive: true, capture: true }));
  document.addEventListener('scroll', event => {
    if (state && !dialog.open && !document.hidden && (event.target === document || event.target.closest && event.target.closest('#screen-editor'))) {
      maintainTime({ resuming: true }); state.timer.activity();
    }
  }, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) maintainTime({ resuming: true });
    refreshPauseReasons(); persistWork();
  });
  window.addEventListener('blur', () => { if (state) state.timer.pause('unfocused'); persistWork(); });
  window.addEventListener('focus', () => { maintainTime({ resuming: true }); refreshPauseReasons(); maybeShowBoard(); });
  window.addEventListener('pagehide', persistWork);
  window.addEventListener('beforeunload', event => {
    persistWork();
    if (memoryReports.size) { event.preventDefault(); event.returnValue = ''; }
  });
  setInterval(() => maintainTime({ resuming: true }), 10000);
  ready.then(() => loadBoard(false));

  window.AnnotationStats = { beginDocument, touchGender, touchDialogue, ignoreAutomaticDialogueReset,
    excludeQuotation, prepareExport, cancelExport, completeExport, ready,
    noteEdit() { if (state) state.timer.activity(); },
    pause(reason) { if (state) state.timer.pause(reason); },
    resume(reason) { if (state) { state.timer.resume(reason); refreshPauseReasons(); } }
  };
})();
