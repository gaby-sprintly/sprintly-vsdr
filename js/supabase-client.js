// ── Supabase Client ──
// Shared API wrapper for all VSDR proposal pages

const SUPABASE_URL = 'https://gxunrnyehltpbgdodkkm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_fipkXCnAvAV-om1bXwAfYA_4b3KRu0v';

const SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json'
};

async function sbFetch(path, options = {}) {
  const url = SUPABASE_URL + '/rest/v1/' + path;
  const res = await fetch(url, {
    headers: { ...SB_HEADERS, ...(options.headers || {}) },
    method: options.method || 'GET',
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[Supabase Error]', res.status, path, text);
    throw new Error('Supabase ' + res.status + ': ' + text);
  }
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function sbGet(table, query) {
  return sbFetch(table + (query ? '?' + query : ''));
}

async function sbInsert(table, data, options = {}) {
  return sbFetch(table, {
    method: 'POST',
    body: data,
    headers: options.returnData ? { 'Prefer': 'return=representation' } : {}
  });
}

async function sbUpdate(table, match, data) {
  return sbFetch(table + '?' + match, {
    method: 'PATCH',
    body: data,
    headers: { 'Prefer': 'return=representation' }
  });
}

async function sbDelete(table, match) {
  return sbFetch(table + '?' + match, { method: 'DELETE' });
}

async function sbCount(table, filter) {
  const url = SUPABASE_URL + '/rest/v1/' + table + '?select=id' + (filter ? '&' + filter : '');
  const res = await fetch(url, {
    headers: { ...SB_HEADERS, 'Prefer': 'count=exact', 'Range': '0-0' }
  });
  const range = res.headers.get('content-range') || '';
  const m = range.match(/\/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}
