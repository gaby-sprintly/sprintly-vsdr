// Vercel Serverless Function — Full Airtable ↔ Supabase Contact Sync
//
// POST /api/sync-all
//   Triggered by:
//     - The "Sync Now" button on settings.html (header: x-sync-trigger=manual, x-sync-actor=<email>)
//     - Vercel Cron (header: authorization=Bearer <CRON_SECRET>, x-sync-trigger=scheduled)
//
// Direction (per Phase A defaults):
//   Airtable wins for:  first_name, last_name, email, company, title, linkedin,
//                       contact_type, status, industry, region, source, notes,
//                       tags, last_contacted, introduced_by
//   Supabase wins for:  vip, follow_up_date, follow_up_reason, needs_follow_up,
//                       gaby_notes, enrichment_status, enriched_at
//                       (these are kept in sync per-record by /api/airtable-sync,
//                        so the bulk run does not push them again)
//
// Lifecycle:
//   1. Acquire lock by inserting a sync_runs row with status='running'
//      (unique partial index on status='running' enforces single-flight).
//      Stale lock > 10 min is auto-broken.
//   2. Page through Airtable Network table (100/page).
//   3. Page through Supabase contacts (1000/page) and index by airtable_id.
//   4. Diff: classify each Airtable record as INSERT (no Supabase row) or
//      UPDATE (any Airtable-wins field changed).
//   5. Diff: any Supabase row whose airtable_id is missing from the Airtable
//      payload gets soft-archived (status='archived').
//   6. Diff: any Supabase row with no airtable_id gets pushed to Airtable
//      (creates a new Airtable record), then the new airtable_id is written
//      back to the Supabase row.
//   7. Apply all writes with a parallel batch of MAX_PARALLEL=8.
//      Per-record failures are recorded in sync_runs.error_log but do not
//      abort the run.
//   8. Update sync_runs with final status/counts and return the summary.

const AIRTABLE_BASE_ID = 'appVHIMu9xoabpge8';
const AIRTABLE_TABLE_ID = 'tblllCSH6H33t6JVN'; // Network
const AIRTABLE_PAGE_SIZE = 100;
const SUPABASE_PAGE_SIZE = 1000;
const MAX_PARALLEL = 8;
const STALE_LOCK_SECONDS = 600; // 10 min
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;

// ── Field mapping ────────────────────────────────────────────────────────
// Airtable field name → Supabase column name (Airtable wins)
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

// Supabase column → Airtable field (used only when pushing brand-new Supabase
// contacts up to Airtable). Boolean → "Yes"/"No" handled inline.
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
        const wait = ra && !isNaN(parseFloat(ra)) ? parseFloat(ra) * 1000 : Math.pow(2, attempt) * 500;
        await sleep(wait);
        attempt++;
        continue;
      }
      return resp;
    } catch (e) {
      clearTimeout(timeoutId);
      if (attempt < MAX_RETRIES && (e.name === 'AbortError' || /fetch failed|network/i.test(e.message || ''))) {
        await sleep(Math.pow(2, attempt) * 500);
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

// Normalise values for diff so trivial differences (whitespace, case in email,
// null-vs-empty-string, tag order) don't produce spurious updates.
function normaliseForDiff(v, col) {
  if (v === undefined || v === null || v === '') return null;
  if (col === 'email' && typeof v === 'string') return v.trim().toLowerCase();
  if (col === 'tags' && Array.isArray(v)) {
    return v.map(function (x) { return typeof x === 'object' ? (x.name || '') : x; })
            .filter(Boolean)
            .sort();
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

// Convert one Airtable record to the subset of Supabase columns it owns.
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

// Convert one Supabase row to Airtable fields when CREATING a new Airtable record.
function supabaseToAirtableFields(row) {
  const out = {};
  Object.keys(SB_TO_AT_FOR_NEW).forEach(function (sbCol) {
    const atField = SB_TO_AT_FOR_NEW[sbCol];
    let v = row[sbCol];
    if (v === undefined || v === null || v === '') return;
    if (sbCol === 'contact_type') {
      out[atField] = CONTACT_TYPE_SB_TO_AT[v] || null;
    } else if (sbCol === 'vip') {
      out[atField] = !!v;
    } else {
      out[atField] = v;
    }
  });
  if (row.needs_follow_up !== undefined && row.needs_follow_up !== null) {
    out['Needs Follow Up'] = row.needs_follow_up ? 'Yes' : 'No';
  }
  return out;
}

// Compute the patch to send to Supabase: only "Airtable-wins" cols that differ.
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

// Run a function over a list with bounded concurrency.
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

// ── Airtable & Supabase IO ───────────────────────────────────────────────
async function fetchAllAirtable(apiKey) {
  const out = [];
  let offset = null;
  do {
    const url = new URL('https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + AIRTABLE_TABLE_ID);
    url.searchParams.set('pageSize', String(AIRTABLE_PAGE_SIZE));
    if (offset) url.searchParams.set('offset', offset);
    const resp = await fetchWithRetry(url.toString(), {
      headers: { 'Authorization': 'Bearer ' + apiKey }
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error('Airtable list failed: ' + resp.status + ' ' + t.slice(0, 200));
    }
    const data = await resp.json();
    (data.records || []).forEach(function (r) { out.push(r); });
    offset = data.offset || null;
  } while (offset);
  return out;
}

async function fetchAllSupabase(sbUrl, sbKey) {
  const out = [];
  let from = 0;
  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const resp = await fetchWithRetry(sbUrl + '/rest/v1/contacts?select=*', {
      headers: {
        'apikey': sbKey,
        'Authorization': 'Bearer ' + sbKey,
        'Range': from + '-' + to,
        'Prefer': 'count=exact'
      }
    });
    if (!resp.ok && resp.status !== 206) {
      const t = await resp.text();
      throw new Error('Supabase list failed: ' + resp.status + ' ' + t.slice(0, 200));
    }
    const rows = await resp.json();
    rows.forEach(function (r) { out.push(r); });
    const cr = resp.headers.get('content-range') || '';
    const total = parseInt((cr.split('/')[1] || '0'), 10);
    if (rows.length === 0 || from + rows.length >= total) break;
    from += rows.length;
  }
  return out;
}

async function patchSupabaseRow(sbUrl, sbKey, id, patch) {
  const resp = await fetchWithRetry(sbUrl + '/rest/v1/contacts?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: {
      'apikey': sbKey,
      'Authorization': 'Bearer ' + sbKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(patch)
  });
  if (!resp.ok) throw new Error('PATCH supabase ' + resp.status + ' ' + (await resp.text()).slice(0, 200));
}

async function insertSupabaseRow(sbUrl, sbKey, row) {
  const resp = await fetchWithRetry(sbUrl + '/rest/v1/contacts', {
    method: 'POST',
    headers: {
      'apikey': sbKey,
      'Authorization': 'Bearer ' + sbKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(row)
  });
  if (!resp.ok) throw new Error('INSERT supabase ' + resp.status + ' ' + (await resp.text()).slice(0, 200));
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

// ── Lock / sync_runs IO ──────────────────────────────────────────────────
async function tryAcquireLock(sbUrl, sbKey, trigger, triggeredBy) {
  // First, break any stale lock older than STALE_LOCK_SECONDS.
  const cutoff = new Date(Date.now() - STALE_LOCK_SECONDS * 1000).toISOString();
  await fetch(sbUrl + '/rest/v1/sync_runs?status=eq.running&started_at=lt.' + encodeURIComponent(cutoff), {
    method: 'PATCH',
    headers: {
      'apikey': sbKey,
      'Authorization': 'Bearer ' + sbKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ status: 'error', finished_at: new Date().toISOString(), notes: 'stale lock auto-broken' })
  });

  // Attempt to insert a fresh running row. Unique partial index enforces single-flight.
  const insertResp = await fetch(sbUrl + '/rest/v1/sync_runs', {
    method: 'POST',
    headers: {
      'apikey': sbKey,
      'Authorization': 'Bearer ' + sbKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ trigger: trigger, triggered_by: triggeredBy, status: 'running' })
  });
  if (insertResp.status === 409) return { acquired: false, reason: 'A sync is already running.' };
  if (!insertResp.ok) {
    const t = await insertResp.text();
    return { acquired: false, reason: 'Could not start sync: ' + insertResp.status + ' ' + t.slice(0, 200) };
  }
  const rows = await insertResp.json();
  return { acquired: true, run: rows[0] };
}

async function updateRun(sbUrl, sbKey, runId, patch) {
  await fetch(sbUrl + '/rest/v1/sync_runs?id=eq.' + encodeURIComponent(runId), {
    method: 'PATCH',
    headers: {
      'apikey': sbKey,
      'Authorization': 'Bearer ' + sbKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(patch)
  });
}

// ── Handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Tight CORS — only the production domain
  res.setHeader('Access-Control-Allow-Origin', 'https://vsdr.vercel.app');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-sync-trigger, x-sync-actor');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  // Auth: cron uses CRON_SECRET; manual UI uses no secret but is locked to the
  // app origin via CORS + the unique-running-lock prevents abuse.
  const trigger = (req.headers['x-sync-trigger'] || 'manual').toLowerCase();
  const cronSecret = process.env.CRON_SECRET;
  if (trigger === 'scheduled') {
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

  const triggeredBy = (req.headers['x-sync-actor'] || (trigger === 'scheduled' ? 'cron' : 'unknown')).toString().slice(0, 200);

  // 1. Lock
  const lock = await tryAcquireLock(sb.url, sb.key, trigger === 'scheduled' ? 'scheduled' : 'manual', triggeredBy);
  if (!lock.acquired) {
    return res.status(409).json({ ok: false, requestId: requestId, error: lock.reason });
  }
  const run = lock.run;
  const startedAt = Date.now();
  console.log('[sync-all ' + requestId + '] lock acquired, run=' + run.id);

  const errorLog = [];
  let inserted = 0, updated = 0, archived = 0, pushed = 0, failed = 0;

  try {
    // 2 + 3. Pull both sides in parallel.
    const [airtableRecs, supabaseRows] = await Promise.all([
      fetchAllAirtable(apiKey),
      fetchAllSupabase(sb.url, sb.key)
    ]);
    console.log('[sync-all ' + requestId + '] pulled airtable=' + airtableRecs.length + ' supabase=' + supabaseRows.length);

    await updateRun(sb.url, sb.key, run.id, { airtable_total: airtableRecs.length, supabase_total: supabaseRows.length });

    // Index Supabase by airtable_id (only rows that have one)
    const sbByAirtableId = new Map();
    const sbWithoutAirtable = [];
    supabaseRows.forEach(function (r) {
      if (r.airtable_id) sbByAirtableId.set(r.airtable_id, r);
      else sbWithoutAirtable.push(r);
    });
    const airtableIdSet = new Set(airtableRecs.map(function (r) { return r.id; }));

    // 4. Classify Airtable records → INSERT or UPDATE
    const inserts = [];
    const updates = [];
    airtableRecs.forEach(function (rec) {
      const desired = airtableToSupabasePayload(rec);
      const existing = sbByAirtableId.get(rec.id);
      if (!existing) {
        const newRow = Object.assign({}, desired, { airtable_id: rec.id });
        // Default a few VSDR-managed cols on insert
        if (newRow.status == null) newRow.status = 'active';
        inserts.push({ row: newRow, recId: rec.id });
      } else {
        const patch = computeSupabasePatch(desired, existing);
        if (Object.keys(patch).length > 0) {
          updates.push({ id: existing.id, recId: rec.id, patch: patch });
        }
      }
    });

    // 5. Soft-archive Supabase rows whose airtable_id is gone from Airtable
    const archives = [];
    sbByAirtableId.forEach(function (row, atId) {
      if (!airtableIdSet.has(atId) && row.status !== 'archived') {
        archives.push({ id: row.id, atId: atId });
      }
    });

    // 6. Push Supabase rows that have no airtable_id up to Airtable
    const pushesPlan = sbWithoutAirtable
      .filter(function (r) { return r.first_name || r.last_name || r.email; }) // skip empty stubs
      .map(function (r) { return { sbId: r.id, fields: supabaseToAirtableFields(r) }; });

    console.log('[sync-all ' + requestId + '] plan: insert=' + inserts.length + ' update=' + updates.length + ' archive=' + archives.length + ' push=' + pushesPlan.length);

    // 7a. Apply Supabase INSERTs (parallel)
    const insertResults = await pMapBounded(inserts, MAX_PARALLEL, async function (job) {
      try { await insertSupabaseRow(sb.url, sb.key, job.row); inserted++; return { ok: true }; }
      catch (e) { failed++; errorLog.push({ type: 'insert_supabase', recordId: job.recId, error: e.message }); return { ok: false }; }
    });

    // 7b. Apply Supabase UPDATEs
    await pMapBounded(updates, MAX_PARALLEL, async function (job) {
      try { await patchSupabaseRow(sb.url, sb.key, job.id, job.patch); updated++; return { ok: true }; }
      catch (e) { failed++; errorLog.push({ type: 'update_supabase', recordId: job.recId, error: e.message }); return { ok: false }; }
    });

    // 7c. Apply Supabase ARCHIVEs
    await pMapBounded(archives, MAX_PARALLEL, async function (job) {
      try {
        await patchSupabaseRow(sb.url, sb.key, job.id, { status: 'archived' });
        archived++;
        return { ok: true };
      }
      catch (e) { failed++; errorLog.push({ type: 'archive_supabase', recordId: job.id, error: e.message }); return { ok: false }; }
    });

    // 7d. Apply Airtable PUSH (create + write back airtable_id)
    await pMapBounded(pushesPlan, Math.min(MAX_PARALLEL, 5), async function (job) {
      try {
        const newAtId = await createAirtableRecord(apiKey, job.fields);
        await patchSupabaseRow(sb.url, sb.key, job.sbId, { airtable_id: newAtId });
        pushed++;
        return { ok: true };
      } catch (e) {
        failed++;
        errorLog.push({ type: 'push_airtable', recordId: job.sbId, error: e.message });
        return { ok: false };
      }
    });

    // 8. Finalize
    const status = failed === 0 ? 'success' : (failed < (inserts.length + updates.length + archives.length + pushesPlan.length) ? 'partial' : 'error');
    await updateRun(sb.url, sb.key, run.id, {
      status: status,
      finished_at: new Date().toISOString(),
      inserted: inserted,
      updated: updated,
      archived: archived,
      pushed: pushed,
      failed: failed,
      error_log: errorLog.slice(0, 200), // cap log size
      notes: 'Airtable=' + airtableRecs.length + ' Supabase=' + supabaseRows.length + ' duration=' + (Date.now() - startedAt) + 'ms'
    });

    console.log('[sync-all ' + requestId + '] done status=' + status + ' inserted=' + inserted + ' updated=' + updated + ' archived=' + archived + ' pushed=' + pushed + ' failed=' + failed);

    return res.status(200).json({
      ok: status !== 'error',
      requestId: requestId,
      runId: run.id,
      status: status,
      airtable_total: airtableRecs.length,
      supabase_total: supabaseRows.length,
      inserted: inserted,
      updated: updated,
      archived: archived,
      pushed: pushed,
      failed: failed,
      duration_ms: Date.now() - startedAt
    });
  } catch (e) {
    console.error('[sync-all ' + requestId + '] fatal:', e && e.message);
    await updateRun(sb.url, sb.key, run.id, {
      status: 'error',
      finished_at: new Date().toISOString(),
      inserted: inserted,
      updated: updated,
      archived: archived,
      pushed: pushed,
      failed: failed,
      error_log: errorLog.concat([{ type: 'fatal', error: (e && e.message) || String(e) }]).slice(0, 200),
      notes: 'fatal after ' + (Date.now() - startedAt) + 'ms'
    });
    return res.status(500).json({ ok: false, requestId: requestId, runId: run.id, error: (e && e.message) || 'Unknown error' });
  }
};
