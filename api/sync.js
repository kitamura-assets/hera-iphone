export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Sync-Key');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const expected = process.env.HERA_SYNC_KEY || '';
  const supplied = String(req.headers['x-sync-key'] || '');
  if (!expected || supplied !== expected) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base || !serviceKey) {
    return res.status(500).json({ ok: false, error: 'missing_supabase_env' });
  }

  const scope = String(req.query?.scope || '').toLowerCase();
  const isAssets = scope === 'assets';
  const table = isAssets ? 'fishing_assets' : 'fishing_trips';

  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  try {
    if (req.method === 'GET') {
      const select = isAssets
        ? 'asset_key,asset_type,record_id,place,sort_order,payload,data,updated_at,deleted_at,source_device'
        : 'record_id,trip_date,payload,updated_at,deleted_at,source_device';

      const url = `${base}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=updated_at.asc`;
      const r = await fetch(url, { headers, cache: 'no-store' });
      const text = await r.text();
      if (!r.ok) {
        return res.status(r.status).json({ ok: false, error: text.slice(0, 500) });
      }
      return res.status(200).send(text || '[]');
    }

    if (req.method === 'POST') {
      const records = Array.isArray(req.body?.records) ? req.body.records : [];
      if (!records.length) return res.status(200).json({ ok: true, upserted: 0 });

      const safe = records.map((x) => {
        if (isAssets) {
          return {
            asset_key: String(x.asset_key || ''),
            asset_type: String(x.asset_type || ''),
            record_id: x.record_id == null ? null : String(x.record_id),
            place: x.place == null ? null : String(x.place),
            sort_order: x.sort_order == null ? null : Number(x.sort_order),
            payload: x.payload == null ? null : x.payload,
            data: x.data == null ? null : String(x.data),
            updated_at: x.updated_at || new Date().toISOString(),
            deleted_at: x.deleted_at || null,
            source_device: x.source_device == null ? null : String(x.source_device)
          };
        }
        return {
          record_id: String(x.record_id || ''),
          trip_date: x.trip_date || null,
          payload: x.payload || {},
          updated_at: x.updated_at || new Date().toISOString(),
          deleted_at: x.deleted_at || null,
          source_device: x.source_device == null ? null : String(x.source_device)
        };
      }).filter((x) => isAssets ? (x.asset_key && x.asset_type) : x.record_id);

      if (!safe.length) return res.status(200).json({ ok: true, upserted: 0 });

      const onConflict = isAssets ? 'asset_key' : 'record_id';
      const url = `${base}/rest/v1/${table}?on_conflict=${onConflict}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(safe)
      });
      const text = await r.text();
      if (!r.ok) {
        return res.status(r.status).json({ ok: false, error: text.slice(0, 500) });
      }
      return res.status(200).json({ ok: true, upserted: safe.length });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e && e.message ? e.message : e)
    });
  }
}
