const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function respond(res, status, body) {
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return respond(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer '))
    return respond(res, 401, { error: 'Missing or malformed Authorization header' });

  const token = authHeader.slice(7);
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey)
    return respond(res, 500, { error: 'Server misconfigured' });

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return respond(res, 401, { error: 'Invalid token' });

  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (profErr || !profile || !profile.is_admin)
    return respond(res, 403, { error: 'Forbidden' });

  const { action, ...payload } = req.body || {};
  if (!action) return respond(res, 400, { error: 'Missing action' });

  const adminId = user.id;

  try {
    let data = null;
    let targetCharId = payload.charId || null;

    switch (action) {

      case 'give_item': {
        const { charId, item } = payload;
        const { data: row, error } = await admin
          .from('inventory')
          .insert({
            character_id: charId,
            item_id: item.item_id || undefined,
            item_type: item.item_type,
            item_name: item.item_name,
            quantity: item.quantity || 1,
            item_data: item.item_data || {},
          })
          .select()
          .single();
        if (error) throw error;
        data = row;
        break;
      }

      case 'remove_item': {
        const { itemId } = payload;
        const { error } = await admin.from('inventory').delete().eq('id', itemId);
        if (error) throw error;
        data = { removed: itemId };
        break;
      }

      case 'set_class': {
        const { charId, className, classTier } = payload;
        const update = { current_class: className };
        if (classTier !== undefined) update.class_tier = classTier;
        const { error } = await admin.from('characters').update(update).eq('id', charId);
        if (error) throw error;
        data = { charId, className, classTier };
        break;
      }

      case 'give_ability': {
        data = { stub: true, message: 'Ability system not yet implemented' };
        break;
      }

      case 'remove_ability': {
        data = { stub: true, message: 'Ability system not yet implemented' };
        break;
      }

      case 'set_stats': {
        const { charId, stats } = payload;
        const allowed = ['hp', 'max_hp', 'mana', 'max_mana', 'stamina', 'silver', 'valu', 'insight'];
        const update = {};
        for (const key of allowed) {
          if (stats[key] !== undefined) update[key] = stats[key];
        }
        const { error } = await admin.from('characters').update(update).eq('id', charId);
        if (error) throw error;
        data = { charId, updated: update };
        break;
      }

      case 'set_alignment': {
        const { charId, value } = payload;
        const { error } = await admin.from('characters').update({ alignment: value }).eq('id', charId);
        if (error) throw error;
        data = { charId, alignment: value };
        break;
      }

      case 'set_lives': {
        const { charId, lives } = payload;
        const { error } = await admin.from('characters').update({ lives_remaining: lives }).eq('id', charId);
        if (error) throw error;
        data = { charId, lives_remaining: lives };
        break;
      }

      case 'set_insanity': {
        const { charId, stage } = payload;
        const { error } = await admin.from('characters').update({ insanity_stage: stage }).eq('id', charId);
        if (error) throw error;
        data = { charId, insanity_stage: stage };
        break;
      }

      case 'teleport': {
        const { charId, x, y, zone } = payload;
        const { data: charRow, error: fetchErr } = await admin
          .from('characters')
          .select('current_plane')
          .eq('id', charId)
          .single();
        if (fetchErr) throw fetchErr;

        const { error } = await admin
          .from('characters')
          .update({ pos_x: x, pos_y: y, current_zone: zone })
          .eq('id', charId);
        if (error) throw error;

        await admin.from('world_events').insert({
          event_type: 'admin_teleport',
          payload: { charId, x, y, zone },
          plane: charRow.current_plane,
        });

        data = { charId, x, y, zone };
        break;
      }

      case 'give_heirloom': {
        const { charId, heirloom } = payload;
        const { data: lineageRow, error: fetchErr } = await admin
          .from('lineage')
          .select('id, inherited_heirlooms')
          .eq('character_id', charId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (fetchErr) throw fetchErr;

        const heirlooms = lineageRow.inherited_heirlooms || [];
        heirlooms.push(heirloom);

        const { error } = await admin
          .from('lineage')
          .update({ inherited_heirlooms: heirlooms })
          .eq('id', lineageRow.id);
        if (error) throw error;
        data = { charId, heirlooms };
        break;
      }

      case 'remove_heirloom': {
        const { charId, heirloom } = payload;
        const { data: lineageRow, error: fetchErr } = await admin
          .from('lineage')
          .select('id, inherited_heirlooms')
          .eq('character_id', charId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (fetchErr) throw fetchErr;

        const heirlooms = (lineageRow.inherited_heirlooms || []).filter(
          (h) => (typeof h === 'string' ? h !== heirloom : h.name !== heirloom)
        );

        const { error } = await admin
          .from('lineage')
          .update({ inherited_heirlooms: heirlooms })
          .eq('id', lineageRow.id);
        if (error) throw error;
        data = { charId, heirlooms };
        break;
      }

      case 'delete_chat': {
        const { messageId } = payload;
        const { error } = await admin.from('chat_messages').delete().eq('id', messageId);
        if (error) throw error;
        data = { removed: messageId };
        targetCharId = null;
        break;
      }

      default:
        return respond(res, 400, { error: `Unknown action: ${action}` });
    }

    await admin.from('admin_log').insert({
      admin_id: adminId,
      target_character_id: targetCharId,
      action,
      payload,
    });

    return respond(res, 200, { success: true, data });

  } catch (err) {
    console.error('[admin]', action, err);
    return respond(res, 500, { error: err.message || 'Internal error' });
  }
};
