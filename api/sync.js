module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Sync-Key');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const expected = process.env.HERA_SYNC_KEY || '';
  const supplied = String(req.headers['x-sync-key'] || '');
  if (!expected || !supplied || supplied !== expected) {
    return res.status(401).json({ ok:false, error:'unauthorized' });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return res.status(500).json({ ok:false, error:'supabase_env_missing' });
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  try {
    if (req.method === 'GET') {
      const r = await fetch(
        `${url}/rest/v1/fishing_trips?select=record_id,trip_date,payload,updated_at,deleted_at,source_device&order=updated_at.asc`,
        { headers }
      );
      const text = await r.text();
      if (!r.ok) return res.status(r.status).send(text);
      return res.status(200).send(text);
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

      const records = Array.isArray(body.records) ? body.records : [];
      if (!records.length) {
        return res.status(200).json({ ok:true, upserted:0 });
      }

      const rows = records
        .filter(x => x && x.record_id && x.payload)
        .map(x => ({
          record_id: String(x.record_id),
          trip_date: x.trip_date || null,
          payload: x.payload,
          updated_at: x.updated_at || new Date().toISOString(),
          deleted_at: x.deleted_at || null,
          source_device: String(x.source_device || 'unknown')
        }));

      const r = await fetch(
        `${url}/rest/v1/fishing_trips?on_conflict=record_id`,
        {
          method:'POST',
          headers:{
            ...headers,
            Prefer:'resolution=merge-duplicates,return=minimal'
          },
          body:JSON.stringify(rows)
        }
      );

      const text = await r.text();
      if (!r.ok) return res.status(r.status).send(text);

      return res.status(200).json({
        ok:true,
        upserted:rows.length
      });
    }

    return res.status(405).json({
      ok:false,
      error:'method_not_allowed'
    });

  } catch (err) {
    console.error('hera sync api', err);
    return res.status(500).json({
      ok:false,
      error:String(err && err.message || err)
    });
  }
};
