// Vercel Serverless Function — Airtable Sync Proxy
// Handles VIP toggles, enrichment status, and field updates
// POST /api/airtable-sync
//
// Body: { airtableId, fields: { VIP: true, ... } }
// Response: { ok: true } or { error: "..." }

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;
  if (!AIRTABLE_KEY) return res.status(500).json({ error: 'Airtable key not configured' });

  const { airtableId, fields } = req.body || {};
  if (!airtableId || !fields) {
    return res.status(400).json({ error: 'Missing airtableId or fields' });
  }

  const BASE_ID = 'appVHIMu9xoabpge8';
  const TABLE_ID = 'tblllCSH6H33t6JVN';
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${airtableId}`;

  try {
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error('Airtable error:', resp.status, err);
      return res.status(resp.status).json({ error: 'Airtable update failed', detail: err });
    }

    const data = await resp.json();
    return res.status(200).json({ ok: true, id: data.id });
  } catch (e) {
    console.error('Airtable sync error:', e);
    return res.status(500).json({ error: e.message });
  }
}
