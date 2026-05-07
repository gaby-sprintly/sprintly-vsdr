// Vercel Serverless Function — Contact Ingestion
//
// POST /api/ingest-contacts
//   Accepts contact rows from the ingestion page (CSV/manual/bulk) and:
//     1. Validates each row (email format, allowed fields, required dedup key)
//     2. Dedupes WITHIN the upload (e.g. same email appears twice in a CSV)
//     3. Dedupes AGAINST EXISTING Supabase rows (case-insensitive email,
//        and optionally LinkedIn URL)
//     4. Inserts net-new rows in parallel batches via the service-role key
//        (bypasses RLS so the anon-key UI can't write directly)
//     5. Optionally pushes each new row up to Airtable and writes the new
//        airtable_id back to Supabase
//     6. Records the run in import_runs for audit + history UI
//
// Body:
// {
//   "source": "csv" | "manual" | "bulk",
//   "rows": [{ "email": "…", "first_name": "…", … }],
//   "dedup_by": ["email"] | ["email","linkedin"],   // default ["email"]
//   "push_to_airtable": true,                        // default true
//   "dry_run": false                                 // default false; if true, returns the dedup decision without writing
// }
//
// Response (200 even on partial failure; 4xx/5xx for hard failures):
// {
//   ok, requestId, runId,
//   status: "success" | "partial" | "error",
//   inserted: int,
//   skipped_duplicate: int,
//   skipped_invalid: int,
//   failed: int,
//   pushed_to_airtable: int,
//   duplicates: [{email, existing_id}],   // (preview-friendly summary, capped)
//   invalids:   [{row_index, email?, errors[]}],
//   errors:     [{type, row_index?, email?, error}]
// }

const AIRTABLE_BASE_ID  = 'appVHIMu9xoabpge8';
const AIRTABLE_TABLE_ID = 'tblllCSH6H33t6JVN'; // Network
const MAX_PARALLEL_INSERTS  = 8;
const MAX_PARALLEL_AIRTABLE = 4;       // Airtable rate limit ≈ 5 req/sec/base
const MAX_ROWS_PER_REQUEST  = 5000;    // hard cap; UI should chunk larger uploads
const REQUEST_TIMEOUT_MS    = 7000;
const MAX_RETRIES           = 2;

const ALLOWED_FIELDS = [
  'first_name', 'last_name', 'email', 'phone', 'company', 'title', 'linkedin',
  'industry', 'region', 'contact_type', 'tags', 'status', 'source', 'notes',
  'vip', 'gaby_notes', 'introduced_by', 'last_contacted'
];
const VALID_DEDUP_KEYS = ['email', 'linkedin'];
const VALID_STATUSES   = ['active', 'inactive', 'prospect', 'archived'];
const VALID_TYPES      = ['founder', 'investor', 'corporate', 'advisor', 'government', 'other'];

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
      catch (e) { results[i] = { __error: (e && e.message) || String(e) }; }
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// ── Row cleaning + validation ────────────────────────────────────────────
function isEmail(s) { return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

function cleanRow(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  Object.keys(raw).forEach(function (k) {
    if (ALLOWED_FIELDS.indexOf(k) === -1) return;
    let v = raw[k];
    if (v === undefined || v === null) return;

    if (k === 'email') {
      if (typeof v !== 'string') return;
      v = v.trim().toLowerCase();
    } else if (k === 'tags') {
      if (Array.isArray(v)) v = v.map(function (x) { return typeof x === 'string' ? x.trim() : ''; }).filter(Boolean);
      else if (typeof v === 'string') v = v.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      else v = [];
    } else if (k === 'vip') {
      v = (v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1' || v === 'yes' || v === 'Yes');
    } else if (k === 'contact_type') {
      if (typeof v === 'string') v = v.trim().toLowerCase();
      if (VALID_TYPES.indexOf(v) === -1) v = 'other';
    } else if (k === 'status') {
      if (typeof v === 'string') v = v.trim().toLowerCase();
      if (VALID_STATUSES.indexOf(v) === -1) v = 'active';
    } else if (typeof v === 'string') {
      v = v.trim();
    }

    if (v === '' || (Array.isArray(v) && !v.length)) return;
    out[k] = v;
  });
  // Default status if missing
  if (!out.status) out.status = 'active';
  return out;
}

function validateRow(row, dedupKeys) {
  const errors = [];
  const hasDedupKey = dedupKeys.some(function (k) { return row[k]; });
  if (!hasDedupKey) errors.push('Missing required field for dedup: ' + dedupKeys.join(' or '));
  if (row.email && !isEmail(row.email)) errors.push('Invalid email format');
  if (row.linkedin && typeof row.linkedin === 'string') {
    // Loose check — LinkedIn URLs vary a lot
    if (!/linkedin\.com\//i.test(row.linkedin) && !/^https?:\/\//i.test(row.linkedin)) {
      // accept handles too — only flag obviously broken
    }
  }
  if (!row.first_name && !row.last_name && !row.email) errors.push('Need at least first_name, last_name, or email');
  return errors;
}

// ── Supabase IO ──────────────────────────────────────────────────────────
async function findExistingByDedup(sb, emails, linkedins) {
  // Postgrest IN with quoted strings to handle weird chars.
  const filters = [];
  if (emails.length) {
    const inList = emails.map(function (v) { return '"' + v.replace(/"/g, '\\"') + '"'; }).join(',');
    filters.push('email=in.(' + encodeURIComponent(inList) + ')');
  }
  if (linkedins.length) {
    const inList = linkedins.map(function (v) { return '"' + v.replace(/"/g, '\\"') + '"'; }).join(',');
    filters.push('linkedin=in.(' + encodeURIComponent(inList) + ')');
  }
  if (!filters.length) return [];
  // Fetch in TWO queries (one per field) and merge; OR via Postgrest is finicky with IN.
  const results = [];
  for (let i = 0; i < filters.length; i++) {
    const url = sb.url + '/rest/v1/contacts?select=id,email,linkedin&' + filters[i];
    const resp = await fetchWithRetry(url, {
      headers: { 'apikey': sb.key, 'Authorization': 'Bearer ' + sb.key }
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error('Dedup lookup failed: ' + resp.status + ' ' + t.slice(0, 200));
    }
    const rows = await resp.json();
    rows.forEach(function (r) { results.push(r); });
  }
  return results;
}

async function insertSupabaseRow(sb, row) {
  const resp = await fetchWithRetry(sb.url + '/rest/v1/contacts', {
    method: 'POST',
    headers: {
      'apikey': sb.key, 'Authorization': 'Bearer ' + sb.key,
      'Content-Type': 'application/json', 'Prefer': 'return=representation'
    },
    body: JSON.stringify(row)
  });
  if (!resp.ok) throw new Error('INSERT supabase ' + resp.status + ' ' + (await resp.text()).slice(0, 200));
  const rows = await resp.json();
  return rows[0];
}

async function patchSupabaseRow(sb, id, patch) {
  const resp = await fetchWithRetry(sb.url + '/rest/v1/contacts?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: {
      'apikey': sb.key, 'Authorization': 'Bearer ' + sb.key,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify(patch)
  });
  if (!resp.ok) throw new Error('PATCH supabase ' + resp.status + ' ' + (await resp.text()).slice(0, 200));
}

// ── Airtable IO ──────────────────────────────────────────────────────────
function supabaseToAirtableFields(row) {
  const out = {};
  if (row.first_name) out['First Name'] = row.first_name;
  if (row.last_name)  out['Last Name']  = row.last_name;
  if (row.email)      out['Email']      = row.email;
  if (row.linkedin)   out['Linkedin']   = row.linkedin;
  if (row.company)    out['Company']    = row.company;
  if (row.title)      out['Title']      = row.title;
  if (row.industry)   out['Industry']   = row.industry;
  if (row.region)     out['Region']     = row.region;
  if (row.source)     out['Source']     = row.source;
  if (row.notes)      out['Notes']      = row.notes;
  if (row.gaby_notes) out['Gaby Notes'] = row.gaby_notes;
  if (row.introduced_by) out['Introduced By'] = row.introduced_by;
  if (row.contact_type && CONTACT_TYPE_SB_TO_AT[row.contact_type]) {
    out['Contact Type'] = CONTACT_TYPE_SB_TO_AT[row.contact_type];
  }
  if (row.vip !== undefined) out['VIP'] = !!row.vip;
  return out;
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

// ── import_runs IO ───────────────────────────────────────────────────────
async function createRun(sb, source, triggeredBy, attempted) {
  const resp = await fetch(sb.url + '/rest/v1/import_runs', {
    method: 'POST',
    headers: {
      'apikey': sb.key, 'Authorization': 'Bearer ' + sb.key,
      'Content-Type': 'application/json', 'Prefer': 'return=representation'
    },
    body: JSON.stringify({ source: source, triggered_by: triggeredBy, status: 'running', rows_attempted: attempted })
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error('Could not create import_run: ' + resp.status + ' ' + t.slice(0, 200));
  }
  const rows = await resp.json();
  return rows[0];
}

async function finaliseRun(sb, runId, patch) {
  await fetch(sb.url + '/rest/v1/import_runs?id=eq.' + encodeURIComponent(runId), {
    method: 'PATCH',
    headers: {
      'apikey': sb.key, 'Authorization': 'Bearer ' + sb.key,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify(patch)
  });
}

// ── Handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://vsdr.vercel.app');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ingest-actor');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const requestId = makeRequestId();
  const sb = envSupabase();
  if (!sb.key) {
    return res.status(500).json({ ok: false, requestId: requestId, error: 'Server env not configured (need SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY)' });
  }

  const body = req.body || {};
  const source = (body.source || 'csv').toLowerCase();
  if (['csv', 'manual', 'bulk'].indexOf(source) === -1) {
    return res.status(400).json({ ok: false, requestId: requestId, error: 'source must be one of csv|manual|bulk' });
  }
  const rawRows = Array.isArray(body.rows) ? body.rows : null;
  if (!rawRows || !rawRows.length) {
    return res.status(400).json({ ok: false, requestId: requestId, error: 'rows must be a non-empty array' });
  }
  if (rawRows.length > MAX_ROWS_PER_REQUEST) {
    return res.status(400).json({ ok: false, requestId: requestId, error: 'Too many rows in one request. Max ' + MAX_ROWS_PER_REQUEST + '. Split your upload.' });
  }

  // Validate dedup_by
  const dedupBy = Array.isArray(body.dedup_by) && body.dedup_by.length
    ? body.dedup_by.filter(function (k) { return VALID_DEDUP_KEYS.indexOf(k) !== -1; })
    : ['email'];
  if (!dedupBy.length) return res.status(400).json({ ok: false, requestId: requestId, error: 'dedup_by must include at least one of: ' + VALID_DEDUP_KEYS.join(', ') });

  const pushToAirtable = body.push_to_airtable !== false;
  const dryRun = body.dry_run === true;
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (pushToAirtable && !apiKey && !dryRun) {
    return res.status(500).json({ ok: false, requestId: requestId, error: 'push_to_airtable requested but AIRTABLE_API_KEY env not set' });
  }
  const triggeredBy = (req.headers['x-ingest-actor'] || 'unknown').toString().slice(0, 200);

  // 1. Clean + validate
  const cleaned = [];
  const invalids = [];
  rawRows.forEach(function (raw, idx) {
    const c = cleanRow(raw);
    const errors = validateRow(c, dedupBy);
    if (errors.length) {
      invalids.push({ row_index: idx, email: c.email || null, errors: errors });
    } else {
      cleaned.push({ row_index: idx, row: c });
    }
  });

  // 2. Dedupe within batch (first occurrence wins)
  const seenEmail = new Set();
  const seenLinkedin = new Set();
  const internalDuplicates = [];
  const uniqueClean = [];
  cleaned.forEach(function (c) {
    let isDup = false;
    if (dedupBy.indexOf('email') !== -1 && c.row.email) {
      if (seenEmail.has(c.row.email)) isDup = true;
      else seenEmail.add(c.row.email);
    }
    if (dedupBy.indexOf('linkedin') !== -1 && c.row.linkedin) {
      if (seenLinkedin.has(c.row.linkedin)) isDup = true;
      else seenLinkedin.add(c.row.linkedin);
    }
    if (isDup) internalDuplicates.push({ row_index: c.row_index, email: c.row.email || null, reason: 'duplicate within upload' });
    else uniqueClean.push(c);
  });

  // 3. Dedupe against existing Supabase rows
  const emailsToCheck    = dedupBy.indexOf('email') !== -1    ? Array.from(seenEmail)    : [];
  const linkedinsToCheck = dedupBy.indexOf('linkedin') !== -1 ? Array.from(seenLinkedin) : [];

  let existingRows = [];
  try {
    if (emailsToCheck.length || linkedinsToCheck.length) {
      existingRows = await findExistingByDedup(sb, emailsToCheck, linkedinsToCheck);
    }
  } catch (e) {
    console.error('[ingest ' + requestId + '] dedup query failed:', e && e.message);
    return res.status(500).json({ ok: false, requestId: requestId, error: 'Dedup lookup failed: ' + (e && e.message || 'unknown') });
  }
  const existingByEmail    = new Map();
  const existingByLinkedin = new Map();
  existingRows.forEach(function (r) {
    if (r.email)    existingByEmail.set(r.email.toLowerCase(), r.id);
    if (r.linkedin) existingByLinkedin.set(r.linkedin, r.id);
  });

  const dbDuplicates = [];
  const toInsert = [];
  uniqueClean.forEach(function (c) {
    let dupId = null;
    if (dedupBy.indexOf('email') !== -1 && c.row.email && existingByEmail.has(c.row.email)) {
      dupId = existingByEmail.get(c.row.email);
    } else if (dedupBy.indexOf('linkedin') !== -1 && c.row.linkedin && existingByLinkedin.has(c.row.linkedin)) {
      dupId = existingByLinkedin.get(c.row.linkedin);
    }
    if (dupId) dbDuplicates.push({ row_index: c.row_index, email: c.row.email || null, existing_id: dupId });
    else toInsert.push(c);
  });

  // Dry-run short-circuit: return decisions, write nothing.
  if (dryRun) {
    return res.status(200).json({
      ok: true,
      requestId: requestId,
      dry_run: true,
      attempted: rawRows.length,
      would_insert: toInsert.length,
      would_skip_duplicate: internalDuplicates.length + dbDuplicates.length,
      would_skip_invalid: invalids.length,
      duplicates: internalDuplicates.concat(dbDuplicates).slice(0, 50),
      invalids: invalids.slice(0, 50),
      sample_to_insert: toInsert.slice(0, 5).map(function (c) { return c.row; })
    });
  }

  // 4. Create import_runs row (status='running')
  let run;
  try {
    run = await createRun(sb, source, triggeredBy, rawRows.length);
  } catch (e) {
    return res.status(500).json({ ok: false, requestId: requestId, error: 'Could not create import_run: ' + (e && e.message) });
  }

  // 5. Insert in parallel (capture each new id for Airtable push)
  const errors = [];
  const insertedRows = [];
  let inserted = 0, failed = 0;

  await pMapBounded(toInsert, MAX_PARALLEL_INSERTS, async function (job) {
    try {
      const created = await insertSupabaseRow(sb, job.row);
      inserted++;
      insertedRows.push({ row_index: job.row_index, supabaseId: created.id, row: created });
    } catch (e) {
      failed++;
      errors.push({ type: 'insert_supabase', row_index: job.row_index, email: job.row.email || null, error: ((e && e.message) || String(e)).slice(0, 300) });
    }
  });

  // 6. Push to Airtable for each successful insert
  let pushed = 0;
  if (pushToAirtable && apiKey) {
    await pMapBounded(insertedRows, MAX_PARALLEL_AIRTABLE, async function (item) {
      try {
        const fields = supabaseToAirtableFields(item.row);
        if (!Object.keys(fields).length) return;
        const newAtId = await createAirtableRecord(apiKey, fields);
        await patchSupabaseRow(sb, item.supabaseId, { airtable_id: newAtId });
        pushed++;
      } catch (e) {
        // Don't increment failed — the contact IS in Supabase. The next sync's
        // pushing phase will retry. Just log.
        errors.push({ type: 'push_airtable', row_index: item.row_index, supabase_id: item.supabaseId, error: ((e && e.message) || String(e)).slice(0, 300) });
      }
    });
  }

  // 7. Finalise import_run
  const totalSkipped = internalDuplicates.length + dbDuplicates.length;
  const status = (failed === 0)
    ? (errors.length === 0 ? 'success' : 'partial')   // partial covers airtable-push failures even if all inserts succeeded
    : (inserted === 0 ? 'error' : 'partial');

  try {
    await finaliseRun(sb, run.id, {
      status: status,
      finished_at: new Date().toISOString(),
      rows_inserted: inserted,
      rows_skipped_duplicate: totalSkipped,
      rows_skipped_invalid: invalids.length,
      rows_failed: failed,
      rows_pushed_to_airtable: pushed,
      error_log: errors.slice(0, 200),
      notes: 'dedup_by=' + dedupBy.join(',') + ' push_to_airtable=' + pushToAirtable
    });
  } catch (_) { /* best-effort log finalise */ }

  console.log('[ingest ' + requestId + '] source=' + source + ' attempted=' + rawRows.length + ' inserted=' + inserted + ' skipped=' + totalSkipped + ' invalid=' + invalids.length + ' failed=' + failed + ' pushed=' + pushed);

  return res.status(200).json({
    ok: status !== 'error',
    requestId: requestId,
    runId: run.id,
    status: status,
    attempted: rawRows.length,
    inserted: inserted,
    skipped_duplicate: totalSkipped,
    skipped_invalid: invalids.length,
    failed: failed,
    pushed_to_airtable: pushed,
    duplicates: internalDuplicates.concat(dbDuplicates).slice(0, 50),
    invalids: invalids.slice(0, 50),
    errors: errors.slice(0, 50)
  });
};
