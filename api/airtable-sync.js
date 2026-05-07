// Vercel Serverless Function — Contact Sync Proxy
// Updates Airtable AND/OR Supabase from the frontend.
// Server-side keys, validates input, retries transient failures, structured errors.
//
// POST /api/airtable-sync
// Body: {
//   airtableId?: "recXXXXXXXXXXXXXX",  Airtable record to update
//   fields?:     { VIP: true },        Airtable fields to patch
//   supabaseId?: "uuid",               Supabase contact UUID to update
//   supabaseFields?: { vip: true }     Supabase fields to patch
// }
//
// Response (200 always for full or partial success, 4xx/5xx for hard failure):
// {
//   ok: boolean,                         true only if every attempted op succeeded
//   requestId: string,                   correlation id, also in server logs
//   partial?: boolean,                   true on partial success
//   supabase?: { ok, status?, updated?, error?, attempts? },
//   airtable?: { ok, status?, id?, error?, attempts? }
// }

const VALID_AIRTABLE_ID = /^rec[A-Za-z0-9]{14,}$/;
const VALID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ORIGINS = new Set([
  'https://vsdr.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:5500'
]);
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function makeRequestId() {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// fetch with AbortController timeout + exponential backoff retry on 429/5xx/network errors
async function fetchWithRetry(url, opts) {
  let attempt = 0;
  let lastErr = null;
  while (attempt <= MAX_RETRIES) {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
      clearTimeout(timeoutId);

      const transient = resp.status === 429 || resp.status === 502 || resp.status === 503 || resp.status === 504;
      if (transient && attempt < MAX_RETRIES) {
        const retryAfterHeader = resp.headers.get('retry-after');
        const retryAfterMs = retryAfterHeader && !isNaN(parseFloat(retryAfterHeader))
          ? parseFloat(retryAfterHeader) * 1000
          : Math.pow(2, attempt) * 500;
        await sleep(retryAfterMs);
        attempt++;
        continue;
      }
      return { resp: resp, attempts: attempt + 1 };
    } catch (e) {
      clearTimeout(timeoutId);
      lastErr = e;
      const isAbort = e && e.name === 'AbortError';
      const isNetwork = e && (e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || /fetch failed|network/i.test(e.message || ''));
      if ((isAbort || isNetwork) && attempt < MAX_RETRIES) {
        await sleep(Math.pow(2, attempt) * 500);
        attempt++;
        continue;
      }
      throw Object.assign(e, { attempts: attempt + 1 });
    }
  }
  // Should be unreachable, but for completeness:
  throw Object.assign(lastErr || new Error('Retry budget exhausted'), { attempts: attempt });
}

module.exports = async function handler(req, res) {
  // CORS — lock to known origins, fall back to production domain
  const origin = (req.headers && req.headers.origin) || '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://vsdr.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const requestId = makeRequestId();
  const body = req.body || {};

  const wantsSupabase = body.supabaseId !== undefined || body.supabaseFields !== undefined;
  const wantsAirtable = body.airtableId !== undefined || body.fields !== undefined;

  if (!wantsSupabase && !wantsAirtable) {
    return res.status(400).json({ ok: false, requestId: requestId, error: 'No update target. Provide supabaseId+supabaseFields and/or airtableId+fields.' });
  }
  if (wantsSupabase) {
    if (typeof body.supabaseId !== 'string' || !VALID_UUID.test(body.supabaseId)) {
      return res.status(400).json({ ok: false, requestId: requestId, error: 'supabaseId must be a UUID string.' });
    }
    if (!isPlainObject(body.supabaseFields) || Object.keys(body.supabaseFields).length === 0) {
      return res.status(400).json({ ok: false, requestId: requestId, error: 'supabaseFields must be a non-empty object.' });
    }
  }
  if (wantsAirtable) {
    if (typeof body.airtableId !== 'string' || !VALID_AIRTABLE_ID.test(body.airtableId)) {
      return res.status(400).json({ ok: false, requestId: requestId, error: 'airtableId must match /^rec[A-Za-z0-9]{14,}$/.' });
    }
    if (!isPlainObject(body.fields) || Object.keys(body.fields).length === 0) {
      return res.status(400).json({ ok: false, requestId: requestId, error: 'fields must be a non-empty object.' });
    }
  }

  const result = { ok: true, requestId: requestId };

  // ── Supabase update ──
  if (wantsSupabase) {
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gxunrnyehltpbgdodkkm.supabase.co';
    const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
    if (!SUPABASE_SECRET) {
      console.error('[sync ' + requestId + '] missing SUPABASE_SECRET_KEY env');
      return res.status(500).json({ ok: false, requestId: requestId, error: 'Supabase secret not configured' });
    }
    try {
      const out = await fetchWithRetry(
        SUPABASE_URL + '/rest/v1/contacts?id=eq.' + encodeURIComponent(body.supabaseId),
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SECRET,
            'Authorization': 'Bearer ' + SUPABASE_SECRET,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(body.supabaseFields)
        }
      );
      const sResp = out.resp;
      if (!sResp.ok) {
        const errText = await sResp.text();
        result.supabase = { ok: false, status: sResp.status, error: errText.slice(0, 500), attempts: out.attempts };
        result.ok = false;
      } else {
        const sData = await sResp.json();
        if (!Array.isArray(sData) || sData.length === 0) {
          result.supabase = { ok: false, status: sResp.status, error: 'No rows updated — id not found', attempts: out.attempts };
          result.ok = false;
        } else {
          result.supabase = { ok: true, status: sResp.status, updated: sData.length, attempts: out.attempts };
        }
      }
    } catch (e) {
      const isAbort = e && e.name === 'AbortError';
      console.error('[sync ' + requestId + '] supabase exception:', e && e.message);
      result.supabase = { ok: false, error: isAbort ? 'Request timed out' : (e && e.message) || 'Unknown error', attempts: e && e.attempts };
      result.ok = false;
    }
  }

  // ── Airtable update ──
  if (wantsAirtable) {
    const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;
    if (!AIRTABLE_KEY) {
      console.error('[sync ' + requestId + '] missing AIRTABLE_API_KEY env');
      return res.status(500).json({ ok: false, requestId: requestId, error: 'Airtable key not configured' });
    }
    const BASE_ID = 'appVHIMu9xoabpge8';
    const TABLE_ID = 'tblllCSH6H33t6JVN';
    const url = 'https://api.airtable.com/v0/' + BASE_ID + '/' + TABLE_ID + '/' + encodeURIComponent(body.airtableId);
    try {
      const out = await fetchWithRetry(url, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + AIRTABLE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: body.fields })
      });
      const aResp = out.resp;
      if (!aResp.ok) {
        const errText = await aResp.text();
        result.airtable = { ok: false, status: aResp.status, error: errText.slice(0, 500), attempts: out.attempts };
        result.ok = false;
      } else {
        const aData = await aResp.json();
        result.airtable = { ok: true, status: aResp.status, id: aData.id, attempts: out.attempts };
      }
    } catch (e) {
      const isAbort = e && e.name === 'AbortError';
      console.error('[sync ' + requestId + '] airtable exception:', e && e.message);
      result.airtable = { ok: false, error: isAbort ? 'Request timed out' : (e && e.message) || 'Unknown error', attempts: e && e.attempts };
      result.ok = false;
    }
  }

  // Determine HTTP status: 200 if anything succeeded, 502 only when every attempted op failed.
  const sOk = wantsSupabase ? !!(result.supabase && result.supabase.ok) : null;
  const aOk = wantsAirtable ? !!(result.airtable && result.airtable.ok) : null;
  const allAttemptedFailed = (sOk === false || sOk === null) && (aOk === false || aOk === null) && (sOk === false || aOk === false);
  if (!result.ok && (sOk === false && aOk === false)) {
    // both attempted and both failed → 502 so callers can distinguish total failure
    result.partial = false;
  } else if (!result.ok) {
    result.partial = true;
  }

  // Structured access log (Vercel captures stdout)
  console.log('[sync ' + requestId + '] ' + JSON.stringify({
    ok: result.ok,
    partial: result.partial || false,
    supabaseId: body.supabaseId ? body.supabaseId.slice(0, 8) + '…' : null,
    airtableId: body.airtableId || null,
    fields: Object.keys(body.supabaseFields || {}).concat(Object.keys(body.fields || {})),
    sStatus: result.supabase && result.supabase.status,
    aStatus: result.airtable && result.airtable.status,
    sAttempts: result.supabase && result.supabase.attempts,
    aAttempts: result.airtable && result.airtable.attempts
  }));

  // 502 only when both attempted ops failed; otherwise 200 (incl. partial). Old callers ignored
  // status code and only checked body.supabase.ok / body.airtable.ok, so 200-with-body-flags is
  // backward compatible and adds 502 for the all-failed retryable case.
  const status = (sOk === false && aOk === false) ? 502 : 200;
  return res.status(status).json(result);
};
