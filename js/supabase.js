/**
 * Ashen Lineage — Supabase Client Helper
 * Uses Supabase JS v2 CDN (loaded in HTML before this script).
 * Exposes window.SupabaseHelper with auth, character, realtime, and admin helpers.
 */
(function () {
  const sb = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
  );

  // ── Auth ──────────────────────────────────────────────────
  async function signUp(email, password, username) {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { username } }
    });
    return { data, error };
  }

  async function signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    return { data, error };
  }

  async function signOut() {
    const { error } = await sb.auth.signOut();
    return { data: null, error };
  }

  async function getSession() {
    const { data: { session }, error } = await sb.auth.getSession();
    return { data: session, error };
  }

  function onAuthChange(callback) {
    sb.auth.onAuthStateChange((_event, session) => callback(session));
  }

  // ── Profiles ──────────────────────────────────────────────
  async function getProfile(userId) {
    const { data, error } = await sb
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    return { data, error };
  }

  // ── Characters ────────────────────────────────────────────
  async function loadCharacter(userId) {
    const { data, error } = await sb
      .from('characters')
      .select('*')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    return { data, error };
  }

  async function createCharacter(charObj) {
    const { data, error } = await sb
      .from('characters')
      .insert(charObj)
      .select()
      .single();
    return { data, error };
  }

  async function saveCharacterPosition(charId, x, y) {
    const { data, error } = await sb
      .from('characters')
      .update({ pos_x: x, pos_y: y, last_seen: new Date().toISOString() })
      .eq('id', charId);
    return { data, error };
  }

  async function updateCharacterStats(charId, statsObj) {
    const { data, error } = await sb
      .from('characters')
      .update({ ...statsObj, last_seen: new Date().toISOString() })
      .eq('id', charId);
    return { data, error };
  }

  async function setCharacterOnline(charId, isOnline) {
    const { data, error } = await sb
      .from('characters')
      .update({ is_online: isOnline, last_seen: new Date().toISOString() })
      .eq('id', charId);
    return { data, error };
  }

  async function deleteCharacter(charId) {
    const { data, error } = await sb
      .from('characters')
      .delete()
      .eq('id', charId);
    return { data, error };
  }

  async function loadNearbyPlayers(plane, myX, myY, radius) {
    const { data, error } = await sb
      .from('characters')
      .select('*')
      .eq('current_plane', plane)
      .eq('is_online', true)
      .gte('pos_x', myX - radius)
      .lte('pos_x', myX + radius)
      .gte('pos_y', myY - radius)
      .lte('pos_y', myY + radius);
    return { data, error };
  }

  // ── Inventory ─────────────────────────────────────────────
  async function loadInventory(characterId) {
    const { data, error } = await sb
      .from('inventory')
      .select('*')
      .eq('character_id', characterId);
    return { data, error };
  }

  async function addInventoryItem(item) {
    const { data: existing } = await sb
      .from('inventory')
      .select('*')
      .eq('character_id', item.character_id)
      .eq('item_name', item.item_name)
      .single();

    if (existing) {
      const { data, error } = await sb
        .from('inventory')
        .update({ quantity: existing.quantity + (item.quantity || 1) })
        .eq('id', existing.id)
        .select()
        .single();
      return { data, error };
    }

    const { data, error } = await sb
      .from('inventory')
      .insert(item)
      .select()
      .single();
    return { data, error };
  }

  async function updateInventoryItem(inventoryId, updates) {
    const { data, error } = await sb
      .from('inventory')
      .update(updates)
      .eq('id', inventoryId)
      .select()
      .single();
    return { data, error };
  }

  async function removeInventoryItem(inventoryId) {
    const { error } = await sb
      .from('inventory')
      .delete()
      .eq('id', inventoryId);
    return { error };
  }

  // ── Lineage ───────────────────────────────────────────────
  async function insertLineage(record) {
    const { data, error } = await sb
      .from('lineage')
      .insert(record)
      .select()
      .single();
    return { data, error };
  }

  async function loadLineage(userId) {
    const { data, error } = await sb
      .from('lineage')
      .select('*')
      .eq('user_id', userId)
      .order('wipe_date', { ascending: false });
    return { data, error };
  }

  // ── Chat ──────────────────────────────────────────────────
  async function sendChatMessage(charId, message, x, y, plane) {
    const { data, error } = await sb
      .from('chat_messages')
      .insert({ character_id: charId, message, pos_x: x, pos_y: y, plane });
    return { data, error };
  }

  // ── World Events ──────────────────────────────────────────
  async function insertWorldEvent(eventType, payload, plane, zone) {
    const { data, error } = await sb
      .from('world_events')
      .insert({ event_type: eventType, payload, plane, zone });
    return { data, error };
  }

  // ── Realtime ──────────────────────────────────────────────
  function subscribeToPlane(plane, onPlayerUpdate) {
    const channel = sb.channel(`plane:${plane}`, {
      config: { presence: { key: 'players' } }
    });
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        onPlayerUpdate(state);
      })
      .subscribe();
    return channel;
  }

  function subscribeToChat(plane, onMessage) {
    const channel = sb.channel(`chat:${plane}`);
    channel
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        onMessage(payload);
      })
      .subscribe();
    return channel;
  }

  function subscribeToWorldEvents(onEvent) {
    const channel = sb
      .channel('world-events-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'world_events' },
        (payload) => onEvent(payload.new)
      )
      .subscribe();
    return channel;
  }

  function getRealtimeChannel(name) {
    return sb.channel(name);
  }

  // ── Admin helpers (require is_admin = true) ───────────────
  async function _adminCall(action, payload) {
    const { data: session } = await getSession();
    if (!session) return { data: null, error: 'No session' };

    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ action, ...payload })
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error || 'Admin call failed' };
    return { data: json.data, error: null };
  }

  async function giveItem(charId, item) {
    return _adminCall('give_item', { charId, item });
  }
  async function removeItem(charId, itemId) {
    return _adminCall('remove_item', { charId, itemId });
  }
  async function giveClass(charId, className, classTier) {
    return _adminCall('set_class', { charId, className, classTier });
  }
  async function setAlignment(charId, value) {
    return _adminCall('set_alignment', { charId, value });
  }
  async function teleportPlayer(charId, x, y, zone) {
    return _adminCall('teleport', { charId, x, y, zone });
  }
  async function giveHeirloom(charId, heirloom) {
    return _adminCall('give_heirloom', { charId, heirloom });
  }
  async function removeAbility(charId, abilityId) {
    return _adminCall('remove_ability', { charId, abilityId });
  }
  async function setLives(charId, lives) {
    return _adminCall('set_lives', { charId, lives });
  }
  async function setStats(charId, stats) {
    return _adminCall('set_stats', { charId, stats });
  }
  async function setInsanity(charId, stage) {
    return _adminCall('set_insanity', { charId, stage });
  }
  async function adminDeleteChat(messageId) {
    return _adminCall('delete_chat', { messageId });
  }

  // ── Admin read helpers ────────────────────────────────────
  async function searchPlayers(query) {
    const { data, error } = await sb
      .from('characters')
      .select('*, profiles!inner(username, is_admin)')
      .or(`name.ilike.%${query}%,id.eq.${query.length === 36 ? query : '00000000-0000-0000-0000-000000000000'}`);
    return { data, error };
  }

  async function searchByUsername(query) {
    const { data, error } = await sb
      .from('profiles')
      .select('*, characters(*)')
      .ilike('username', `%${query}%`);
    return { data, error };
  }

  async function getAdminLog(limit = 50) {
    const { data, error } = await sb
      .from('admin_log')
      .select('*, profiles!admin_id(username)')
      .order('created_at', { ascending: false })
      .limit(limit);
    return { data, error };
  }

  async function getOnlinePlayers() {
    const { data, error } = await sb
      .from('characters')
      .select('*, profiles!inner(username)')
      .eq('is_online', true);
    return { data, error };
  }

  async function getRecentWorldEvents(limit = 50) {
    const { data, error } = await sb
      .from('world_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    return { data, error };
  }

  // ── Raw client access ─────────────────────────────────────
  function getClient() {
    return sb;
  }

  // ── Export ─────────────────────────────────────────────────
  window.SupabaseHelper = {
    getClient,
    signUp, signIn, signOut, getSession, onAuthChange,
    getProfile,
    loadCharacter, createCharacter, saveCharacterPosition,
    updateCharacterStats, setCharacterOnline, deleteCharacter,
    loadNearbyPlayers,
    loadInventory, addInventoryItem, updateInventoryItem, removeInventoryItem,
    insertLineage, loadLineage,
    sendChatMessage,
    insertWorldEvent,
    subscribeToPlane, subscribeToChat, subscribeToWorldEvents,
    getRealtimeChannel,
    giveItem, removeItem, giveClass, setAlignment,
    teleportPlayer, giveHeirloom, removeAbility, setLives,
    setStats, setInsanity, adminDeleteChat,
    searchPlayers, searchByUsername, getAdminLog,
    getOnlinePlayers, getRecentWorldEvents
  };
})();
