// Vercel Serverless Function — Contact Sync Proxy
// Updates Airtable AND/OR Supabase from the frontend
// Keys stay server-side, bypasses RLS issues
//
// POST /api/airtable-sync
// Body: {
//   airtableId: "recXXX",           (optional) Airtable record to update
//   fields: { VIP: true },          (optional) Airtable fields to patch
//   supabaseId: "uuid",             (optional) Supabase contact ID to update
//   supabaseFields: { vip: true }   (optional) Supabase fields to patch
// }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var body = req.body || {};
  var results = { ok: true };

  // ── Supabase update ──
  if (body.supabaseId && body.supabaseFields) {
    var SUPABASE_URL = process.env.SUPABASE_URL || 'https://gxunrnyehltpbgdodkkm.supabase.co';
    var SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
    if (!SUPABASE_SECRET) return res.status(500).json({ error: 'Supabase secret not configured' });

    try {
      var sResp = await fetch(
        SUPABASE_URL + '/rest/v1/contacts?id=eq.' + body.supabaseId,
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
      if (!sResp.ok) {
        var sErr = await sResp.text();
        results.supabase = { ok: false, status: sResp.status, error: sErr };
      } else {
        var sData = await sResp.json();
        results.supabase = { ok: true, updated: sData.length };
      }
    } catch (e) {
      results.supabase = { ok: false, error: e.message };
    }
  }

  // ── Airtable update ──
  if (body.airtableId && body.fields) {
    var AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;
    if (!AIRTABLE_KEY) return res.status(500).json({ error: 'Airtable key not configured' });

    var BASE_ID = 'appVHIMu9xoabpge8';
    var TABLE_ID = 'tblllCSH6H33t6JVN';
    var url = 'https://api.airtable.com/v0/' + BASE_ID + '/' + TABLE_ID + '/' + body.airtableId;

    try {
      var aResp = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + AIRTABLE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: body.fields })
      });
      if (!aResp.ok) {
        var aErr = await aResp.text();
        results.airtable = { ok: false, status: aResp.status, error: aErr };
      } else {
        var aData = await aResp.json();
        results.airtable = { ok: true, id: aData.id };
      }
    } catch (e) {
      results.airtable = { ok: false, error: e.message };
    }
  }

  return res.status(200).json(results);
};
