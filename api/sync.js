const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { charId, pos_x, pos_y, hp, mana, stamina, is_online, current_zone } = req.body;
    if (!charId) {
      return res.status(400).json({ error: 'charId is required' });
    }

    const { data: char, error: charErr } = await supabase
      .from('characters')
      .select('user_id')
      .eq('id', charId)
      .single();

    if (charErr || !char) {
      return res.status(404).json({ error: 'Character not found' });
    }
    if (char.user_id !== user.id) {
      return res.status(403).json({ error: 'Character does not belong to this user' });
    }

    const updates = { last_seen: new Date().toISOString() };
    if (pos_x !== undefined) updates.pos_x = pos_x;
    if (pos_y !== undefined) updates.pos_y = pos_y;
    if (hp !== undefined) updates.hp = hp;
    if (mana !== undefined) updates.mana = mana;
    if (stamina !== undefined) updates.stamina = stamina;
    if (is_online !== undefined) updates.is_online = is_online;
    if (current_zone !== undefined) updates.current_zone = current_zone;

    const { error: updateErr } = await supabase
      .from('characters')
      .update(updates)
      .eq('id', charId);

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
