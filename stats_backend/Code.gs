/**
 * Fiction Annotation Stats — Apps Script receiver, version 1.0.0
 *
 * 中文配置说明：
 * - 从 Google Sheet 的“扩展程序 → Apps Script”进入：SPREADSHEET_ID 可留空。
 * - 从 Apps Script 首页新建的独立项目：填入表格网址 /d/ 与 /edit 之间的 ID。
 * - PROJECT_TIME_ZONE 决定每周归属，默认美国中部时间（自动处理夏令时）。
 * - 保存后手动运行 setup() 并完成授权。不会清空已有数据。
 * - 每周手动运行 prepareWeeklyLeaderboard() 生成上一个完整周的草稿；
 *   检查后将该周所有行的 published 改为 TRUE，网站才会读取。
 * - active_seconds / active_minutes 仅保留在 WorkLog，不返回给排行榜。
 * - 此文件是 Google 接收端；编辑器仍需接入部署得到的 /exec 地址。
 *
 * SETUP (run manually in the Apps Script editor):
 * 1. Bound project: leave SPREADSHEET_ID empty. Standalone: paste the Sheet ID.
 * 2. Check PROJECT_TIME_ZONE, save, then run setup() and authorize access.
 * 3. Deploy as a Web app: execute as yourself; choose the permitted access scope.
 * 4. Use the deployed /exec URL in the editor. Keep the spreadsheet private.
 *
 * WEEKLY: run prepareWeeklyLeaderboard() to draft the previous complete week.
 * Review the draft, then set that week's published cells to TRUE. publish_on
 * controls the first local calendar date on which those rows may be returned.
 * No trigger is created, and no draft is published automatically.
 *
 * POST: JSON text, including Content-Type: text/plain. Five counters and active
 * seconds must be integers. Save and retry the EXACT original JSON string.
 * payload_hash = SHA-256(original POST body, UTF-8), lowercase hexadecimal.
 * Receipt GET requires submission_id + payload_hash; it reveals no row data.
 * GET supports health (default), receipt, leaderboard; callback enables JSONP.
 * JSONP is read-only. A dispatched no-cors POST is NOT a confirmed submission.
 *
 * This is a small-team, self-reported statistics receiver, not identity or
 * annotation-quality verification. It does not receive XML or per-item history.
 */
const CONFIG = Object.freeze({
  SPREADSHEET_ID: '',
  PROJECT_TIME_ZONE: 'America/Chicago',
  MAX_BODY_BYTES: 16384,
  MAX_COUNT: 100000,
  MAX_ACTIVE_SECONDS: 604800,
  MAX_SESSION_SPAN_SECONDS: 2678400,
  MAX_FUTURE_SKEW_SECONDS: 300
});

const WORK_HEADERS = Object.freeze([
  'submitted_at', 'week_start', 'editor_name', 'file_name',
  'genders_marked', 'genders_corrected', 'dialogues_identified',
  'dialogues_corrected', 'not_dialogue', 'points', 'active_seconds', 'active_minutes',
  'started_at', 'ended_at', 'editor_id', 'document_id', 'session_id',
  'submission_id', 'payload_hash'
]);
const BOARD_HEADERS = Object.freeze([
  'week_start', 'publish_on', 'published', 'editor_id', 'editor_name',
  'file_name', 'genders_marked', 'genders_corrected', 'dialogues_identified',
  'dialogues_corrected', 'not_dialogue', 'points', 'rank'
]);
const COUNT_FIELDS = Object.freeze([
  'genders_marked', 'genders_corrected', 'dialogues_identified',
  'dialogues_corrected', 'not_dialogue'
]);
const POST_FIELDS = Object.freeze([
  'schema_version', 'submission_id', 'session_id', 'editor_id', 'editor_name',
  'document_id', 'file_name', 'started_at', 'ended_at', 'active_seconds'
].concat(COUNT_FIELDS));

/** Administrator-only initialization. Existing data and sheets are preserved. */
function setup() {
  return withLock_(function () {
    const props = PropertiesService.getScriptProperties();
    let id = CONFIG.SPREADSHEET_ID.trim() || props.getProperty('STATS_SPREADSHEET_ID');
    if (!id) {
      const bound = SpreadsheetApp.getActiveSpreadsheet();
      if (bound) id = bound.getId();
    }
    if (!id) fail_('SETUP_REQUIRED', 'Set CONFIG.SPREADSHEET_ID for a standalone project.');
    Utilities.formatDate(new Date(), CONFIG.PROJECT_TIME_ZONE, 'yyyy-MM-dd');
    const ss = SpreadsheetApp.openById(id);
    const plans = [ ['WorkLog', WORK_HEADERS], ['WeeklyLeaderboard', BOARD_HEADERS] ];
    // Validate every existing sheet before creating or formatting anything.
    plans.forEach(function (p) {
      const sheet = ss.getSheetByName(p[0]);
      if (sheet && sheet.getLastRow()) assertHeaders_(sheet, p[1]);
    });
    plans.forEach(function (p) {
      const sheet = ss.getSheetByName(p[0]) || ss.insertSheet(p[0]);
      ensureCapacity_(sheet, 2, p[1].length);
      if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, p[1].length).setValues([p[1].slice()]);
      sheet.getRange(1, 1, 1, p[1].length).setFontWeight('bold');
      sheet.setFrozenRows(1);
      // Keep identifiers and calendar dates as text. Numeric columns stay numeric.
      p[1].forEach(function (name, i) {
        const numeric = COUNT_FIELDS.indexOf(name) !== -1 ||
          ['points', 'rank', 'active_seconds', 'active_minutes'].indexOf(name) !== -1;
        if (name !== 'published') {
          const format = name === 'active_minutes' ? '0.00' : (numeric ? '0' : '@');
          sheet.getRange(2, i + 1, sheet.getMaxRows() - 1, 1).setNumberFormat(format);
        }
      });
    });
    SpreadsheetApp.flush();
    props.setProperties({
      STATS_SPREADSHEET_ID: id,
      STATS_TIME_ZONE: CONFIG.PROJECT_TIME_ZONE,
      STATS_SCHEMA_VERSION: '1'
    });
    const result = { ok: true, sheets: plans.map(function (p) { return p[0]; }),
      time_zone: CONFIG.PROJECT_TIME_ZONE };
    Logger.log(JSON.stringify(result));
    return result;
  });
}

/** Public writes are confined to this route. Callback and admin actions are absent. */
function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (typeof raw !== 'string' || !raw.length) fail_('INVALID_JSON', 'A JSON request body is required.');
    if (raw.length > CONFIG.MAX_BODY_BYTES ||
        Utilities.newBlob(raw).getBytes().length > CONFIG.MAX_BODY_BYTES) {
      fail_('BODY_TOO_LARGE', 'The statistics request is too large.');
    }
    let body;
    try { body = JSON.parse(raw); } catch (_) { fail_('INVALID_JSON', 'The request body must be valid JSON.'); }
    const record = validateRecord_(body, new Date());
    const hash = sha256_(raw);
    const result = withLock_(function () {
      const context = context_();
      const sheet = checkedSheet_(context.ss, 'WorkLog', WORK_HEADERS);
      const existing = findSubmission_(sheet, record.submission_id);
      if (existing) {
        if (existing.payload_hash !== hash) fail_('CONFLICT', 'This submission ID was used with a different request body.');
        return { ok: true, status: 'duplicate', submission_id: record.submission_id, payload_hash: hash };
      }
      record.submitted_at = new Date().toISOString();
      record.week_start = weekStart_(new Date(record.ended_at), context.timeZone);
      record.payload_hash = hash;
      record.points = sumCounts_(record);
      record.active_minutes = Math.round(record.active_seconds / 60 * 100) / 100;
      appendRows_(sheet, [WORK_HEADERS.map(function (key) { return safeCell_(record[key]); })]);
      SpreadsheetApp.flush();
      return { ok: true, status: 'stored', submission_id: record.submission_id, payload_hash: hash };
    });
    return response_(result);
  } catch (error) {
    return response_(publicError_(error));
  }
}

/** Public reads never initialize, modify, or publish spreadsheet data. */
function doGet(e) {
  const params = (e && e.parameter) || {};
  const hasCallback = Object.prototype.hasOwnProperty.call(params, 'callback');
  const callback = hasCallback ? params.callback : null;
  if (hasCallback && !validCallback_(callback)) {
    return response_({ ok: false, error: 'INVALID_CALLBACK', message: 'Use a single JavaScript callback identifier.' });
  }
  try {
    const action = params.action || 'health';
    let result;
    if (action === 'health') {
      result = { ok: true, service: 'fiction-annotation-stats', version: '1.0.0',
        configured: Boolean(PropertiesService.getScriptProperties().getProperty('STATS_SPREADSHEET_ID')) };
    } else if (action === 'receipt') {
      result = receipt_(params);
    } else if (action === 'leaderboard') {
      result = leaderboard_();
    } else {
      fail_('UNKNOWN_ACTION', 'Supported read actions are health, receipt, and leaderboard.');
    }
    return response_(result, callback);
  } catch (error) {
    return response_(publicError_(error), callback);
  }
}

/** Admin-only: append an unpublished draft for the last complete local week. */
function prepareWeeklyLeaderboard() {
  return withLock_(function () {
    const context = context_();
    const targetWeek = shiftDate_(weekStart_(new Date(), context.timeZone), -7);
    const board = checkedSheet_(context.ss, 'WeeklyLeaderboard', BOARD_HEADERS);
    const existing = readObjects_(board, BOARD_HEADERS);
    if (existing.some(function (r) { return dateCell_(r.week_start, context.sheetTimeZone) === targetWeek; })) {
      const unchanged = { ok: true, status: 'already_exists', week_start: targetWeek,
        message: 'Existing draft or published rows were preserved.' };
      Logger.log(JSON.stringify(unchanged));
      return unchanged;
    }
    const work = checkedSheet_(context.ss, 'WorkLog', WORK_HEADERS);
    const groups = Object.create(null);
    const seenSubmissions = Object.create(null);
    readObjects_(work, WORK_HEADERS).forEach(function (row) {
      if (dateCell_(row.week_start, context.sheetTimeZone) !== targetWeek) return;
      const sid = submissionId_(row.submission_id);
      if (seenSubmissions[sid]) fail_('INVALID_WORKLOG', 'WorkLog contains duplicate submission IDs.');
      seenSubmissions[sid] = true;
      const id = identifier_(row.editor_id, 'editor_id');
      if (!groups[id]) {
        groups[id] = { editor_id: id, editor_name: '', file_name: '', _files: [], _lastEnd: '' };
        COUNT_FIELDS.forEach(function (key) { groups[id][key] = 0; });
      }
      const group = groups[id];
      COUNT_FIELDS.forEach(function (key) { group[key] += integer_(row[key], key, CONFIG.MAX_COUNT); });
      const filename = text_(row.file_name, 'file_name', 255);
      if (group._files.indexOf(filename) === -1) group._files.push(filename);
      const endedAt = isoTime_(row.ended_at, 'ended_at');
      if (endedAt >= group._lastEnd) {
        group.editor_name = text_(row.editor_name, 'editor_name', 100);
        group._lastEnd = endedAt;
      }
    });
    const entries = Object.keys(groups).map(function (id) {
      const g = groups[id];
      g.file_name = g._files.sort().join(' | ');
      g.points = sumCounts_(g);
      return g;
    });
    rankEntries_(entries);
    if (entries.length) {
      appendRows_(board, entries.map(function (entry) {
        entry.week_start = targetWeek;
        entry.publish_on = shiftDate_(targetWeek, 7);
        entry.published = false;
        return BOARD_HEADERS.map(function (key) { return safeCell_(entry[key]); });
      }));
      SpreadsheetApp.flush();
    }
    const result = { ok: true, status: entries.length ? 'draft_created' : 'no_records',
      week_start: targetWeek, editors: entries.length, published: false };
    Logger.log(JSON.stringify(result));
    return result;
  });
}

function receipt_(params) {
  const id = submissionId_(params.submission_id);
  const hash = params.payload_hash;
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
    fail_('INVALID_HASH', 'A lowercase SHA-256 payload_hash is required.');
  }
  const context = context_();
  const found = findSubmission_(checkedSheet_(context.ss, 'WorkLog', WORK_HEADERS), id);
  return { ok: true, received: Boolean(found && found.payload_hash === hash),
    conflict: Boolean(found && found.payload_hash !== hash) };
}

function leaderboard_() {
  const context = context_();
  const today = Utilities.formatDate(new Date(), context.timeZone, 'yyyy-MM-dd');
  const rows = readObjects_(checkedSheet_(context.ss, 'WeeklyLeaderboard', BOARD_HEADERS), BOARD_HEADERS);
  const eligible = rows.filter(function (row) {
    if (!(row.published === true || String(row.published).toUpperCase() === 'TRUE')) return false;
    const week = dateCell_(row.week_start, context.sheetTimeZone);
    const date = dateCell_(row.publish_on, context.sheetTimeZone);
    if (!week || !date || new Date(week + 'T00:00:00Z').getUTCDay() !== 1) {
      fail_('LEADERBOARD_CONFIG', 'A published row has an invalid week_start or publish_on date.');
    }
    // A completed week's board can never be exposed before its week has ended.
    return date <= today && shiftDate_(week, 7) <= today;
  });
  if (!eligible.length) return { ok: true, week_start: null, week_end: null, entries: [] };
  const latestWeek = eligible.map(function (r) { return dateCell_(r.week_start, context.sheetTimeZone); }).sort().pop();
  const seen = Object.create(null);
  const entries = eligible.filter(function (r) {
    return dateCell_(r.week_start, context.sheetTimeZone) === latestWeek;
  }).map(function (row) {
    const id = identifier_(row.editor_id, 'editor_id');
    if (seen[id]) fail_('LEADERBOARD_CONFIG', 'A published week has duplicate editor rows.');
    seen[id] = true;
    const entry = { editor_name: text_(row.editor_name, 'editor_name', 100),
      file_name: text_(row.file_name, 'file_name', 2000) };
    COUNT_FIELDS.forEach(function (key) { entry[key] = integer_(row[key], key, Number.MAX_SAFE_INTEGER / 10); });
    entry.points = sumCounts_(entry);
    return entry;
  });
  rankEntries_(entries);
  return { ok: true, week_start: latestWeek, week_end: shiftDate_(latestWeek, 6), entries: entries };
}

function validateRecord_(body, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail_('INVALID_RECORD', 'A JSON object is required.');
  if (Object.keys(body).some(function (key) { return POST_FIELDS.indexOf(key) === -1; })) {
    fail_('INVALID_FIELD', 'The request contains an unsupported field.');
  }
  if (body.schema_version !== undefined && body.schema_version !== 1) fail_('INVALID_SCHEMA', 'Use schema_version 1.');
  const record = {
    submission_id: submissionId_(body.submission_id),
    session_id: identifier_(body.session_id, 'session_id'),
    editor_id: identifier_(body.editor_id, 'editor_id'),
    editor_name: text_(body.editor_name, 'editor_name', 100),
    document_id: identifier_(body.document_id, 'document_id'),
    file_name: text_(body.file_name, 'file_name', 255),
    started_at: isoTime_(body.started_at, 'started_at'),
    ended_at: isoTime_(body.ended_at, 'ended_at'),
    active_seconds: integer_(body.active_seconds, 'active_seconds', CONFIG.MAX_ACTIVE_SECONDS)
  };
  COUNT_FIELDS.forEach(function (key) { record[key] = integer_(body[key], key, CONFIG.MAX_COUNT); });
  const start = Date.parse(record.started_at), end = Date.parse(record.ended_at);
  const span = (end - start) / 1000;
  if (span < 0 || span > CONFIG.MAX_SESSION_SPAN_SECONDS) fail_('INVALID_TIME_RANGE', 'Work timestamps have an invalid range.');
  if (end > now.getTime() + CONFIG.MAX_FUTURE_SKEW_SECONDS * 1000) fail_('FUTURE_TIME', 'Work end time is too far in the future.');
  if (record.active_seconds > Math.ceil(span) + 5) fail_('INVALID_DURATION', 'Active time exceeds the work interval.');
  return record;
}

function context_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('STATS_SPREADSHEET_ID');
  const timeZone = props.getProperty('STATS_TIME_ZONE');
  if (!id || !timeZone || props.getProperty('STATS_SCHEMA_VERSION') !== '1') {
    fail_('NOT_CONFIGURED', 'The administrator must run setup() in the script editor.');
  }
  const ss = SpreadsheetApp.openById(id);
  return { ss: ss, timeZone: timeZone, sheetTimeZone: ss.getSpreadsheetTimeZone() };
}

function checkedSheet_(ss, name, headers) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) fail_('SCHEMA_MISMATCH', 'A required statistics sheet is missing.');
  assertHeaders_(sheet, headers);
  return sheet;
}

function assertHeaders_(sheet, headers) {
  if (!sheet.getLastRow() || sheet.getLastColumn() !== headers.length) {
    fail_('SCHEMA_MISMATCH', 'The statistics sheet headers do not match this script. Existing data was preserved.');
  }
  const actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (headers.some(function (h, i) { return actual[i] !== h; })) {
    fail_('SCHEMA_MISMATCH', 'The statistics sheet headers do not match this script. Existing data was preserved.');
  }
}

function findSubmission_(sheet, id) {
  if (sheet.getLastRow() < 2) return null;
  const column = WORK_HEADERS.indexOf('submission_id') + 1;
  const match = sheet.getRange(2, column, sheet.getLastRow() - 1, 1)
    .createTextFinder(id).matchEntireCell(true).useRegularExpression(false).findNext();
  if (!match) return null;
  return { payload_hash: sheet.getRange(match.getRow(), WORK_HEADERS.indexOf('payload_hash') + 1).getValues()[0][0] };
}

function readObjects_(sheet, headers) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .filter(function (row) { return row.some(function (v) { return v !== ''; }); })
    .map(function (row) {
      const result = {};
      headers.forEach(function (h, i) { result[h] = row[i]; });
      return result;
    });
}

function appendRows_(sheet, rows) {
  if (!rows.length) return;
  const firstRow = sheet.getLastRow() + 1;
  ensureCapacity_(sheet, firstRow + rows.length - 1, rows[0].length);
  sheet.getRange(firstRow, 1, rows.length, rows[0].length).setValues(rows);
}

function ensureCapacity_(sheet, rows, columns) {
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < columns) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail_('BUSY', 'The receiver is busy. Retry this same submission later.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function submissionId_(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) {
    fail_('INVALID_SUBMISSION_ID', 'Use a randomly generated UUID v4 submission_id.');
  }
  return value.toLowerCase();
}

function identifier_(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    fail_('INVALID_FIELD', field + ' must be a stable identifier of at most 128 characters.');
  }
  return value;
}

function text_(value, field, maxLength) {
  if (typeof value !== 'string') fail_('INVALID_FIELD', field + ' must be text.');
  const text = value.trim();
  if (!text.length || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    fail_('INVALID_FIELD', field + ' has an invalid length or control character.');
  }
  return text;
}

function integer_(value, field, max) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) {
    fail_('INVALID_FIELD', field + ' must be a nonnegative integer within the allowed limit.');
  }
  return value;
}

function isoTime_(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    fail_('INVALID_TIME', field + ' must be a UTC ISO timestamp.');
  }
  const expected = value.length === 20 ? value.replace('Z', '.000Z') : value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== expected) {
    fail_('INVALID_TIME', field + ' is not a valid calendar timestamp.');
  }
  return date.toISOString();
}

function dateCell_(value, sheetTimeZone) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    // A native date cell denotes its displayed calendar date in the Sheet's zone.
    return Utilities.formatDate(value, sheetTimeZone, 'yyyy-MM-dd');
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
}

function weekStart_(date, timeZone) {
  const localDate = Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
  const weekday = new Date(localDate + 'T00:00:00Z').getUTCDay();
  return shiftDate_(localDate, -((weekday + 6) % 7));
}

function shiftDate_(date, days) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function sumCounts_(record) {
  const total = COUNT_FIELDS.reduce(function (n, key) { return n + record[key]; }, 0);
  if (!Number.isSafeInteger(total)) fail_('INVALID_TOTAL', 'The combined count is outside the supported range.');
  return total;
}

function rankEntries_(entries) {
  entries.sort(function (a, b) {
    return b.points - a.points || a.editor_name.localeCompare(b.editor_name) || a.file_name.localeCompare(b.file_name);
  });
  entries.forEach(function (entry, i) {
    entry.rank = i && entry.points === entries[i - 1].points ? entries[i - 1].rank : i + 1;
  });
}

function safeCell_(value) {
  // An apostrophe keeps untrusted strings from being interpreted as formulas.
  return typeof value === 'string' && /^[=+\-@']/.test(value) ? "'" + value : value;
}

function sha256_(raw) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function validCallback_(value) {
  return typeof value === 'string' && /^[A-Za-z_$][0-9A-Za-z_$]{0,79}$/.test(value) &&
    !/^(?:null|true|false|this|new|delete|typeof|void|return|throw|if|else|for|while|do|switch|case|default|try|catch|finally|function|class|const|let|var|import|export|await|yield|break|continue|super|with|in|instanceof|enum|extends|debugger|implements|interface|package|private|protected|public|static)$/.test(value);
}

function response_(body, callback) {
  const json = JSON.stringify(body).replace(/[<>&\u2028\u2029]/g, function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
  return ContentService.createTextOutput(callback ? callback + '(' + json + ');' : json)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function fail_(code, message) {
  const error = new Error(message);
  error.apiCode = code;
  throw error;
}

function publicError_(error) {
  if (error && error.apiCode) return { ok: false, error: error.apiCode, message: error.message };
  Logger.log('Statistics receiver encountered an internal service error.');
  return { ok: false, error: 'INTERNAL_ERROR', message: 'The statistics service could not complete the request. Retry later.' };
}
