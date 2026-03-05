/**
 * Ashen Lineage — UI System
 * Canvas-based HUD, menus, notifications, insanity effects, and mobile controls.
 * Uses 'Press Start 2P' font with monospace fallback.
 */
(function () {
  'use strict';

  var FONT = "'Press Start 2P', monospace";
  var BAR_W = 80;
  var BAR_H = 8;
  var BAR_PAD = 4;
  var BAR_X = 8;
  var BAR_Y_START = 8;
  var SKULL_SIZE = 10;
  var ITEM_SLOT = 40;
  var INV_COLS = 5;
  var INV_ROWS = 5;
  var MAP_PX = 32;
  var NOTIFY_MAX = 5;
  var NOTIFY_RISE_SPEED = 20;

  // ── State ────────────────────────────────────────────────────────

  var player = null;
  var activeMenu = null; // 'inventory' | 'charsheet' | 'map' | 'pause' | null
  var inventorySlot = -1;
  var hoverSlot = -1;
  var inventoryItems = [];
  var notifications = [];
  var insanityTimers = { flickerCooldown: 0, pulsePhase: 0, wobblePhase: 0 };
  var mobileJoystick = { active: false, cx: 0, cy: 0, tx: 0, ty: 0, radius: 50 };
  var isMobile = false;
  var npcDialogue = { active: false, npc: null, player: null, onAction: null, optionRects: [], closeRect: null };
  var jailState = { active: false, timer: 0 };
  var specter = { x: 0, y: 0, active: false, alpha: 1, catchTimer: 0, catchActive: false, vignetteIntensity: 0 };

  var ITEM_DISPLAY = {
    iron_sword:     { letter: 'S', color: '#aaaacc', label: 'Iron Sword' },
    steel_shield:   { letter: 'H', color: '#8888aa', label: 'Steel Shield' },
    leather_armor:  { letter: 'A', color: '#aa8866', label: 'Leather Armor' },
    health_potion:  { letter: '+', color: '#44cc44', label: 'Health Potion' },
    mana_potion:    { letter: 'M', color: '#4488ff', label: 'Mana Potion' },
  };

  // ── Init ─────────────────────────────────────────────────────────

  function initHUD(p) {
    player = p;
    isMobile =
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  // ── HUD Rendering ───────────────────────────────────────────────

  function renderHUD(ctx, camera, canvas) {
    if (!player) return;

    var vw = canvas.width / (camera.zoom || 2);
    var vh = canvas.height / (camera.zoom || 2);

    _drawStatBars(ctx);
    _drawLiveSkulls(ctx);
    _drawZonePlane(ctx, vw);
    _drawCurrencies(ctx, vw);
    _drawStatusEffects(ctx, vh);
    _drawAlignmentMeter(ctx, vw, vh);
    _drawSpellHotbar(ctx, vw, vh);

    if (isMobile) {
      _drawMobileHUD(ctx, vw, vh);
    }

    if (activeMenu === 'inventory') _drawInventory(ctx, vw, vh);
    if (activeMenu === 'charsheet') _drawCharSheet(ctx, vw, vh);
    if (activeMenu === 'map')       _drawMapOverlay(ctx, vw, vh);
    if (activeMenu === 'pause')     _drawPauseMenu(ctx, vw, vh);

    if (npcDialogue.active) _drawNPCDialogue(ctx, vw, vh);

    _drawNotifications(ctx, vw, vh);

    if (player.insanityStage > 0) {
      applyInsanityEffect(ctx, player.insanityStage, vw, vh);
    }

    _drawInjuryIndicators(ctx, camera, vw, vh);
  }

  // ── Stat Bars ────────────────────────────────────────────────────

  function _drawStatBars(ctx) {
    var bars = [
      { label: 'HP',  cur: player.hp,      max: player.maxHp,      fill: '#cc2222', bg: '#3a1111' },
      { label: 'MP',  cur: player.mana,    max: player.maxMana,    fill: '#5544aa', bg: '#1a1133' },
      { label: 'ST',  cur: player.stamina, max: player.maxStamina, fill: '#ccaa22', bg: '#332a0a' },
    ];

    for (var i = 0; i < bars.length; i++) {
      var b = bars[i];
      var by = BAR_Y_START + i * (BAR_H + BAR_PAD);

      // Border
      ctx.fillStyle = '#000000';
      ctx.fillRect(BAR_X - 1, by - 1, BAR_W + 2, BAR_H + 2);

      // Background
      ctx.fillStyle = b.bg;
      ctx.fillRect(BAR_X, by, BAR_W, BAR_H);

      // Fill
      var ratio = Math.max(0, Math.min(1, b.cur / b.max));
      ctx.fillStyle = b.fill;
      ctx.fillRect(BAR_X, by, BAR_W * ratio, BAR_H);

      // Number text
      ctx.font = '4px ' + FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(
        b.label + ' ' + Math.floor(b.cur) + '/' + Math.floor(b.max),
        BAR_X + 2,
        by + BAR_H / 2
      );
    }
  }

  // ── Life Skulls ──────────────────────────────────────────────────

  function _drawLiveSkulls(ctx) {
    var sy = BAR_Y_START + 3 * (BAR_H + BAR_PAD) + 2;
    var maxLives = 3;

    for (var i = 0; i < maxLives; i++) {
      var sx = BAR_X + i * (SKULL_SIZE + 3);
      var alive = i < player.lives;

      // Skull circle
      ctx.fillStyle = alive ? '#ddddcc' : '#444444';
      ctx.beginPath();
      ctx.arc(sx + SKULL_SIZE / 2, sy + SKULL_SIZE / 2, SKULL_SIZE / 2, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      ctx.fillStyle = alive ? '#1a1a1a' : '#222222';
      ctx.fillRect(sx + 2, sy + 3, 2, 2);
      ctx.fillRect(sx + 6, sy + 3, 2, 2);

      // Jaw
      ctx.fillRect(sx + 3, sy + 7, 4, 1);

      // Crack on lost lives
      if (!alive) {
        ctx.strokeStyle = '#666666';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(sx + 5, sy + 1);
        ctx.lineTo(sx + 3, sy + 5);
        ctx.lineTo(sx + 6, sy + 7);
        ctx.stroke();
      }
    }
  }

  // ── Zone & Plane Badge ───────────────────────────────────────────

  function _drawZonePlane(ctx, vw) {
    ctx.font = '5px ' + FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';

    // Zone name
    ctx.fillStyle = '#cccccc';
    ctx.fillText(player.zone || 'Unknown', vw - 8, 8);

    // Plane badge
    var planeLabel = (player.plane || 'gaia').toUpperCase();
    var planeColor = planeLabel === 'KHEI' ? '#aa4444' : '#44aa66';
    var tw = ctx.measureText(planeLabel).width + 6;

    ctx.fillStyle = planeColor;
    ctx.fillRect(vw - 8 - tw, 16, tw, 9);
    ctx.fillStyle = '#ffffff';
    ctx.font = '4px ' + FONT;
    ctx.fillText(planeLabel, vw - 11, 18);
  }

  // ── Currencies ───────────────────────────────────────────────────

  function _drawCurrencies(ctx, vw) {
    var currencies = [
      { label: 'Silver',  value: player.silver,  color: '#aaaaaa' },
      { label: 'Valu',    value: player.valu,    color: '#cc8833' },
      { label: 'Insight', value: player.insight, color: '#6688cc' },
    ];

    ctx.font = '4px ' + FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';

    for (var i = 0; i < currencies.length; i++) {
      var c = currencies[i];
      var cy = 30 + i * 10;
      var cx = vw - 10;

      // Coin circle
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(cx + 4, cy + 3, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(c.value.toString(), cx - 2, cy);
    }
  }

  // ── Active Status Effects ────────────────────────────────────────

  function _drawStatusEffects(ctx, vh) {
    if (!player.statusEffects) return;

    var statusKeys = typeof player.statusEffects === 'object' && !Array.isArray(player.statusEffects)
      ? Object.keys(player.statusEffects) : [];

    if (statusKeys.length === 0) return;

    var icons = {
      onFire:      { letter: 'F', color: '#ff4400' },
      blackFlames: { letter: 'B', color: '#220044' },
      cursed:      { letter: 'C', color: '#8800aa' },
      chilled:     { letter: 'H', color: '#6688ff' },
      frostbite:   { letter: 'X', color: '#aaccff' },
      manaLocked:  { letter: 'M', color: '#444488' },
      blinded:     { letter: 'B', color: '#888888' },
      poison:      { letter: 'P', color: '#44aa22' },
      anemia:      { letter: 'A', color: '#aa8888' },
    };

    var drawn = 0;
    var startY = vh - 20;

    for (var i = 0; i < statusKeys.length; i++) {
      var key = statusKeys[i];

      var info = icons[key];
      if (!info) continue;

      var ix = 8 + drawn * 16;

      ctx.fillStyle = info.color;
      ctx.beginPath();
      ctx.arc(ix + 5, startY + 5, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = '4px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.letter, ix + 5, startY + 5);

      // Duration
      ctx.font = '3px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#cccccc';
      var statusData = player.statusEffects[key];
      var remaining = statusData && statusData.timer ? Math.ceil(statusData.timer) : '';
      ctx.fillText(remaining + 's', ix + 5, startY + 12);

      drawn++;
    }
  }

  // ── Alignment Meter ──────────────────────────────────────────────

  function _drawAlignmentMeter(ctx, vw, vh) {
    var meterW = 100;
    var meterH = 6;
    var mx = (vw - meterW) / 2;
    var my = vh - 14;

    // Background gradient (left red → right gold)
    var grad = ctx.createLinearGradient(mx, 0, mx + meterW, 0);
    grad.addColorStop(0, '#aa2222');
    grad.addColorStop(0.4, '#886622');
    grad.addColorStop(0.6, '#888866');
    grad.addColorStop(1, '#ccaa33');
    ctx.fillStyle = grad;
    ctx.fillRect(mx, my, meterW, meterH);

    // Border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(mx, my, meterW, meterH);

    // Marker position: -400 maps to 0, +400 maps to meterW
    var norm = (player.alignment + 400) / 800;
    var markerX = mx + norm * meterW;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(markerX - 1, my - 1, 2, meterH + 2);

    // Label
    ctx.font = '3px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#bbbbbb';
    ctx.fillText(player.getAlignmentLabel(), vw / 2, my + meterH + 2);
  }

  // ── Mobile HUD ───────────────────────────────────────────────────

  function _drawMobileHUD(ctx, vw, vh) {
    // Virtual joystick
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(mobileJoystick.cx || 80, mobileJoystick.cy || vh - 80, mobileJoystick.radius, 0, Math.PI * 2);
    ctx.fill();

    if (mobileJoystick.active) {
      ctx.fillStyle = '#cccccc';
      ctx.beginPath();
      ctx.arc(mobileJoystick.tx, mobileJoystick.ty, mobileJoystick.radius * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Attack button — 80px red circle bottom-right
    var atkR = 20;
    var atkX = vw - 30;
    var atkY = vh - 40;
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#cc2222';
    ctx.beginPath();
    ctx.arc(atkX, atkY, atkR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.font = '5px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ATK', atkX, atkY);

    // Mana charge button — 60px blue circle
    var manaR = 15;
    var manaX = vw - 70;
    var manaY = vh - 25;
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#3333aa';
    ctx.beginPath();
    ctx.arc(manaX, manaY, manaR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.font = '4px ' + FONT;
    ctx.fillText('MANA', manaX, manaY);

    // Chat button — speech bubble icon top-right
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#666666';
    var chatX = vw - 20;
    var chatY = 60;
    ctx.fillRect(chatX - 10, chatY, 20, 12);
    ctx.beginPath();
    ctx.moveTo(chatX - 4, chatY + 12);
    ctx.lineTo(chatX, chatY + 16);
    ctx.lineTo(chatX + 4, chatY + 12);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.font = '3px ' + FONT;
    ctx.fillText('CHAT', chatX, chatY + 6);

    // Inventory button — grid icon bottom-center
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#888888';
    var invX = vw / 2 - 10;
    var invY = vh - 18;
    for (var r = 0; r < 2; r++) {
      for (var c = 0; c < 2; c++) {
        ctx.fillRect(invX + c * 8, invY + r * 8, 6, 6);
      }
    }
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.font = '3px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillText('INV', vw / 2, invY + 20);

    ctx.globalAlpha = 1;
  }

  // ── Spell Hotbar ─────────────────────────────────────────────────

  function _drawSpellHotbar(ctx, vw, vh) {
    if (!player || !player.knownSpells || player.knownSpells.length === 0) return;

    var spells = player.knownSpells;
    var slotW = 20;
    var slotH = 20;
    var gap = 2;
    var totalW = spells.length * (slotW + gap) - gap;
    var ox = (vw - totalW) / 2;
    var oy = vh - slotH - 6;

    for (var i = 0; i < spells.length; i++) {
      var spellId = spells[i];
      var spell = (typeof Combat !== 'undefined' && Combat.SPELLS) ? Combat.SPELLS[spellId] : null;
      if (!spell) continue;

      var sx = ox + i * (slotW + gap);
      var isSelected = i === player.selectedSpell;
      var canCast = player.mana >= spell.cost;

      ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.6)';
      ctx.fillRect(sx, oy, slotW, slotH);
      ctx.strokeStyle = isSelected ? spell.color : '#444444';
      ctx.lineWidth = isSelected ? 1 : 0.5;
      ctx.strokeRect(sx, oy, slotW, slotH);

      ctx.fillStyle = canCast ? spell.color : '#555555';
      ctx.font = '7px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(spell.label.charAt(0), sx + slotW / 2, oy + slotH / 2);

      ctx.fillStyle = '#888888';
      ctx.font = '3px ' + FONT;
      ctx.textBaseline = 'top';
      ctx.fillText(String(i + 1), sx + 2, oy + 1);
    }
  }

  // ── Inventory ────────────────────────────────────────────────────

  function _drawInventory(ctx, vw, vh) {
    var totalW = INV_COLS * ITEM_SLOT;
    var totalH = INV_ROWS * ITEM_SLOT;
    var ox = (vw - totalW) / 2;
    var oy = (vh - totalH) / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(ox - 4, oy - 14, totalW + 8, totalH + 28);

    ctx.font = '5px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#cccccc';
    ctx.fillText('INVENTORY', vw / 2, oy - 4);

    for (var r = 0; r < INV_ROWS; r++) {
      for (var c = 0; c < INV_COLS; c++) {
        var idx = r * INV_COLS + c;
        var sx = ox + c * ITEM_SLOT;
        var sy = oy + r * ITEM_SLOT;

        var isSelected = idx === inventorySlot;
        var isHovered = idx === hoverSlot;
        var item = inventoryItems[idx] || null;

        ctx.strokeStyle = isSelected ? '#ccaa33' : isHovered ? '#888888' : '#444444';
        ctx.lineWidth = isSelected ? 1 : 0.5;
        ctx.strokeRect(sx, sy, ITEM_SLOT - 1, ITEM_SLOT - 1);

        ctx.fillStyle = isSelected ? 'rgba(204,170,51,0.15)' : 'rgba(30,30,30,0.6)';
        ctx.fillRect(sx + 1, sy + 1, ITEM_SLOT - 3, ITEM_SLOT - 3);

        if (item) {
          var disp = ITEM_DISPLAY[item.item_name] || { letter: '?', color: '#aaaaaa', label: item.item_name };
          ctx.fillStyle = disp.color;
          ctx.font = '10px ' + FONT;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(disp.letter, sx + ITEM_SLOT / 2, sy + ITEM_SLOT / 2 - 2);

          if (item.quantity > 1) {
            ctx.font = '4px ' + FONT;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = '#ffffff';
            ctx.fillText('x' + item.quantity, sx + ITEM_SLOT - 4, sy + ITEM_SLOT - 3);
          }
        }
      }
    }

    if (inventorySlot >= 0 && inventoryItems[inventorySlot]) {
      var sel = inventoryItems[inventorySlot];
      var selDisp = ITEM_DISPLAY[sel.item_name] || { label: sel.item_name };
      ctx.font = '4px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#dddddd';
      ctx.fillText(selDisp.label + (sel.item_type ? ' (' + sel.item_type + ')' : ''), vw / 2, oy + totalH + 4);
    }
  }

  function loadInventoryItems(items) {
    inventoryItems = items || [];
  }

  // ── Character Sheet ──────────────────────────────────────────────

  function _drawCharSheet(ctx, vw, vh) {
    var panelW = 140;
    var panelH = 120;
    var ox = (vw - panelW) / 2;
    var oy = (vh - panelH) / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(ox, oy, panelW, panelH);

    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(ox, oy, panelW, panelH);

    ctx.font = '5px ' + FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#cccccc';

    var lines = [
      (player.name || '???') + '  [' + (player.race || '?') + ']',
      'Class: ' + (player.currentClass || 'None') + (player.subclass ? ' / ' + player.subclass : ''),
      'Tier: ' + player.classTier + '   Alignment: ' + player.getAlignmentLabel(),
      '',
      'HP: ' + Math.floor(player.hp) + '/' + Math.floor(player.maxHp) +
        '   Mana: ' + Math.floor(player.mana) + '/' + Math.floor(player.maxMana),
      'Stamina: ' + Math.floor(player.stamina) + '/' + Math.floor(player.maxStamina),
      'Posture: ' + Math.floor(player.posture) + '/' + player.maxPosture,
      '',
      'Silver: ' + player.silver + '  Valu: ' + player.valu + '  Insight: ' + player.insight,
      'Lives: ' + player.lives + '  Insanity: ' + player.insanityStage,
      '',
      'Injuries: ' + (player.injuries.length > 0 ? player.injuries.join(', ') : 'None'),
    ];

    ctx.font = '4px ' + FONT;
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], ox + 4, oy + 6 + i * 9);
    }
  }

  // ── Map Overlay ──────────────────────────────────────────────────

  function _drawMapOverlay(ctx, vw, vh) {
    var mapSize = MAP_PX * 4;
    var ox = (vw - mapSize) / 2;
    var oy = (vh - mapSize) / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(ox - 4, oy - 14, mapSize + 8, mapSize + 20);

    ctx.font = '5px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#cccccc';
    ctx.fillText('MAP', vw / 2, oy - 4);

    // Simplified 32x32 view of the 200x200 world (each map pixel = ~6 world tiles)
    if (typeof World !== 'undefined' && World.getTileAt) {
      var tileColors = {
        0: '#3a5a1c', 1: '#6b6b6b', 2: '#1a3a5c', 3: '#5a4a2a',
        4: '#d0d8e0', 5: '#3a3a4a', 6: '#2a2a3a', 7: '#0a0a0a',
        8: '#c8b040', 9: '#e0d060', 10: '#5a1a3a', 11: '#2a4a1a', 12: '#7a7a7a',
      };
      var scale = mapSize / MAP_PX;

      for (var my = 0; my < MAP_PX; my++) {
        for (var mx = 0; mx < MAP_PX; mx++) {
          var sampleX = Math.floor(mx * (200 / MAP_PX)) * 16;
          var sampleY = Math.floor(my * (200 / MAP_PX)) * 16;
          var tile = World.getTileAt(sampleX, sampleY);
          ctx.fillStyle = tileColors[tile] || '#ff00ff';
          ctx.fillRect(ox + mx * scale, oy + my * scale, scale, scale);
        }
      }
    } else {
      ctx.fillStyle = '#222222';
      ctx.fillRect(ox, oy, mapSize, mapSize);
    }

    // Player dot
    var dotX = ox + (player.x / (200 * 16)) * mapSize;
    var dotY = oy + (player.y / (200 * 16)) * mapSize;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(dotX - 1, dotY - 1, 3, 3);
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(dotX, dotY, 1, 1);
  }

  // ── Pause Menu ───────────────────────────────────────────────────

  function _drawPauseMenu(ctx, vw, vh) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, vw, vh);

    ctx.font = '8px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#cccccc';
    ctx.fillText('PAUSED', vw / 2, vh / 2 - 20);

    // Resume button
    ctx.fillStyle = '#444444';
    ctx.fillRect(vw / 2 - 40, vh / 2 - 2, 80, 14);
    ctx.fillStyle = '#ffffff';
    ctx.font = '5px ' + FONT;
    ctx.fillText('RESUME', vw / 2, vh / 2 + 5);

    // Sign out button
    ctx.fillStyle = '#553333';
    ctx.fillRect(vw / 2 - 40, vh / 2 + 18, 80, 14);
    ctx.fillStyle = '#ffaaaa';
    ctx.fillText('SIGN OUT', vw / 2, vh / 2 + 25);
  }

  // ── Notifications ────────────────────────────────────────────────

  function showNotification(text, color, duration) {
    notifications.push({
      text: text,
      color: color || '#ffffff',
      remaining: duration || 3,
      total: duration || 3,
      y: 0,
    });

    while (notifications.length > NOTIFY_MAX) {
      notifications.shift();
    }
  }

  function _drawNotifications(ctx, vw, vh) {
    ctx.font = '4px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    var baseY = vh / 2;

    for (var i = notifications.length - 1; i >= 0; i--) {
      var n = notifications[i];
      var age = n.total - n.remaining;
      var alpha = Math.max(0, n.remaining / n.total);
      var offsetY = age * NOTIFY_RISE_SPEED;
      var slot = notifications.length - 1 - i;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, vw / 2, baseY - offsetY - slot * 8);
    }

    ctx.globalAlpha = 1;
  }

  // ── Insanity Effects ─────────────────────────────────────────────

  function applyInsanityEffect(ctx, stage, vw, vh) {
    if (!vw || !vh) return;

    // Stage 1: random red flicker at screen edges
    if (stage >= 1) {
      insanityTimers.flickerCooldown -= 1 / 60;
      if (insanityTimers.flickerCooldown <= 0) {
        insanityTimers.flickerCooldown = 5 + Math.random() * 5;
        ctx.fillStyle = 'rgba(180, 0, 0, 0.15)';
        var side = Math.floor(Math.random() * 4);
        if (side === 0) ctx.fillRect(0, 0, 6, vh);
        else if (side === 1) ctx.fillRect(vw - 6, 0, 6, vh);
        else if (side === 2) ctx.fillRect(0, 0, vw, 6);
        else ctx.fillRect(0, vh - 6, vw, 6);
      }
    }

    // Stage 2: red border pulse
    if (stage >= 2) {
      insanityTimers.pulsePhase += 1 / 60;
      var pulseA = (Math.sin(insanityTimers.pulsePhase * 2) + 1) * 0.08;
      ctx.fillStyle = 'rgba(120, 0, 0, ' + pulseA + ')';
      ctx.fillRect(0, 0, vw, 3);
      ctx.fillRect(0, vh - 3, vw, 3);
      ctx.fillRect(0, 0, 3, vh);
      ctx.fillRect(vw - 3, 0, 3, vh);
    }

    // Stage 3: static/noise overlay patches
    if (stage >= 3) {
      ctx.globalAlpha = 0.06;
      for (var n = 0; n < 30; n++) {
        var nx = Math.random() * vw;
        var ny = Math.random() * vh;
        var brightness = Math.floor(Math.random() * 256);
        ctx.fillStyle = 'rgb(' + brightness + ',' + brightness + ',' + brightness + ')';
        ctx.fillRect(nx, ny, 2 + Math.random() * 4, 1 + Math.random() * 2);
      }
      ctx.globalAlpha = 1;
    }

    // Stage 4: slight canvas rotation wobble
    if (stage >= 4) {
      insanityTimers.wobblePhase += 1 / 60;
      var angle = Math.sin(insanityTimers.wobblePhase * 1.5) * 0.008;
      ctx.save();
      ctx.translate(vw / 2, vh / 2);
      ctx.rotate(angle);
      ctx.translate(-vw / 2, -vh / 2);
    }

    // Stage 5: heavy vignette darkening
    if (stage >= 5) {
      var grad = ctx.createRadialGradient(vw / 2, vh / 2, vw * 0.15, vw / 2, vh / 2, vw * 0.55);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.7)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, vw, vh);
    }

    if (stage >= 4) {
      ctx.restore();
    }
  }

  // ── Injury Indicators ───────────────────────────────────────────

  function _drawInjuryIndicators(ctx, camera, vw, vh) {
    if (!player.injuries || player.injuries.length === 0) return;

    // Cataracts: dark vignette overlay
    if (player.injuries.indexOf('cataracts') !== -1) {
      var catGrad = ctx.createRadialGradient(vw / 2, vh / 2, vw * 0.1, vw / 2, vh / 2, vw * 0.45);
      catGrad.addColorStop(0, 'rgba(0,0,0,0)');
      catGrad.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = catGrad;
      ctx.fillRect(0, 0, vw, vh);
    }

    // Anemia: desaturation hint via semi-transparent grey overlay
    if (player.injuries.indexOf('anemia') !== -1) {
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, vw, vh);
      ctx.globalAlpha = 1;
    }
  }

  // ── Menu Controls ────────────────────────────────────────────────

  function openInventory()  { activeMenu = 'inventory'; }
  function closeInventory() { if (activeMenu === 'inventory') activeMenu = null; }
  function toggleInventory() {
    activeMenu = activeMenu === 'inventory' ? null : 'inventory';
  }
  function openCharSheet()  { activeMenu = 'charsheet'; }
  function openMap()        { activeMenu = 'map'; }
  function openPauseMenu()  { activeMenu = 'pause'; }
  function closeAllMenus()  { activeMenu = null; inventorySlot = -1; hoverSlot = -1; }
  function isMenuOpen()     { return activeMenu !== null; }

  // ── NPC Dialogue System ─────────────────────────────────────────

  function _wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    var words = text.split(' ');
    var line = '';
    var lineY = y;
    for (var i = 0; i < words.length; i++) {
      var testLine = line + (line ? ' ' : '') + words[i];
      if (ctx.measureText(testLine).width > maxWidth && line) {
        ctx.fillText(line, x, lineY);
        line = words[i];
        lineY += lineHeight;
      } else {
        line = testLine;
      }
    }
    if (line) ctx.fillText(line, x, lineY);
  }

  function showNPCDialogue(npc, playerRef, onAction) {
    var data = (typeof World !== 'undefined') ? World.getNPCData(npc.type) : null;
    if (!data) return;

    if (npc.type === 'Guard' && playerRef.alignment < -160 && (playerRef.gripCount || 0) >= 3) {
      handleNPCAction('jail', playerRef);
      return;
    }

    npcDialogue.active = true;
    npcDialogue.npc = npc;
    npcDialogue.player = playerRef;
    npcDialogue.onAction = onAction;
    npcDialogue.optionRects = [];
    npcDialogue.closeRect = null;
  }

  function closeNPCDialogue() {
    npcDialogue.active = false;
    npcDialogue.npc = null;
    npcDialogue.player = null;
    npcDialogue.onAction = null;
    npcDialogue.optionRects = [];
    npcDialogue.closeRect = null;
  }

  function _drawNPCDialogue(ctx, vw, vh) {
    var data = (typeof World !== 'undefined') ? World.getNPCData(npcDialogue.npc.type) : null;
    if (!data) return;

    var dw = 200;
    var dh = 150;
    var dx = (vw - dw) / 2;
    var dy = (vh - dh) / 2;

    ctx.fillStyle = '#16213E';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = '#4a6fa5';
    ctx.lineWidth = 1;
    ctx.strokeRect(dx + 1, dy + 1, dw - 2, dh - 2);

    ctx.font = '6px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#d4a017';
    ctx.fillText(npcDialogue.npc.type, vw / 2, dy + 6);

    ctx.fillStyle = data.color;
    ctx.fillRect(dx + 8, dy + 20, 24, 24);
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(data.letter, dx + 20, dy + 32);

    var dialogue = data.dialogue;
    if (npcDialogue.npc.type === 'Guard' && npcDialogue.player && npcDialogue.player.alignment < (data.hostileThreshold || -160)) {
      dialogue = data.hostileDialogue || data.dialogue;
    }
    ctx.font = '4px ' + FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#cccccc';
    _wrapText(ctx, dialogue, dx + 38, dy + 22, dw - 50, 7);

    npcDialogue.optionRects = [];
    var options = data.options;

    if (npcDialogue.npc.type === 'Guard' && npcDialogue.player && npcDialogue.player.alignment < (data.hostileThreshold || -160)) {
      options = [];
    }

    var optY = dy + 55;
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      var optH = 12;
      var optW = dw - 20;
      var ox = dx + 10;
      var oy = optY + i * (optH + 3);
      var canAfford = npcDialogue.player && npcDialogue.player.silver >= opt.cost;

      ctx.fillStyle = canAfford ? '#1a3a5c' : '#2a1a1a';
      ctx.fillRect(ox, oy, optW, optH);
      ctx.strokeStyle = canAfford ? '#4a7aaa' : '#5a3a3a';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(ox, oy, optW, optH);

      ctx.fillStyle = canAfford ? '#ffffff' : '#666666';
      ctx.font = '4px ' + FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(opt.text, ox + 4, oy + optH / 2);

      npcDialogue.optionRects.push({ x: ox, y: oy, w: optW, h: optH, action: opt.action, cost: opt.cost });
    }

    var closeW = 50;
    var closeH = 12;
    var closeX = dx + (dw - closeW) / 2;
    var closeY = dy + dh - closeH - 6;

    ctx.fillStyle = '#3a2020';
    ctx.fillRect(closeX, closeY, closeW, closeH);
    ctx.strokeStyle = '#aa6666';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(closeX, closeY, closeW, closeH);
    ctx.fillStyle = '#cccccc';
    ctx.font = '4px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('[CLOSE]', closeX + closeW / 2, closeY + closeH / 2);

    npcDialogue.closeRect = { x: closeX, y: closeY, w: closeW, h: closeH };
  }

  function handleNPCDialogueClick(canvasX, canvasY, zoom) {
    if (!npcDialogue.active) return false;

    var vx = canvasX / (zoom || 2);
    var vy = canvasY / (zoom || 2);

    var cr = npcDialogue.closeRect;
    if (cr && vx >= cr.x && vx <= cr.x + cr.w && vy >= cr.y && vy <= cr.y + cr.h) {
      closeNPCDialogue();
      return true;
    }

    for (var i = 0; i < npcDialogue.optionRects.length; i++) {
      var r = npcDialogue.optionRects[i];
      if (vx >= r.x && vx <= r.x + r.w && vy >= r.y && vy <= r.y + r.h) {
        if (npcDialogue.player && npcDialogue.player.silver >= r.cost) {
          if (npcDialogue.onAction) {
            npcDialogue.onAction(r.action, npcDialogue.player);
          }
          closeNPCDialogue();
        } else {
          showNotification('Not enough silver!', '#ff4444', 2);
        }
        return true;
      }
    }

    return false;
  }

  function _learnSpell(playerRef, spellId) {
    if (!playerRef.knownSpells) playerRef.knownSpells = [];
    if (playerRef.knownSpells.indexOf(spellId) === -1) {
      playerRef.knownSpells.push(spellId);
      if (typeof SupabaseHelper !== 'undefined' && SupabaseHelper.updateCharacterStats) {
        SupabaseHelper.updateCharacterStats(playerRef.id, { known_spells: playerRef.knownSpells });
      }
    }
  }

  function _buyItem(playerRef, itemType, itemName, itemData) {
    if (typeof SupabaseHelper !== 'undefined' && SupabaseHelper.addInventoryItem) {
      SupabaseHelper.addInventoryItem({
        character_id: playerRef.id, item_type: itemType,
        item_name: itemName, quantity: 1, item_data: itemData
      }).then(function () {
        SupabaseHelper.loadInventory(playerRef.id).then(function (result) {
          if (result.data) loadInventoryItems(result.data);
        });
      });
    }
  }

  function handleNPCAction(actionId, playerRef) {
    var costs = {
      heal_broken_arm: 50, heal_broken_leg: 50, heal_slash_wound: 30, heal_cataracts: 80,
      buy_iron_sword: 100, buy_steel_shield: 150, buy_leather_armor: 120,
      learn_ignis: 50, learn_gelidus: 50, learn_armis: 30,
    };

    if (actionId === 'jail') {
      playerRef.x = 400;
      playerRef.y = 400;
      jailState.active = true;
      jailState.timer = 60;
      showNotification('You have been thrown in jail!', '#ff4444', 5);
      return;
    }

    var cost = costs[actionId];
    if (cost === undefined) return;

    if (playerRef.silver < cost) {
      showNotification('Not enough silver!', '#ff4444', 2);
      return;
    }

    playerRef.silver -= cost;

    if (actionId === 'heal_broken_arm') {
      if (playerRef.removeInjury) playerRef.removeInjury('broken_arm');
      showNotification('Broken arm healed!', '#44ff44', 3);
    } else if (actionId === 'heal_broken_leg') {
      if (playerRef.removeInjury) playerRef.removeInjury('broken_leg');
      showNotification('Broken leg healed!', '#44ff44', 3);
    } else if (actionId === 'heal_slash_wound') {
      if (playerRef.removeInjury) playerRef.removeInjury('slash_wound');
      showNotification('Slash wound healed!', '#44ff44', 3);
    } else if (actionId === 'heal_cataracts') {
      if (playerRef.removeInjury) playerRef.removeInjury('cataracts');
      showNotification('Cataracts cured!', '#44ff44', 3);
    } else if (actionId === 'buy_iron_sword') {
      _buyItem(playerRef, 'weapon', 'iron_sword', { damage: 15, slot: 'main_hand' });
      showNotification('Iron Sword purchased!', '#aaaaff', 3);
    } else if (actionId === 'buy_steel_shield') {
      _buyItem(playerRef, 'armor', 'steel_shield', { defense: 10, slot: 'off_hand' });
      showNotification('Steel Shield purchased!', '#aaaaff', 3);
    } else if (actionId === 'buy_leather_armor') {
      _buyItem(playerRef, 'armor', 'leather_armor', { defense: 5, slot: 'chest' });
      showNotification('Leather Armor purchased!', '#aaaaff', 3);
    } else if (actionId === 'learn_ignis') {
      _learnSpell(playerRef, 'ignis');
      showNotification('Spell learned: Ignis!', '#ff8844', 3);
    } else if (actionId === 'learn_gelidus') {
      _learnSpell(playerRef, 'gelidus');
      showNotification('Spell learned: Gelidus!', '#44aaff', 3);
    } else if (actionId === 'learn_armis') {
      _learnSpell(playerRef, 'armis');
      showNotification('Spell learned: Armis!', '#cccc44', 3);
    }
  }

  var NPC_SPRITE_MAP = {
    Doctor:       'npc_doctor',
    Blacksmith:   'npc_blacksmith',
    ClassTrainer: 'npc_trainer',
    Guard:        'npc_guard',
  };

  function renderNPCMarkers(ctx, camera, npcsList) {
    if (!npcsList) return;

    for (var i = 0; i < npcsList.length; i++) {
      var npc = npcsList[i];
      var data = (typeof World !== 'undefined') ? World.getNPCData(npc.type) : null;
      if (!data) continue;

      var px = npc.x * 16 - camera.x;
      var py = npc.y * 16 - camera.y;

      var spriteKey = NPC_SPRITE_MAP[npc.type];
      var sprite = spriteKey && typeof GameEngine !== 'undefined' && GameEngine.spriteLoader
        ? GameEngine.spriteLoader.getSprite(spriteKey) : null;

      if (sprite) {
        ctx.drawImage(sprite, 0, 0, 32, 32, px - 8, py - 16, 32, 32);
      } else {
        ctx.fillStyle = data.color;
        ctx.fillRect(px, py, 16, 16);
        ctx.fillStyle = '#ffffff';
        ctx.font = '8px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(data.letter, px + 8, py + 8);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, 16, 16);
      }

      // NPC name above head
      ctx.font = '4px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.strokeText(npc.type, px + 8, py - (sprite ? 18 : 2));
      ctx.fillStyle = data.color;
      ctx.fillText(npc.type, px + 8, py - (sprite ? 18 : 2));
    }
  }

  // ── Specter System (Insanity Stage 5) ───────────────────────────

  function initSpecter(playerRef) {
    var angle = Math.random() * Math.PI * 2;
    specter.x = playerRef.x + Math.cos(angle) * 800;
    specter.y = playerRef.y + Math.sin(angle) * 800;
    specter.active = true;
    specter.alpha = 1;
    specter.catchTimer = 0;
    specter.catchActive = false;
    specter.vignetteIntensity = 0;
  }

  function updateSpecter(dt, playerRef) {
    if (!specter.active) return;

    if (specter.catchActive) {
      specter.catchTimer -= dt;
      if (specter.catchTimer <= 0) {
        playerRef.insanityStage = 4;
        specter.active = false;
        specter.catchActive = false;
      }
      return;
    }

    var sdx = playerRef.x - specter.x;
    var sdy = playerRef.y - specter.y;
    var dist = Math.sqrt(sdx * sdx + sdy * sdy);

    if (dist > 0) {
      var step = 60 * dt;
      specter.x += (sdx / dist) * step;
      specter.y += (sdy / dist) * step;
    }

    specter.vignetteIntensity = Math.max(0, Math.min(1, 1 - (dist / 800)));
    specter.alpha = 0.3 + specter.vignetteIntensity * 0.7;

    if (dist < 40) {
      specter.catchActive = true;
      specter.catchTimer = 3;
      playerRef.hp = 1;
      showNotification('YOU CANNOT ESCAPE YOURSELF', '#ff0000', 3);
    }
  }

  function renderSpecter(ctx, camera) {
    if (!specter.active) return;

    var zoom = camera.zoom || 2;
    var vw = ctx.canvas.width / zoom;
    var vh = ctx.canvas.height / zoom;

    if (specter.catchActive && specter.catchTimer > 2.7) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(0, 0, vw, vh);
    }

    if (specter.catchActive) {
      ctx.fillStyle = '#ff0000';
      ctx.font = '6px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('YOU CANNOT ESCAPE YOURSELF', vw / 2, vh / 2);
    }

    if (!specter.catchActive) {
      var sx = specter.x - camera.x;
      var sy = specter.y - camera.y;

      ctx.globalAlpha = specter.alpha;

      ctx.fillStyle = '#000000';
      ctx.fillRect(sx - 8, sy - 32, 16, 32);

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx - 3, sy - 22, 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx + 3, sy - 22, 2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 1;
    }

    if (specter.vignetteIntensity > 0) {
      var grad = ctx.createRadialGradient(vw / 2, vh / 2, vw * 0.15, vw / 2, vh / 2, vw * 0.55);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,' + (specter.vignetteIntensity * 0.8) + ')');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, vw, vh);
    }
  }

  function isSpecterActive() {
    return specter.active;
  }

  // ── Update ───────────────────────────────────────────────────────

  function updateUI(dt) {
    for (var i = notifications.length - 1; i >= 0; i--) {
      notifications[i].remaining -= dt;
      if (notifications[i].remaining <= 0) {
        notifications.splice(i, 1);
      }
    }

    if (jailState.active) {
      jailState.timer -= dt;
      if (jailState.timer <= 0) {
        jailState.active = false;
        showNotification('You are released from jail.', '#aaaaaa', 3);
      }
    }
  }

  // ── Death & Inheritance Screen ──────────────────────────────────

  var deathScreen = {
    active: false,
    phase: 'fade',
    fadeTimer: 0,
    fadeDuration: 2,
    playerRef: null,
    lineageData: null,
    onContinue: null,
    buttonBounds: null,
    _clickHandler: null,
  };

  function _getAlignmentLabelForDeath(alignment) {
    if (alignment <= -200) return 'Corrupt';
    if (alignment <= -1)   return 'Chaotic';
    if (alignment <= 100)  return 'Neutral';
    if (alignment <= 300)  return 'Orderly';
    return 'Ordained';
  }

  function _getFerrymanDialogue(alignment) {
    if (alignment >= 300) return 'A champion of order... lost to time.';
    if (alignment >= 100) return 'A do-gooder, huh? The world is lesser for your passing.';
    if (alignment >= -1)  return 'Neither light nor dark... the void takes you equally.';
    if (alignment >= -200) return 'You enjoyed the carnage, didn\'t you?';
    return 'Darkness consumes itself. As it always does.';
  }

  function _drawPixelSkull(ctx, cx, cy, scale) {
    var s = scale || 1;
    ctx.fillStyle = '#888888';

    var skull = [
      '  XXXX  ',
      ' XXXXXX ',
      'XXXXXXXX',
      'XX XX XX',
      'XX XX XX',
      'XXXXXXXX',
      ' XX  XX ',
      ' X XX X ',
    ];

    var startX = cx - skull[0].length * s / 2;
    var startY = cy - skull.length * s / 2;

    for (var row = 0; row < skull.length; row++) {
      for (var col = 0; col < skull[row].length; col++) {
        if (skull[row][col] === 'X') {
          ctx.fillRect(startX + col * s, startY + row * s, s, s);
        }
      }
    }
  }

  function showDeathScreen(playerObj, lineageData, onContinue) {
    deathScreen.active = true;
    deathScreen.phase = 'fade';
    deathScreen.fadeTimer = 0;
    deathScreen.playerRef = playerObj;
    deathScreen.lineageData = lineageData;
    deathScreen.onContinue = onContinue;
    deathScreen.buttonBounds = null;

    if (deathScreen._clickHandler) {
      document.removeEventListener('click', deathScreen._clickHandler);
    }

    deathScreen._clickHandler = function (e) {
      if (deathScreen.phase !== 'overlay' || !deathScreen.buttonBounds) return;

      var canvas = e.target;
      if (!canvas || !canvas.getBoundingClientRect) return;

      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      var mx = (e.clientX - rect.left) * scaleX;
      var my = (e.clientY - rect.top) * scaleY;

      var bb = deathScreen.buttonBounds;
      if (mx >= bb.x && mx <= bb.x + bb.w && my >= bb.y && my <= bb.y + bb.h) {
        deathScreen.active = false;
        document.removeEventListener('click', deathScreen._clickHandler);
        deathScreen._clickHandler = null;
        if (deathScreen.onContinue) deathScreen.onContinue();
      }
    };

    document.addEventListener('click', deathScreen._clickHandler);
  }

  function renderDeathScreen(ctx, dt) {
    if (!deathScreen.active) return;

    var w = ctx.canvas.width;
    var h = ctx.canvas.height;

    if (deathScreen.phase === 'fade') {
      deathScreen.fadeTimer += dt;
      var fadeAlpha = Math.min(1, deathScreen.fadeTimer / deathScreen.fadeDuration);

      ctx.fillStyle = 'rgba(0, 0, 0, ' + fadeAlpha + ')';
      ctx.fillRect(0, 0, w, h);

      if (deathScreen.fadeTimer >= deathScreen.fadeDuration) {
        deathScreen.phase = 'overlay';
      }
      return;
    }

    var p = deathScreen.playerRef;
    var ld = deathScreen.lineageData;
    if (!p || !ld) return;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    var centerX = w / 2;
    var y = h * 0.08;

    _drawPixelSkull(ctx, centerX, y + 24, 6);
    y += 70;

    ctx.font = '16px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#C0392B';
    ctx.fillText('YOUR LINEAGE HAS ENDED', centerX, y);
    y += 30;

    ctx.fillStyle = '#666666';
    ctx.fillRect(centerX - 80, y, 160, 1);
    y += 14;

    ctx.font = '8px ' + FONT;
    ctx.fillStyle = '#999999';
    ctx.fillText((p.name || '???'), centerX, y);
    y += 16;

    ctx.font = '7px ' + FONT;
    ctx.fillStyle = '#777777';
    var raceStr = p.race || 'Unknown';
    var classStr = p.currentClass || 'Classless';
    ctx.fillText(raceStr + '  \u00B7  ' + classStr, centerX, y);
    y += 14;

    var alignLabel = _getAlignmentLabelForDeath(p.alignment);
    ctx.fillText('Alignment: ' + alignLabel + ' (' + p.alignment + ')', centerX, y);
    y += 24;

    ctx.fillStyle = '#555555';
    ctx.fillRect(centerX - 80, y, 160, 1);
    y += 14;

    ctx.font = '6px ' + FONT;
    ctx.fillStyle = '#8B8B6B';
    ctx.textAlign = 'center';
    var ferryman = _getFerrymanDialogue(p.alignment);
    ctx.fillText('"' + ferryman + '"', centerX, y);
    y += 12;
    ctx.font = '5px ' + FONT;
    ctx.fillStyle = '#555555';
    ctx.fillText('\u2014 The Ferryman', centerX, y);
    y += 28;

    ctx.fillStyle = '#444444';
    ctx.fillRect(centerX - 80, y, 160, 1);
    y += 14;

    ctx.font = '6px ' + FONT;
    ctx.fillStyle = '#888888';
    ctx.fillText('INHERITANCE', centerX, y);
    y += 16;

    ctx.font = '5px ' + FONT;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#777777';
    var inhX = centerX - 70;

    ctx.fillText('Race:  ' + (ld.inherited_race || '?'), inhX, y);
    y += 10;
    ctx.fillText('Alignment Seed:  ' + (ld.inherited_alignment_seed || 0), inhX, y);
    y += 10;
    ctx.fillText('Mana Unlocked:  ' + (ld.inherited_mana_unlocked ? 'Yes' : 'No'), inhX, y);
    y += 10;
    var heirlooms = ld.inherited_heirlooms;
    var heirloomStr = (heirlooms && heirlooms.length > 0) ? heirlooms.join(', ') : 'None';
    ctx.fillText('Heirlooms:  ' + heirloomStr, inhX, y);
    y += 28;

    var btnW = 180;
    var btnH = 24;
    var btnX = centerX - btnW / 2;
    var btnY = y;

    ctx.fillStyle = '#C0392B';
    ctx.fillRect(btnX, btnY, btnW, btnH);

    ctx.strokeStyle = '#FF6655';
    ctx.lineWidth = 1;
    ctx.strokeRect(btnX, btnY, btnW, btnH);

    ctx.font = '7px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('BEGIN NEW LINEAGE', centerX, btnY + btnH / 2);

    deathScreen.buttonBounds = { x: btnX, y: btnY, w: btnW, h: btnH };
  }

  // ── Export ────────────────────────────────────────────────────────

  window.UI = {
    initHUD:                initHUD,
    renderHUD:              renderHUD,
    openInventory:          openInventory,
    closeInventory:         closeInventory,
    toggleInventory:        toggleInventory,
    openCharSheet:          openCharSheet,
    openMap:                openMap,
    openPauseMenu:          openPauseMenu,
    closeAllMenus:          closeAllMenus,
    showNotification:       showNotification,
    applyInsanityEffect:    applyInsanityEffect,
    isMenuOpen:             isMenuOpen,
    update:                 updateUI,
    showDeathScreen:        showDeathScreen,
    renderDeathScreen:      renderDeathScreen,
    showNPCDialogue:        showNPCDialogue,
    closeNPCDialogue:       closeNPCDialogue,
    handleNPCDialogueClick: handleNPCDialogueClick,
    handleNPCAction:        handleNPCAction,
    renderNPCMarkers:       renderNPCMarkers,
    initSpecter:            initSpecter,
    updateSpecter:          updateSpecter,
    renderSpecter:          renderSpecter,
    isSpecterActive:        isSpecterActive,
    isJailed:               function () { return jailState.active; },
    isNPCDialogueOpen:      function () { return npcDialogue.active; },
    loadInventoryItems:     loadInventoryItems,
  };
})();
