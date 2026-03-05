/**
 * Ashen Lineage — Master Init Script
 * Runs after all other scripts are loaded.
 * Handles session gating, character creation, game init, realtime, and game loop wiring.
 */
(function () {
  'use strict';

  var RACES = ['Gaian', 'Morvid', 'Azael', 'Vampire', 'Human', 'Dwarf'];
  var POSITION_BROADCAST_MS = 100;
  var REMOTE_LERP = 0.15;
  var NPC_INTERACT_RANGE = 48;
  var SPAWN_X = 100 * 16;
  var SPAWN_Y = 100 * 16;

  var SPRITE_MANIFEST = {
    player_default: 'assets/sprites/player_default.png',
    npc_doctor:     'assets/sprites/npc_doctor.png',
    npc_blacksmith: 'assets/sprites/npc_blacksmith.png',
    npc_trainer:    'assets/sprites/npc_trainer.png',
    npc_guard:      'assets/sprites/npc_guard.png',
    race_gaian:     'assets/sprites/race_gaian.png',
    race_morvid:    'assets/sprites/race_morvid.png',
    race_vampire:   'assets/sprites/race_vampire.png',
    race_azael:     'assets/sprites/race_azael.png',
    race_human:     'assets/sprites/race_human.png',
    race_dwarf:     'assets/sprites/race_dwarf.png',
    tileset_grass_stone: 'assets/tilesets/grass_stone.png',
    tileset_grass_mud:   'assets/tilesets/grass_mud.png',
    tileset_grass_snow:  'assets/tilesets/grass_snow.png',
    tileset_dungeon:     'assets/tilesets/dungeon.png',
  };

  // ── Shared state ───────────────────────────────────────────────

  var player = null;
  var remotePlayers = new Map();
  var canvas = null;
  var session = null;
  var profile = null;
  var planeChannel = null;
  var worldEventsChannel = null;
  var positionTimer = null;

  // ── DOM refs (set on DOMContentLoaded) ─────────────────────────

  var loadBarFill = null;
  var loadText = null;

  // ── Loading helpers ────────────────────────────────────────────

  function setLoadProgress(pct, msg) {
    if (loadBarFill) loadBarFill.style.width = Math.min(100, pct) + '%';
    if (loadText && msg) loadText.textContent = msg;
  }

  function hideLoadingScreen() {
    var el = document.getElementById('loadingScreen');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(function () { el.style.display = 'none'; }, 600);
  }

  // ═════════════════════════════════════════════════════════════════
  //  CHARACTER CREATION MODAL
  // ═════════════════════════════════════════════════════════════════

  function showCharCreateModal(userId, username) {
    var modal      = document.getElementById('charCreateModal');
    var usernameEl = document.getElementById('ccUsername');
    var raceDisp   = document.getElementById('ccRaceDisplay');
    var nameInput  = document.getElementById('ccNameInput');
    var submitBtn  = document.getElementById('ccSubmit');
    var errorEl    = document.getElementById('ccError');

    usernameEl.textContent = username || '';
    modal.classList.add('visible');

    var finalRace = RACES[Math.floor(Math.random() * RACES.length)];
    rollRaceAnimation(raceDisp, finalRace);

    function onSubmit() {
      var name = nameInput.value.trim();
      if (!name || name.length < 2) {
        errorEl.textContent = 'Name must be at least 2 characters.';
        return;
      }
      if (name.length > 20) {
        errorEl.textContent = 'Name must be 20 characters or fewer.';
        return;
      }

      errorEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = '...';

      var charObj = {
        user_id:        userId,
        name:           name,
        race:           finalRace,
        pos_x:          SPAWN_X,
        pos_y:          SPAWN_Y,
        hp:             100,
        max_hp:         100,
        mana:           0,
        max_mana:       100,
        stamina:        100,
        max_stamina:    100,
        silver:         0,
        valu:           0,
        insight:        0,
        alignment:      0,
        lives_remaining: 3,
        current_class:  'warrior',
        subclass:       null,
        class_tier:     'base',
        current_plane:  'gaia',
        current_zone:   'Spawn',
        insanity_stage: 0,
        injuries:       [],
        status_effects: [],
        is_online:      false,
      };

      SupabaseHelper.createCharacter(charObj).then(function (res) {
        if (res.error) {
          errorEl.textContent = res.error.message || 'Character creation failed.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'BEGIN YOUR LINEAGE';
          return;
        }
        modal.classList.remove('visible');
        modal.style.display = 'none';
        initGame(res.data);
      });
    }

    submitBtn.addEventListener('click', onSubmit);
    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') onSubmit();
    });
  }

  function rollRaceAnimation(el, finalRace) {
    var totalTicks = 25 + Math.floor(Math.random() * 10);
    var tick = 0;
    el.classList.remove('final');

    (function step() {
      if (tick >= totalTicks) {
        el.textContent = finalRace;
        el.classList.add('final');
        return;
      }
      el.textContent = RACES[Math.floor(Math.random() * RACES.length)];
      tick++;
      setTimeout(step, 50 + Math.pow(tick / totalTicks, 3) * 400);
    })();
  }

  // ═════════════════════════════════════════════════════════════════
  //  GAME INIT
  // ═════════════════════════════════════════════════════════════════

  function initGame(characterData) {
    setLoadProgress(20, 'Initializing engine...');

    canvas = document.getElementById('gameCanvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    canvas.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

    GameEngine.init(canvas);

    // Bridge camera property names for World compatibility
    var cam = GameEngine.getCamera();
    Object.defineProperty(cam, 'width',  { get: function () { return cam.viewWidth; },  configurable: true });
    Object.defineProperty(cam, 'height', { get: function () { return cam.viewHeight; }, configurable: true });

    setLoadProgress(30, 'Building world...');
    World.init(characterData.current_plane || 'gaia');

    // Expose pixel bounds so engine camera clamping works
    var wb = World.getWorldBounds();
    World.width  = wb.width;
    World.height = wb.height;

    // Let the engine's renderTiles() call work (World exposes render, not renderTiles)
    World.renderTiles = World.render;

    setLoadProgress(40, 'Creating player...');
    player = new Player(characterData);
    player.isLocalPlayer = true;

    SupabaseHelper.setCharacterOnline(player.id, true);

    setLoadProgress(50, 'Initializing systems...');
    UI.initHUD(player);
    Chat.init(player);
    Combat.initCombat(player);

    SupabaseHelper.loadInventory(player.id).then(function (result) {
      if (result.data) {
        UI.loadInventoryItems(result.data);
      }
    });

    setLoadProgress(60, 'Loading sprites...');
    loadSprites(function () {
      setLoadProgress(100, 'Entering world...');

      var raceSpriteKey = player.race ? 'race_' + player.race.toLowerCase() : null;
      var raceSprite = raceSpriteKey ? GameEngine.spriteLoader.getSprite(raceSpriteKey) : null;
      player.spriteSheet = raceSprite || GameEngine.spriteLoader.getSprite('player_default');

      // Wire tilesets to terrain types
      var tilesetMap = {
        1: 'tileset_grass_stone',   // STONE
        3: 'tileset_grass_mud',     // MUD
        4: 'tileset_grass_snow',    // SNOW
        5: 'tileset_dungeon',       // DUNGEON_FLOOR
      };
      for (var tileType in tilesetMap) {
        var tsImg = GameEngine.spriteLoader.getSprite(tilesetMap[tileType]);
        if (tsImg) {
          World.loadTilesetForType(parseInt(tileType), tsImg);
        }
      }

      injectGameLoopHooks();
      setupRealtimeSubscriptions();
      startPositionBroadcast();
      setupPageUnload();

      setTimeout(function () {
        hideLoadingScreen();
        GameEngine.start(player, World);
      }, 350);
    });
  }

  // ── Sprite Loading ─────────────────────────────────────────────

  function loadSprites(onComplete) {
    var keys = Object.keys(SPRITE_MANIFEST);
    if (keys.length === 0) { onComplete(); return; }

    var progressPoll = setInterval(function () {
      var p = GameEngine.spriteLoader.progress;
      var loaded = p.loaded;
      var total  = Math.max(1, p.total);
      setLoadProgress(60 + (loaded / total) * 35, 'Loading sprites (' + loaded + '/' + total + ')...');
    }, 120);

    GameEngine.spriteLoader.loadAll(SPRITE_MANIFEST)
      .then(function ()  { clearInterval(progressPoll); onComplete(); })
      .catch(function () { clearInterval(progressPoll); onComplete(); });
  }

  // ═════════════════════════════════════════════════════════════════
  //  GAME LOOP HOOKS
  // ═════════════════════════════════════════════════════════════════

  function injectGameLoopHooks() {
    var originalUpdate = Player.prototype.update;

    // Augmented update: runs input, base player logic, then subsystems
    player.update = function (dt, input) {
      if (input) handleInput(dt, input);
      originalUpdate.call(this, dt);

      Combat.updateCombat(dt, player, getRemotePlayersArray());
      Chat.updateBubbles(dt);
      UI.update(dt);
      updateRemotePlayers(dt);
    };

    // Render hook called by engine's renderUI phase
    player.renderHUD = function (ctx, cam) {
      // Remote players in world-space (zoomed transform is active)
      remotePlayers.forEach(function (rp) { rp.render(ctx, cam); });

      // Chat bubbles render in pixel-space (they apply zoom internally)
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      Chat.renderBubbles(ctx, cam);
      ctx.restore();

      // HUD overlay (operates in zoomed coordinates)
      UI.renderHUD(ctx, cam, canvas);

      // Zone visual effects
      World.applyZoneEffects(ctx, cam, player.x, player.y);

      // Insanity post-process
      if (player.insanityStage > 0) {
        UI.applyInsanityEffect(ctx, player.insanityStage, cam.viewWidth, cam.viewHeight);
      }

      // Death screen overlay (full-screen, drawn last)
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      UI.renderDeathScreen(ctx, 1 / 60);
      ctx.restore();
    };
  }

  // ═════════════════════════════════════════════════════════════════
  //  INPUT HANDLING
  // ═════════════════════════════════════════════════════════════════

  function handleInput(dt, input) {
    if (!player || player.isDown || player.isDead) return;
    if (Chat.isChatInputOpen()) return;

    if (UI.isNPCDialogueOpen()) {
      if (input.mouse.clicked) {
        var cam = GameEngine.getCamera();
        UI.handleNPCDialogueClick(input.mouse.x * cam.zoom, input.mouse.y * cam.zoom, cam.zoom);
        input.mouse.clicked = false;
      }
      if (input.keys.has('Escape') || input.keys.has('e')) {
        UI.closeNPCDialogue();
        input.keys.delete('Escape');
        input.keys.delete('e');
      }
      return;
    }

    if (UI.isMenuOpen()) {
      if (input.keys.has('Escape')) {
        UI.closeAllMenus();
        input.keys.delete('Escape');
      }
      return;
    }

    var keys = input.keys;
    var dx = 0;
    var dy = 0;

    if (keys.has('w') || keys.has('ArrowUp'))    dy -= 1;
    if (keys.has('s') || keys.has('ArrowDown'))  dy += 1;
    if (keys.has('a') || keys.has('ArrowLeft'))  dx -= 1;
    if (keys.has('d') || keys.has('ArrowRight')) dx += 1;

    if (input.isMobile && (input.joystick.dx || input.joystick.dy)) {
      dx = input.joystick.dx;
      dy = input.joystick.dy;
    }

    if (dx !== 0 && dy !== 0) {
      var len = Math.sqrt(dx * dx + dy * dy);
      dx /= len;
      dy /= len;
    }

    if (dx !== 0 || dy !== 0) {
      player.isSprinting = keys.has('Shift');
      player.move(dx, dy, dt);
    }

    if (input.mouse.clicked) {
      Combat.attackMelee(player);
      input.mouse.clicked = false;
    }

    if (keys.has('g')) {
      player.chargeMana(dt);
    }

    // Spell casting via number keys
    for (var si = 1; si <= 9; si++) {
      if (keys.has(String(si))) {
        var spellIdx = si - 1;
        if (player.knownSpells && spellIdx < player.knownSpells.length) {
          player.selectedSpell = spellIdx;
          player.castSpell(player.knownSpells[spellIdx]);
        }
        keys.delete(String(si));
      }
    }

    // Scroll spell selection with Q/R
    if (keys.has('q') && player.knownSpells && player.knownSpells.length > 0) {
      player.selectedSpell = (player.selectedSpell - 1 + player.knownSpells.length) % player.knownSpells.length;
      keys.delete('q');
    }
    if (keys.has('r') && player.knownSpells && player.knownSpells.length > 0) {
      player.selectedSpell = (player.selectedSpell + 1) % player.knownSpells.length;
      keys.delete('r');
    }

    // Dodge and parry
    if (keys.has(' ')) {
      Combat.dodge(player);
      keys.delete(' ');
    }
    if (keys.has('v')) {
      Combat.parry(player);
      keys.delete('v');
    }

    if (keys.has('e')) {
      checkNPCProximity();
      keys.delete('e');
    }

    if (keys.has('t')) {
      Chat.openChatInput();
      keys.delete('t');
    }

    if (keys.has('i')) {
      UI.toggleInventory();
      keys.delete('i');
    }

    if (keys.has('c')) {
      UI.openCharSheet();
      keys.delete('c');
    }

    if (keys.has('m')) {
      UI.openMap();
      keys.delete('m');
    }

    if (keys.has('Escape')) {
      UI.openPauseMenu();
      keys.delete('Escape');
    }

    player.isBlocking = keys.has('f');
  }

  function checkNPCProximity() {
    var npcs = World.getNPCs();
    var ts = World.TILE_SIZE;
    for (var i = 0; i < npcs.length; i++) {
      var n = npcs[i];
      var ndx = player.x - n.x * ts;
      var ndy = player.y - n.y * ts;
      if (Math.sqrt(ndx * ndx + ndy * ndy) < NPC_INTERACT_RANGE) {
        UI.showNPCDialogue(n, player, function (actionId, playerRef) {
          UI.handleNPCAction(actionId, playerRef);
        });
        return;
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════
  //  REALTIME SUBSCRIPTIONS
  // ═════════════════════════════════════════════════════════════════

  function setupRealtimeSubscriptions() {
    planeChannel = SupabaseHelper.subscribeToPlane(player.plane, onPresenceUpdate);

    setTimeout(function () {
      if (planeChannel && planeChannel.track) {
        planeChannel.track(player.toPresenceState());
      }
    }, 1000);

    worldEventsChannel = SupabaseHelper.subscribeToWorldEvents(onWorldEvent);
  }

  // ── Presence ───────────────────────────────────────────────────

  function onPresenceUpdate(state) {
    if (!state || !state.players) return;

    var list = state.players;
    var seen = new Set();

    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p.id || p.id === player.id) continue;

      seen.add(p.id);

      if (remotePlayers.has(p.id)) {
        var rp = remotePlayers.get(p.id);
        rp._targetX    = p.x;
        rp._targetY    = p.y;
        rp.hp          = p.hp;
        rp.maxHp       = p.maxHp;
        rp.facing      = p.facing;
        rp.animation   = p.animation;
        rp.isDown      = p.isDown;
        rp.name        = p.name;
        rp.race        = p.race;
        rp.alignment   = p.alignment;
        rp.currentClass = p.class;
      } else {
        addRemotePlayer(p);
      }
    }

    remotePlayers.forEach(function (_rp, id) {
      if (!seen.has(id)) {
        remotePlayers.delete(id);
      }
    });
  }

  function addRemotePlayer(p) {
    var rp = new Player({
      id:            p.id,
      name:          p.name,
      race:          p.race,
      pos_x:         p.x,
      pos_y:         p.y,
      hp:            p.hp  || 100,
      max_hp:        p.maxHp || 100,
      alignment:     p.alignment || 0,
      current_class: p.class || null,
    });

    rp.isLocalPlayer = false;
    rp._targetX = p.x;
    rp._targetY = p.y;

    // Assign sprite based on race or use default
    var raceSpriteKey = p.race ? 'race_' + p.race.toLowerCase() : null;
    var raceSprite = raceSpriteKey ? GameEngine.spriteLoader.getSprite(raceSpriteKey) : null;
    rp.spriteSheet = raceSprite || GameEngine.spriteLoader.getSprite('player_default') || null;

    rp.update = function (dt) {
      if (typeof this._targetX === 'number') {
        this.x += (this._targetX - this.x) * REMOTE_LERP;
        this.y += (this._targetY - this.y) * REMOTE_LERP;
      }
      this.animTimer += dt;
      if (this.animTimer >= 0.15) {
        this.animTimer -= 0.15;
        this.animFrame++;
      }
    };

    remotePlayers.set(p.id, rp);
  }

  function updateRemotePlayers(dt) {
    remotePlayers.forEach(function (rp) {
      rp.update(dt);
    });
  }

  function getRemotePlayersArray() {
    var arr = [];
    remotePlayers.forEach(function (rp) { arr.push(rp); });
    return arr;
  }

  // ── World Events ───────────────────────────────────────────────

  function onWorldEvent(event) {
    if (!event) return;
    var pl = event.payload || {};

    switch (event.event_type) {
      case 'spell_cast':
        UI.showNotification('A spell echoes across the plane...', '#6688ff', 2);
        break;

      case 'player_down':
        UI.showNotification((pl.target_name || 'A warrior') + ' has fallen!', '#ff4444', 4);
        break;

      case 'player_wiped':
        UI.showNotification((pl.name || 'A lineage') + ' has been extinguished.', '#ff2222', 5);
        break;

      case 'admin_teleport':
        if (pl.target_id === player.id) {
          player.x = pl.x || player.x;
          player.y = pl.y || player.y;
          if (pl.zone) player.zone = pl.zone;
          UI.showNotification('You have been teleported.', '#ffcc00', 3);
        }
        break;

      case 'player_gripped':
        UI.showNotification(
          (pl.attacker_name || '???') + ' gripped ' + (pl.target_name || '???'),
          '#cc4444', 4
        );
        break;
    }
  }

  // ═════════════════════════════════════════════════════════════════
  //  POSITION BROADCAST (100ms)
  // ═════════════════════════════════════════════════════════════════

  function startPositionBroadcast() {
    positionTimer = setInterval(function () {
      if (!player) return;
      player.broadcastPosition();
      if (planeChannel && planeChannel.track) {
        planeChannel.track(player.toPresenceState());
      }
    }, POSITION_BROADCAST_MS);
  }

  // ═════════════════════════════════════════════════════════════════
  //  PAGE UNLOAD
  // ═════════════════════════════════════════════════════════════════

  function setupPageUnload() {
    window.addEventListener('beforeunload', function () {
      if (player) {
        SupabaseHelper.setCharacterOnline(player.id, false);

        if (player.combatTagged) {
          SupabaseHelper.insertWorldEvent('combat_disconnect', {
            player_id:   player.id,
            player_name: player.name,
          }, player.plane, player.zone);
        }
      }
      if (positionTimer) clearInterval(positionTimer);
    });
  }

  // ═════════════════════════════════════════════════════════════════
  //  BOOT
  // ═════════════════════════════════════════════════════════════════

  document.addEventListener('DOMContentLoaded', function () {
    loadBarFill = document.getElementById('loadBarFill');
    loadText    = document.getElementById('loadText');

    setLoadProgress(5, 'Checking session...');

    SupabaseHelper.getSession().then(function (sessionResult) {
      session = sessionResult.data;
      if (!session) {
        window.location.href = 'index.html';
        return;
      }

      setLoadProgress(10, 'Loading profile...');

      SupabaseHelper.getProfile(session.user.id).then(function (profileResult) {
        profile = profileResult.data;

        setLoadProgress(15, 'Loading character...');

        SupabaseHelper.loadCharacter(session.user.id).then(function (charResult) {
          if (charResult.error) {
            setLoadProgress(0, 'Error: ' + (charResult.error.message || 'Failed to load character.'));
            return;
          }

          if (!charResult.data) {
            hideLoadingScreen();
            var username = (profile && profile.username) || session.user.email || 'Wanderer';
            showCharCreateModal(session.user.id, username);
          } else {
            initGame(charResult.data);
          }
        });
      });
    });
  });
})();
