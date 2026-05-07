// Vercel Serverless Function — Full Airtable ↔ Supabase Contact Sync
// CHUNKED EXECUTION — each call processes one slice (target <8s) so the run
// fits within Vercel Hobby's 10s ceiling AND survives transient slowness.
//
// Lifecycle:
//   POST /api/sync-all
//     → starts a new run. Returns { runId, status: 'running', phase: 'pulling', ... }.
//   POST /api/sync-all?run=<runId>
//     → continues the run; advances ONE chunk; returns updated state.
//   The frontend (settings.html) polls until status ∈ {'success','partial','error'}.
//
// Phases:
//   1. pulling     — fetch next ~5 Airtable pages (≤500 records), look up the
//                    matching Supabase rows via airtable_id IN (...), diff +
//                    write inserts/updates for that slice. Records every
//                    seen Airtable id into airtable_seen_ids.
//   2. archiving   — page through Supabase rows that have an airtable_id,
//                    soft-archive any whose id is NOT in airtable_seen_ids.
//   3. pushing     — page through Supabase rows that have NO airtable_id,
//                    create matching Airtable records, write the new id back.
//   4. done        — mark run final.
//
// Conflict resolution (per agreed defaults — unchanged from monolithic version):
//   Airtable wins:  first_name, last_name, email, company, title, linkedin,
//                   contact_type, status, industry, region, source, notes,
//                   tags, last_contacted, introduced_by
//   Supabase wins:  vip, follow_up_*, needs_follow_up, gaby_notes, enrichment_*
//                   (kept in sync per-record by /api/airtable-sync)

const AIRTABLE_BASE_ID  = 'appVHIMu9xoabpge8';
const AIRTABLE_TABLE_ID = 'tblllCSH6H33t6JVN'; // Network
const AIRTABLE_PAGE_SIZE = 100;
const AIRTABLE_PAGES_PER_CHUNK = 5;            // ≤500 records per call
const SUPABASE_PAGE_SIZE = 1000;               // for archive/push scans
const ARCHIVE_BATCH_PER_CHUNK = 1000;
const PUSH_BATCH_PER_CHUNK    = 100;
const MAX_PARALLEL = 8;
const STALE_LOCK_SECONDS = 600;                // 10 min
const REQUEST_TIMEOUT_MS = 7000;
const MAX_RETRIES = 2;

// ── Field mapping ────────────────────────────────────────────────────────
const AT_TO_SB = {
  'First Name':      'first_name',
  'Last Name':       'last_name',
  'Linkedin':        'linkedin',
  'Email':           'email',
  'Company':         'company',
  'Title':           'title',
  'Contact Type':    'contact_type',
  'Status':          'status',
  'Industry':        'industry',
  'Region':          'region',
  'Source':          'source',
  'Last Contacted':  'last_contacted',
  'Notes':           'notes',
  'Tags':            'tags',
  'Introduced By':   'introduced_by'
};
const SB_TO_AT_FOR_NEW = {
  first_name:    'First Name',
  last_name:     'Last Name',
  linkedin:      'Linkedin',
  email:         'Email',
  company:       'Company',
  title:         'Title',
  contact_type:  'Contact Type',
  industry:      'Industry',
  region:        'Region',
  source:        'Source',
  notes:         'Notes',
  vip:           'VIP',
  gaby_notes:    'Gaby Notes',
  follow_up_date: 'Follow-Up Date',
  follow_up_reason: 'Follow-up reason'
};
const CONTACT_TYPE_AT_TO_SB = {
  'Founder':        'founder',
  'Investor - VC':  'investor',
  'Corporate':      'corporate',
  'Advisor':        'advisor'
};
const CONTACT_TYPE_SB_TO_AT = {
  'founder':   'Founder',
  'investor':  'Investor - VC',
  'corporate': 'Corporate',
  'advisor':   'Advisor'
};

// ── Utils ────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function makeRequestId() {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function fetchWithRetry(url, opts) {
  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
      clearTimeout(timeoutId);
      const transient = resp.status === 429 || resp.status === 502 || resp.status === 503 || resp.status === 504;
      if (transient && attempt < MAX_RETRIES) {
        const ra = resp.headers.get('retry-after');
        const wait = ra && !isNaN(parseFloat(ra)) ? parseFloat(ra) * 1000 : Math.pow(2, attempt) * 400;
        await sleep(wait);
        attempt++;
        continue;
      }
      return resp;
    } catch (e) {
      clearTimeout(timeoutId);
      if (attempt < MAX_RETRIES && (e.name === 'AbortError' || /fetch failed|network/i.test(e.message || ''))) {
        await sleep(Math.pow(2, attempt) * 400);
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

function normaliseForDiff(v, col) {
  if (v === undefined || v === null || v === '') return null;
  if (col === 'email' && typeof v === 'string') return v.trim().toLowerCase();
  if (col === 'tags' && Array.isArray(v)) {
    return v.map(function (x) { return typeof x === 'object' ? (x.name || '') : x; })
            .filter(Boolean).sort();
  }
  if (typeof v === 'string') return v.trim();
  return v;
}
function tagsEqual(a, b) {
  const na = normaliseForDiff(a, 'tags') || [];
  const nb = normaliseForDiff(b, 'tags') || [];
  if (na.length !== nb.length) return false;
  for (let i = 0; i < na.length; i++) if (na[i] !== nb[i]) return false;
  return true;
}

function airtableToSupabasePayload(rec) {
  const f = rec.fields || {};
  const out = {};
  Object.keys(AT_TO_SB).forEach(function (atField) {
    const sbCol = AT_TO_SB[atField];
    let v = f[atField];
    if (v === undefined) { out[sbCol] = null; return; }
    if (atField === 'Contact Type') {
      const name = typeof v === 'object' ? v.name : v;
      out[sbCol] = CONTACT_TYPE_AT_TO_SB[name] !== undefined ? CONTACT_TYPE_AT_TO_SB[name] : 'other';
    } else if (atField === 'Status') {
      const name = typeof v === 'object' ? v.name : v;
      out[sbCol] = name ? String(name).toLowerCase() : null;
    } else if (atField === 'Industry' || atField === 'Region' || atField === 'Source') {
      out[sbCol] = typeof v === 'object' ? (v.name || null) : v;
    } else if (atField === 'Tags') {
      out[sbCol] = Array.isArray(v)
        ? v.map(function (x) { return typeof x === 'object' ? (x.name || '') : x; }).filter(Boolean)
        : [];
    } else if (atField === 'Email' && typeof v === 'string') {
      out[sbCol] = v.trim().toLowerCase();
    } else if (typeof v === 'string') {
      out[sbCol] = v.trim();
    } else {
      out[sbCol] = v;
    }
  });
  return out;
}

function supabaseToAirtableFields(row) {
  const out = {};
  Object.keys(SB_TO_AT_FOR_NEW).forEach(function (sbCol) {
    const atField = SB_TO_AT_FOR_NEW[sbCol];
    let v = row[sbCol];
    if (v === undefined || v === null || v === '') return;
    if (sbCol === 'contact_type') out[atField] = CONTACT_TYPE_SB_TO_AT[v] || null;
    else if (sbCol === 'vip') out[atField] = !!v;
    else out[atField] = v;
  });
  if (row.needs_follow_up !== undefined && row.needs_follow_up !== null) {
    out['Needs Follow Up'] = row.needs_follow_up ? 'Yes' : 'No';
  }
  return out;
}

function computeSupabasePatch(airtableDesired, supabaseRow) {
  const patch = {};
  Object.keys(AT_TO_SB).forEach(function (atField) {
    const sbCol = AT_TO_SB[atField];
    const desired = airtableDesired[sbCol];
    const current = supabaseRow[sbCol];
    let differs;
    if (sbCol === 'tags') differs = !tagsEqual(desired, current);
    else differs = normaliseForDiff(desired, sbCol) !== normaliseForDiff(current, sbCol);
    if (differs) patch[sbCol] = desired;
  });
  return patch;
}

function envSupabase() {
  const url = process.env.SUPABASE_URL || 'https://gxunrnyehltpbgdodkkm.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  return { url: url, key: key };
}

async function pMapBounded(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try { results[i] = await fn(items[i], i); }
      catch (e) { results[i] = { __error: e && e.message || String(e) }; }
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// ── Airtable IO ──────────────────────────────────────────────────────────
async function fetchAirtablePage(apiKey, offset) {
  const url = new URL('https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + AIRTABLE_TABLE_ID);
  url.searchParams.set('pageSize', String(AIRTABLE_PAGE_SIZE));
  if (offset) url.searchParams.set('offset', offset);
  const resp = await fetchWithRetry(url.toString(), { headers: { 'Authorization': 'Bearer ' + apiKey } });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error('Airtable list failed: ' + resp.status + ' ' + t.slice(0, 200));
  }
  const data = await resp.json();
  return { records: data.records || [], offset: data.offset || null };
}

async function createAirtableRecord(apiKey, fields) {
  const resp = await fetchWithRetry(
    'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + AIRTABLE_TABLE_ID,
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: fields, typecast: true })
    }
  );
  if (!resp.ok) throw new Error('CREATE airtable ' + resp.status + ' ' + (await resp.text()).slice(0, 200));
  const data = await resp.json();
  return data.id;
}

// ── Supabase IO ──────────────────────────────────────────────────────────
async function supabaseRowsByAirtableIds(sbUrl, sbKey, airtableIds) {
  if (!airtableIds.length) return [];
  // Postgrest IN syntax: airtable_id=in.(id1,id2,...). Quote each value.
  const inList = airtableIds.map(function (id) { return '"' + id + '"'; }).join(',');
  const url = sbUrl + '/rest/v1/contacts?select=*&airtable_id=in.(' + encodeURIComponent(inList) + ')';
  const resp = await fetchWithRetry(url, {
    headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey }
  });
  if (!resp.ok) throw new Error('Supabase IN query failed: ' + resp.status + ' ' + (await resp.text()).slice(0, 200));
  return resp.json();
}

async function patchSupabaseRow(sbUrl, sbKey, id, patch) {
  const resp = await fetchWithRetry(sbUrl + '/rest/v1/contacts?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: {
      'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify(patch)
  });
  if (!resp.ok) throw new Error('PATCH supabase ' + resp.status + ' ' + (await resp.text()).slice(0, 200));
}

async function insertSupabaseRow(sbUrl, sbKey, row) {
  const resp = await fetchWithRetry(sbUrl + '/rest/v1/contacts', {
    method: 'POST',
    headers: {
      'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify(row)
  });
  if (!resp.ok) throw new Error('INSERT supabase ' + resp.status + ' ' + (await resp.text()).slice(0, 200));
}

async function supabaseCount(sbUrl, sbKey, query) {
  const resp = await fetchWithRetry(sbUrl + '/rest/v1/contacts?select=id&limit=1' + (query ? '&' + query : ''), {
    headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey, 'Prefer': 'count=exact', 'Range': '0-0' }
  });
  if (!resp.ok && resp.status !== 206) return 0;
  const cr = resp.headers.get('content-range') || '';
  return parseInt((cr.split('/')[1] || '0'), 10) || 0;
}

async function supabasePage(sbUrl, sbKey, query, from, size) {
  const to = from + size - 1;
  const resp = await fetchWithRetry(sbUrl + '/rest/v1/contacts?select=*' + (query ? '&' + query : ''), {
    headers: {
      'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey,
      'Range': from + '-' + to
    }
  });
  if (!resp.ok && resp.status !== 206) throw new Error('Supabase page failed: ' + resp.status);
  return resp.json();
}

// ── sync_runs IO ─────────────────────────────────────────────────────────
async function tryAcquireLock(sbUrl, sbKey, trigger, triggeredBy) {
  // Auto-break stale locks
  const cutoff = new Date(Date.now() - STALE_LOCK_SECONDS * 1000).toISOString();
  await fetch(sbUrl + '/rest/v1/sync_runs?status=eq.running&started_at=lt.' + encodeURIComponent(cutoff), {
    method: 'PATCH',
    headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ status: 'error', finished_at: new Date().toISOString(), notes: 'stale lock auto-broken' })
  });
  // Insert fresh running row
  const insertResp = await fetch(sbUrl + '/rest/v1/sync_runs', {
    method: 'POST',
    headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({ trigger: trigger, triggered_by: triggeredBy, status: 'running', phase: 'pulling' })
  });
  if (insertResp.status === 409) return { acquired: false, reason: 'A sync is already running.' };
  if (!insertResp.ok) {
    const t = await insertResp.text();
    return { acquired: false, reason: 'Could not start sync: ' + insertResp.status + ' ' + t.slice(0, 200) };
  }
  const rows = await insertResp.json();
  return { acquired: true, run: rows[0] };
}

async function getRun(sbUrl, sbKey, runId) {
  const resp = await fetch(sbUrl + '/rest/v1/sync_runs?id=eq.' + encodeURIComponent(runId) + '&select=*', {
    headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey }
  });
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows[0] || null;
}

async function updateRun(sbUrl, sbKey, runId, patch) {
  await fetch(sbUrl + '/rest/v1/sync_runs?id=eq.' + encodeURIComponent(runId), {
    method: 'PATCH',
    headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(patch)
  });
}

// ── Phase: pulling ───────────────────────────────────────────────────────
// Pull ≤AIRTABLE_PAGES_PER_CHUNK pages from Airtable starting at run.airtable_offset,
// query Supabase for matching airtable_ids, diff + write inserts/updates.
async function runPullChunk(run, sb, apiKey, requestId) {
  let offset = run.airtable_offset === 'DONE' ? null : run.airtable_offset;
  const startedFromBeginning = !offset && (!run.airtable_seen_ids || run.airtable_seen_ids.length === 0);
  const recsThisChunk = [];
  let pulled = 0;
  let endOfTable = false;

  // 1) Pull a few pages
  for (let p = 0; p < AIRTABLE_PAGES_PER_CHUNK; p++) {
    const page = await fetchAirtablePage(apiKey, offset);
    page.records.forEach(function (r) { recsThisChunk.push(r); });
    pulled += page.records.length;
    offset = page.offset;
    if (!offset) { endOfTable = true; break; }
  }

  // 2) Fetch matching Supabase rows by airtable_id
  const ids = recsThisChunk.map(function (r) { return r.id; });
  const matches = await supabaseRowsByAirtableIds(sb.url, sb.key, ids);
  const sbByAtId = new Map();
  matches.forEach(function (row) { if (row.airtable_id) sbByAtId.set(row.airtable_id, row); });

  // 3) Classify
  const inserts = [];
  const updates = [];
  recsThisChunk.forEach(function (rec) {
    const desired = airtableToSupabasePayload(rec);
    const existing = sbByAtId.get(rec.id);
    if (!existing) {
      const newRow = Object.assign({}, desired, { airtable_id: rec.id });
      if (newRow.status == null) newRow.status = 'active';
      inserts.push({ row: newRow, recId: rec.id });
    } else {
      const patch = computeSupabasePatch(desired, existing);
      if (Object.keys(patch).length > 0) {
        updates.push({ id: existing.id, recId: rec.id, patch: patch });
      }
    }
  });

  // 4) Apply writes (parallel, bounded)
  let chunkInserted = 0, chunkUpdated = 0, chunkFailed = 0;
  const chunkErrors = [];

  await pMapBounded(inserts, MAX_PARALLEL, async function (job) {
    try { await insertSupabaseRow(sb.url, sb.key, job.row); chunkInserted++; }
    catch (e) { chunkFailed++; chunkErrors.push({ type: 'insert_supabase', recordId: job.recId, error: (e && e.message || String(e)).slice(0, 300) }); }
  });
  await pMapBounded(updates, MAX_PARALLEL, async function (job) {
    try { await patchSupabaseRow(sb.url, sb.key, job.id, job.patch); chunkUpdated++; }
    catch (e) { chunkFailed++; chunkErrors.push({ type: 'update_supabase', recordId: job.recId, error: (e && e.message || String(e)).slice(0, 300) }); }
  });

  // 5) Update run state — append to seen_ids and counters
  const newSeenIds = (run.airtable_seen_ids || []).concat(ids);
  const newPhase = endOfTable ? 'archiving' : 'pulling';
  const cumulativeInserted = (run.inserted || 0) + chunkInserted;
  const cumulativeUpdated  = (run.updated  || 0) + chunkUpdated;
  const cumulativeFailed   = (run.failed   || 0) + chunkFailed;
  const newErrorLog = (run.error_log || []).concat(chunkErrors).slice(0, 200);

  const patch = {
    phase: newPhase,
    airtable_offset: endOfTable ? 'DONE' : offset,
    airtable_seen_ids: newSeenIds,
    airtable_total: newSeenIds.length,
    inserted: cumulativeInserted,
    updated: cumulativeUpdated,
    failed: cumulativeFailed,
    error_log: newErrorLog,
    archive_offset: 0,
    push_offset: 0
  };
  if (startedFromBeginning) patch.supabase_total = await supabaseCount(sb.url, sb.key, '');
  await updateRun(sb.url, sb.key, run.id, patch);

  console.log('[sync ' + requestId + '] pull chunk: pulled=' + pulled + ' ins=' + chunkInserted + ' upd=' + chunkUpdated + ' fail=' + chunkFailed + ' nextPhase=' + newPhase);

  return {
    phase: newPhase,
    pulled_this_chunk: pulled,
    chunk_inserted: chunkInserted,
    chunk_updated: chunkUpdated,
    chunk_failed: chunkFailed
  };
}

// ── Phase: archiving ─────────────────────────────────────────────────────
// Page through Supabase rows that have an airtable_id, soft-archive any whose
// id is NOT in airtable_seen_ids and are not already archived.
async function runArchiveChunk(run, sb, requestId) {
  const seenSet = new Set(run.airtable_seen_ids || []);
  const from = run.archive_offset || 0;
  const rows = await supabasePage(sb.url, sb.key, 'airtable_id=not.is.null&status=neq.archived&order=id.asc', from, ARCHIVE_BATCH_PER_CHUNK);
  const toArchive = rows.filter(function (r) { return r.airtable_id && !seenSet.has(r.airtable_id); });

  let chunkArchived = 0, chunkFailed = 0;
  const chunkErrors = [];
  await pMapBounded(toArchive, MAX_PARALLEL, async function (row) {
    try { await patchSupabaseRow(sb.url, sb.key, row.id, { status: 'archived' }); chunkArchived++; }
    catch (e) { chunkFailed++; chunkErrors.push({ type: 'archive_supabase', recordId: row.id, error: (e && e.message || String(e)).slice(0, 300) }); }
  });

  const advancedTo = from + rows.length;
  const reachedEnd = rows.length < ARCHIVE_BATCH_PER_CHUNK;
  const newPhase = reachedEnd ? 'pushing' : 'archiving';

  await updateRun(sb.url, sb.key, run.id, {
    phase: newPhase,
    archive_offset: reachedEnd ? 0 : advancedTo,
    archived: (run.archived || 0) + chunkArchived,
    failed: (run.failed || 0) + chunkFailed,
    error_log: (run.error_log || []).concat(chunkErrors).slice(0, 200)
  });

  console.log('[sync ' + requestId + '] archive chunk: scanned=' + rows.length + ' arch=' + chunkArchived + ' fail=' + chunkFailed + ' nextPhase=' + newPhase);
  return { phase: newPhase, scanned: rows.length, chunk_archived: chunkArchived, chunk_failed: chunkFailed };
}

// ── Phase: pushing ───────────────────────────────────────────────────────
// Page through Supabase rows with airtable_id IS NULL, push to Airtable, write
// the new id back to Supabase.
async function runPushChunk(run, sb, apiKey, requestId) {
  const from = run.push_offset || 0;
  const rows = await supabasePage(sb.url, sb.key, 'airtable_id=is.null&status=neq.archived&order=id.asc', from, PUSH_BATCH_PER_CHUNK);
  const candidates = rows.filter(function (r) { return r.first_name || r.last_name || r.email; });

  let chunkPushed = 0, chunkFailed = 0;
  const chunkErrors = [];

  // Limit Airtable concurrency more — Airtable rate limit is 5 req/sec/base.
  await pMapBounded(candidates, 4, async function (row) {
    try {
      const newAtId = await createAirtableRecord(apiKey, supabaseToAirtableFields(row));
      await patchSupabaseRow(sb.url, sb.key, row.id, { airtable_id: newAtId });
      chunkPushed++;
    } catch (e) {
      chunkFailed++;
      chunkErrors.push({ type: 'push_airtable', recordId: row.id, error: (e && e.message || String(e)).slice(0, 300) });
    }
  });

  const advancedTo = from + rows.length;
  const reachedEnd = rows.length < PUSH_BATCH_PER_CHUNK;
  const newPhase = reachedEnd ? 'done' : 'pushing';

  const patch = {
    phase: newPhase,
    push_offset: reachedEnd ? 0 : advancedTo,
    pushed: (run.pushed || 0) + chunkPushed,
    failed: (run.failed || 0) + chunkFailed,
    error_log: (run.error_log || []).concat(chunkErrors).slice(0, 200)
  };
  if (reachedEnd) {
    const totalAttempted = (run.inserted || 0) + (run.updated || 0) + (run.archived || 0) + (run.pushed || 0) + chunkPushed;
    const totalFailed = (run.failed || 0) + chunkFailed;
    patch.status = totalFailed === 0 ? 'success' : (totalFailed < totalAttempted + totalFailed ? 'partial' : 'error');
    patch.finished_at = new Date().toISOString();
    patch.notes = 'chunked run; airtable_seen=' + ((run.airtable_seen_ids || []).length);
  }
  await updateRun(sb.url, sb.key, run.id, patch);

  console.log('[sync ' + requestId + '] push chunk: scanned=' + rows.length + ' push=' + chunkPushed + ' fail=' + chunkFailed + ' nextPhase=' + newPhase);
  return { phase: newPhase, scanned: rows.length, chunk_pushed: chunkPushed, chunk_failed: chunkFailed, finalStatus: patch.status };
}

// ── Handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://vsdr.vercel.app');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-sync-trigger, x-sync-actor');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const trigger = (req.headers['x-sync-trigger'] || 'manual').toLowerCase();
  if (trigger === 'scheduled') {
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers['authorization'] || '';
    if (!cronSecret || auth !== 'Bearer ' + cronSecret) {
      return res.status(401).json({ ok: false, error: 'Cron auth failed' });
    }
  }

  const requestId = makeRequestId();
  const sb = envSupabase();
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!sb.key || !apiKey) {
    return res.status(500).json({ ok: false, requestId: requestId, error: 'Server env not configured (need SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY and AIRTABLE_API_KEY)' });
  }

  // Continue an existing run? Or start a new one?
  const url = new URL(req.url, 'http://x');
  const continueRunId = url.searchParams.get('run');
  let run;

  try {
    if (continueRunId) {
      run = await getRun(sb.url, sb.key, continueRunId);
      if (!run) return res.status(404).json({ ok: false, requestId: requestId, error: 'Run not found' });
      if (run.status !== 'running') {
        return res.status(200).json({ ok: run.status !== 'error', requestId: requestId, runId: run.id, ...summarise(run) });
      }
    } else {
      const triggeredBy = (req.headers['x-sync-actor'] || (trigger === 'scheduled' ? 'cron' : 'unknown')).toString().slice(0, 200);
      const lock = await tryAcquireLock(sb.url, sb.key, trigger === 'scheduled' ? 'scheduled' : 'manual', triggeredBy);
      if (!lock.acquired) return res.status(409).json({ ok: false, requestId: requestId, error: lock.reason });
      run = lock.run;
      console.log('[sync ' + requestId + '] new run ' + run.id + ' acquired');
    }

    // Dispatch one chunk based on phase
    let chunkResult;
    if (run.phase === 'pulling')          chunkResult = await runPullChunk(run, sb, apiKey, requestId);
    else if (run.phase === 'archiving')   chunkResult = await runArchiveChunk(run, sb, requestId);
    else if (run.phase === 'pushing')     chunkResult = await runPushChunk(run, sb, apiKey, requestId);
    else if (run.phase === 'done')        chunkResult = { phase: 'done' };
    else throw new Error('Unknown phase: ' + run.phase);

    // Re-read for cumulative counts
    const fresh = await getRun(sb.url, sb.key, run.id) || run;
    return res.status(200).json({
      ok: true,
      requestId: requestId,
      runId: run.id,
      ...summarise(fresh),
      chunk: chunkResult
    });
  } catch (e) {
    console.error('[sync ' + requestId + '] fatal:', e && e.message);
    if (run && run.id) {
      await updateRun(sb.url, sb.key, run.id, {
        status: 'error',
        finished_at: new Date().toISOString(),
        error_log: ((run && run.error_log) || []).concat([{ type: 'fatal', error: (e && e.message) || String(e) }]).slice(0, 200),
        notes: 'fatal in ' + (run && run.phase ? run.phase : 'unknown') + ' phase'
      });
    }
    return res.status(500).json({ ok: false, requestId: requestId, runId: run && run.id, error: (e && e.message) || 'Unknown error' });
  }
};

function summarise(run) {
  return {
    status: run.status,
    phase: run.phase,
    airtable_total: run.airtable_total || 0,
    supabase_total: run.supabase_total || 0,
    inserted: run.inserted || 0,
    updated: run.updated || 0,
    archived: run.archived || 0,
    pushed: run.pushed || 0,
    failed: run.failed || 0,
    started_at: run.started_at,
    finished_at: run.finished_at
  };
}
