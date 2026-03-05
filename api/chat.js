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

const MAX_MSG_LEN = 200;

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

    const { charId, message, pos_x, pos_y, plane } = req.body;

    if (!charId) {
      return res.status(400).json({ error: 'charId is required' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > MAX_MSG_LEN) {
      return res.status(400).json({ error: 'Message exceeds ' + MAX_MSG_LEN + ' characters' });
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

    const { data, error: insertErr } = await supabase
      .from('chat_messages')
      .insert({
        character_id: charId,
        message: message,
        pos_x: pos_x || 0,
        pos_y: pos_y || 0,
        plane: plane || 'mortal'
      })
      .select()
      .single();

    if (insertErr) {
      return res.status(500).json({ error: insertErr.message });
    }

    return res.status(200).json({ success: true, data: data });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
