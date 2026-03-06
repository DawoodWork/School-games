window.Combat = (function () {
  'use strict';

  // ── Spell Definitions ───────────────────────────────────────────────────────

  var SPELLS = {
    ignis: {
      id: 'ignis', cost: 20, type: 'projectile', damage: 25,
      status: 'onFire', statusDuration: 5, speed: 200,
      color: '#ff4400', trailColor: '#ff8800', label: 'Ignis',
    },
    gelidus: {
      id: 'gelidus', cost: 25, type: 'projectile', damage: 20,
      status: 'chilled', statusDuration: 4, speed: 180,
      color: '#44ccff', trailColor: '#88eeff', label: 'Gelidus',
    },
    tenebris: {
      id: 'tenebris', cost: 30, type: 'projectile', damage: 15,
      status: 'cursed', statusDuration: 0, speed: 160,
      color: '#6622aa', trailColor: '#9944dd', label: 'Tenebris',
    },
    viribus: {
      id: 'viribus', cost: 15, type: 'self_buff',
      buff: 'damageUp', buffAmount: 0.2, duration: 10,
      color: '#ffcc00', label: 'Viribus',
    },
    contrarium: {
      id: 'contrarium', cost: 35, type: 'projectile', damage: 10,
      status: 'manaLocked', statusDuration: 10, speed: 190,
      color: '#cc00cc', trailColor: '#ff44ff', label: 'Contrarium',
    },
    trickstus: {
      id: 'trickstus', cost: 20, type: 'teleport', distance: 120,
      color: '#00ffaa', label: 'Trickstus',
    },
    armis: {
      id: 'armis', cost: 10, type: 'self_buff',
      buff: 'manaShield', duration: Infinity,
      color: '#4488ff', label: 'Armis',
    },
    fimbulvetr: {
      id: 'fimbulvetr', cost: 80, type: 'aoe', damage: 40, radius: 200,
      status: 'frostbite', statusDuration: 8, duration: 1.5, uber: true,
      color: '#88ddff', label: 'Fimbulvetr',
    },
    manus_dei: {
      id: 'manus_dei', cost: 100, type: 'aoe', damage: 60, radius: 150,
      duration: 0.8, uber: true,
      color: '#ffee44', label: 'Manus Dei',
    },
  };

  // ── Constants ───────────────────────────────────────────────────────────────

  var COMBO_WINDOW = 0.8;
  var COMBO_DAMAGE = [10, 12, 12, 15, 20];
  var MELEE_RANGE = 32;
  var MELEE_ARC_WIDTH = 24;
  var HIT_FLASH_DURATION = 0.1;
  var PROJECTILE_MAX_RANGE = 600;
  var POSTURE_MAX = 100;
  var POSTURE_BLOCK_COST = 15;
  var POSTURE_REGEN_RATE = 10;
  var STAGGER_DURATION = 1.5;
  var STAGGER_CRIT_MULTIPLIER = 2.5;
  var DODGE_DISTANCE = 80;
  var DODGE_IFRAME_DURATION = 0.3;
  var DODGE_STAMINA_COST = 25;
  var PARRY_WINDOW = 0.2;
  var GRIP_DURATION = 2;
  var GRIP_ALIGNMENT_SHIFT = -20;
  var COMBAT_TAG_DURATION = 30;
  var POISON_DPS = 5;
  var POISON_DURATION = 20;

  var EQUIPMENT_STATS = {
    iron_sword:     { meleeDamage: 5 },
    steel_sword:    { meleeDamage: 8 },
    dark_blade:     { meleeDamage: 12 },
    steel_shield:   { maxPosture: 15 },
    iron_shield:    { maxPosture: 10 },
    leather_armor:  { damageReduction: 0.10 },
    chain_armor:    { damageReduction: 0.18 },
    plate_armor:    { damageReduction: 0.25 },
  };

  // ── Per-Player Combat State ─────────────────────────────────────────────────

  var combatStates = new Map();

  function getState(player) {
    if (!combatStates.has(player)) {
      combatStates.set(player, {
        comboCount: 0,
        comboTimer: 0,
        combatTagTimer: 0,
        combatTagged: false,
        dodgeTimer: 0,
        isDodging: false,
        dodgeVx: 0,
        dodgeVy: 0,
        parryTimer: 0,
        isParrying: false,
        posture: POSTURE_MAX,
        staggerTimer: 0,
        isStaggered: false,
        gripTimer: 0,
        gripTarget: null,
        isGripping: false,
        carryTarget: null,
        isCarrying: false,
        statuses: {},
        buffs: {},
        hitFlashTimer: 0,
      });
    }
    return combatStates.get(player);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function getFacingVector(player) {
    var dir = player.facing || 'south';
    switch (dir) {
      case 'up':    case 'north': return { x: 0, y: -1 };
      case 'down':  case 'south': return { x: 0, y: 1 };
      case 'left':  case 'west':  return { x: -1, y: 0 };
      case 'right': case 'east':  return { x: 1, y: 0 };
      default:      return { x: 0, y: 1 };
    }
  }

  function dist(ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function normalize(x, y) {
    var len = Math.sqrt(x * x + y * y);
    if (len === 0) return { x: 0, y: 0 };
    return { x: x / len, y: y / len };
  }

  function applyDamageMultipliers(amount, target, damageType) {
    var state = getState(target);
    var mult = 1;

    if (damageType === 'fire' && target.race === 'vampire') {
      mult += 0.5;
    }

    var cursedStacks = (state.statuses.cursed && state.statuses.cursed.stacks) || 0;
    if (cursedStacks > 0) {
      mult += 0.5 * Math.min(cursedStacks, 4);
    }

    if (state.isStaggered) {
      mult *= STAGGER_CRIT_MULTIPLIER;
    }

    if (target.equipment && target.equipment.armor) {
      var armorStats = EQUIPMENT_STATS[target.equipment.armor];
      if (armorStats && armorStats.damageReduction) {
        mult *= (1 - armorStats.damageReduction);
      }
    }

    return Math.round(amount * mult);
  }

  function setCombatTag(player) {
    var state = getState(player);
    state.combatTagged = true;
    state.combatTagTimer = COMBAT_TAG_DURATION;
  }

  // ── Melee Combo System ──────────────────────────────────────────────────────

  function attackMelee(player) {
    var state = getState(player);
    if (state.isStaggered || state.isGripping || state.isCarrying) return;

    var maxCombo = (player.injuries && player.injuries.indexOf('broken_arm') !== -1) ? 3 : 5;

    if (state.comboTimer <= 0 || state.comboCount >= maxCombo) {
      state.comboCount = 0;
    }

    var hitIndex = state.comboCount;
    var damage = COMBO_DAMAGE[hitIndex] || COMBO_DAMAGE[COMBO_DAMAGE.length - 1];

    if (player.equipment && player.equipment.weapon) {
      var weaponBonus = EQUIPMENT_STATS[player.equipment.weapon];
      if (weaponBonus && weaponBonus.meleeDamage) {
        damage += weaponBonus.meleeDamage;
      }
    }

    var attackerState = getState(player);
    if (attackerState.buffs.damageUp) {
      damage = Math.round(damage * (1 + attackerState.buffs.damageUp.amount));
    }

    state.comboCount++;
    state.comboTimer = COMBO_WINDOW;

    var facing = getFacingVector(player);
    var px = (player.x || 0) + (player.width || 16) / 2;
    var py = (player.y || 0) + (player.height || 16) / 2;
    var hbx = px + facing.x * (MELEE_RANGE / 2) - MELEE_ARC_WIDTH / 2;
    var hby = py + facing.y * (MELEE_RANGE / 2) - MELEE_ARC_WIDTH / 2;

    var targets = window.GameEngine.getEntitiesInRect(
      hbx, hby, MELEE_ARC_WIDTH, MELEE_ARC_WIDTH
    );

    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (t === player || t.dead) continue;
      takeDamage(t, damage, player, 'melee');
    }

    setCombatTag(player);
  }

  // ── Spell System ────────────────────────────────────────────────────────────

  function castSpell(player, spellId, targetPos) {
    var spell = SPELLS[spellId];
    if (!spell) return false;

    var state = getState(player);
    if (state.isStaggered) return false;
    if (state.statuses.blackFlames && spell.type !== 'self_buff') return false;
    if (state.statuses.manaLocked) return false;

    if (spell.uber && !player.isUber) return false;

    var mana = player.mana !== undefined ? player.mana : 0;
    if (mana < spell.cost) return false;

    player.mana = mana - spell.cost;

    switch (spell.type) {
      case 'projectile':
        spawnProjectile(player, spell, targetPos);
        break;
      case 'aoe':
        spawnAoe(player, spell, targetPos);
        break;
      case 'self_buff':
        applySelfBuff(player, spell);
        break;
      case 'teleport':
        executeTeleport(player, spell);
        break;
    }

    setCombatTag(player);
    return true;
  }

  function spawnProjectile(player, spell, targetPos) {
    var px = (player.x || 0) + (player.width || 16) / 2;
    var py = (player.y || 0) + (player.height || 16) / 2;

    var dx, dy;
    if (targetPos) {
      dx = targetPos.x - px;
      dy = targetPos.y - py;
    } else {
      var facing = getFacingVector(player);
      dx = facing.x;
      dy = facing.y;
    }

    var dir = normalize(dx, dy);
    var proj = new Projectile(
      px, py,
      dir.x * spell.speed, dir.y * spell.speed,
      spell, player.id || player
    );
    window.GameEngine.addEntity(proj);
  }

  function spawnAoe(player, spell, targetPos) {
    var cx, cy;
    if (targetPos) {
      cx = targetPos.x;
      cy = targetPos.y;
    } else {
      cx = (player.x || 0) + (player.width || 16) / 2;
      cy = (player.y || 0) + (player.height || 16) / 2;
    }

    var aoe = new AoeEffect(
      cx, cy,
      spell.radius, spell, player.id || player,
      spell.duration
    );
    window.GameEngine.addEntity(aoe);
  }

  function applySelfBuff(player, spell) {
    var state = getState(player);

    if (spell.buff === 'damageUp') {
      state.buffs.damageUp = { amount: spell.buffAmount, timer: spell.duration };
    } else if (spell.buff === 'manaShield') {
      state.buffs.manaShield = { active: true, timer: spell.duration };
    }
  }

  function executeTeleport(player, spell) {
    var facing = getFacingVector(player);
    player.x = (player.x || 0) + facing.x * spell.distance;
    player.y = (player.y || 0) + facing.y * spell.distance;
  }

  // ── Special Actions ─────────────────────────────────────────────────────────

  function dodge(player) {
    var state = getState(player);
    if (state.isDodging || state.isStaggered || state.isGripping || state.isCarrying) return false;
    if (state.statuses.blackFlames) return false;

    var stamina = player.stamina !== undefined ? player.stamina : 0;
    if (stamina < DODGE_STAMINA_COST) return false;

    player.stamina = stamina - DODGE_STAMINA_COST;

    var facing = getFacingVector(player);
    state.isDodging = true;
    state.dodgeTimer = DODGE_IFRAME_DURATION;
    state.dodgeVx = facing.x * (DODGE_DISTANCE / DODGE_IFRAME_DURATION);
    state.dodgeVy = facing.y * (DODGE_DISTANCE / DODGE_IFRAME_DURATION);

    return true;
  }

  function parry(player) {
    var state = getState(player);
    if (state.isStaggered || state.isDodging || state.isParrying) return false;

    state.isParrying = true;
    state.parryTimer = PARRY_WINDOW;
    return true;
  }

  function gripPlayer(attacker, target) {
    if (!target || !target.isDown) return false;
    var state = getState(attacker);
    if (state.isGripping || state.isStaggered) return false;

    var d = dist(
      attacker.x || 0, attacker.y || 0,
      target.x || 0, target.y || 0
    );
    if (d > 40) return false;

    state.isGripping = true;
    state.gripTarget = target;
    state.gripTimer = GRIP_DURATION;
    return true;
  }

  function carryPlayer(carrier, target) {
    if (!target || !target.isDown) return false;
    var state = getState(carrier);
    if (state.isCarrying || state.isGripping || state.isStaggered) return false;

    var d = dist(
      carrier.x || 0, carrier.y || 0,
      target.x || 0, target.y || 0
    );
    if (d > 40) return false;

    state.isCarrying = true;
    state.carryTarget = target;

    if (carrier.baseSpeed) {
      carrier.speed = carrier.baseSpeed * 0.5;
    } else if (carrier.speed) {
      carrier.baseSpeed = carrier.speed;
      carrier.speed = carrier.speed * 0.5;
    }

    return true;
  }

  // ── Damage Pipeline ─────────────────────────────────────────────────────────

  function takeDamage(target, amount, source, damageType) {
    if (!target || target.dead) return;

    var tState = getState(target);

    if (tState.isDodging) return;

    if (tState.isParrying) {
      if (source) {
        var sState = getState(source);
        sState.isStaggered = true;
        sState.staggerTimer = 1;
      }
      return;
    }

    if (tState.buffs.manaShield && tState.buffs.manaShield.active) {
      tState.buffs.manaShield = null;
      return;
    }

    var finalDamage = applyDamageMultipliers(amount, target, damageType);

    if (target.blocking) {
      tState.posture -= POSTURE_BLOCK_COST;
      if (tState.posture <= 0) {
        tState.posture = 0;
        tState.isStaggered = true;
        tState.staggerTimer = STAGGER_DURATION;
        target.blocking = false;
      }
      return;
    }

    if (typeof target.hp === 'number') {
      target.hp -= finalDamage;
      if (target.hp <= 0) {
        target.hp = 0;
        if (typeof target.goDown === 'function') {
          target.goDown();
        } else {
          target.isDown = true;
        }
      }
    }

    tState.hitFlashTimer = HIT_FLASH_DURATION;

    setCombatTag(target);
    if (source) setCombatTag(source);

    if (damageType === 'fire' && target.race === 'vampire') {
      applyStatus(target, 'onFire', 5);
    }
  }

  // ── Status Effects ──────────────────────────────────────────────────────────

  function applyStatus(target, statusId, duration) {
    var state = getState(target);

    if (statusId === 'cursed') {
      if (!state.statuses.cursed) {
        state.statuses.cursed = { stacks: 1, timer: 30 };
      } else if (state.statuses.cursed.stacks < 4) {
        state.statuses.cursed.stacks++;
      }
      return;
    }

    state.statuses[statusId] = { timer: duration || 10 };
  }

  function updateStatuses(dt, target) {
    var state = getState(target);
    var keys = Object.keys(state.statuses);
    for (var i = 0; i < keys.length; i++) {
      var sid = keys[i];
      var s = state.statuses[sid];

      if (sid === 'onFire') {
        // visual only — damage handled by source spell
      }

      if (sid === 'poison') {
        if (typeof target.hp === 'number') {
          target.hp -= POISON_DPS * dt;
          if (target.hp <= 0) {
            target.hp = 0;
            if (typeof target.goDown === 'function') {
              target.goDown();
            } else {
              target.isDown = true;
            }
          }
        }
      }

      s.timer -= dt;
      if (s.timer <= 0) {
        delete state.statuses[sid];
      }
    }
  }

  // ── Posture ─────────────────────────────────────────────────────────────────

  function getMaxPosture(target) {
    var max = POSTURE_MAX;
    if (target.equipment && target.equipment.shield) {
      var shieldStats = EQUIPMENT_STATS[target.equipment.shield];
      if (shieldStats && shieldStats.maxPosture) {
        max += shieldStats.maxPosture;
      }
    }
    return max;
  }

  function updatePosture(dt, target) {
    var state = getState(target);
    var max = getMaxPosture(target);
    if (!target.blocking && state.posture < max) {
      state.posture = Math.min(max, state.posture + POSTURE_REGEN_RATE * dt);
    }
  }

  // ── Core Update ─────────────────────────────────────────────────────────────

  function updateCombat(dt, player, entities) {
    var state = getState(player);

    // Combo timer
    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) {
        state.comboCount = 0;
      }
    }

    // Combat tag
    if (state.combatTagTimer > 0) {
      state.combatTagTimer -= dt;
      if (state.combatTagTimer <= 0) {
        state.combatTagged = false;
      }
    }

    // Dodge movement
    if (state.isDodging) {
      player.x = (player.x || 0) + state.dodgeVx * dt;
      player.y = (player.y || 0) + state.dodgeVy * dt;
      state.dodgeTimer -= dt;
      if (state.dodgeTimer <= 0) {
        state.isDodging = false;
        state.dodgeVx = 0;
        state.dodgeVy = 0;
      }
    }

    // Parry window
    if (state.isParrying) {
      state.parryTimer -= dt;
      if (state.parryTimer <= 0) {
        state.isParrying = false;
      }
    }

    // Stagger recovery
    if (state.isStaggered) {
      state.staggerTimer -= dt;
      if (state.staggerTimer <= 0) {
        state.isStaggered = false;
        state.posture = POSTURE_MAX * 0.3;
      }
    }

    // Hit flash
    if (state.hitFlashTimer > 0) {
      state.hitFlashTimer -= dt;
    }

    // Grip progress
    if (state.isGripping) {
      state.gripTimer -= dt;
      if (state.gripTimer <= 0) {
        completeGrip(player, state.gripTarget);
        state.isGripping = false;
        state.gripTarget = null;
      }
    }

    // Carry sync
    if (state.isCarrying && state.carryTarget) {
      state.carryTarget.x = player.x;
      state.carryTarget.y = (player.y || 0) - 8;
    }

    // Buff timers
    var buffKeys = Object.keys(state.buffs);
    for (var b = 0; b < buffKeys.length; b++) {
      var buff = state.buffs[buffKeys[b]];
      if (!buff) continue;
      if (buff.timer !== Infinity) {
        buff.timer -= dt;
        if (buff.timer <= 0) {
          delete state.buffs[buffKeys[b]];
        }
      }
    }

    updateStatuses(dt, player);
    updatePosture(dt, player);

    // Sync combat state back to player object so UI/player code can read it
    player.combatTagged = state.combatTagged;
    player.posture = state.posture;
    player.maxPosture = getMaxPosture(player);
    player.isStaggered = state.isStaggered;
    player.isDodging = state.isDodging;

    var syncedStatuses = {};
    var statusKeys = Object.keys(state.statuses);
    for (var si = 0; si < statusKeys.length; si++) {
      syncedStatuses[statusKeys[si]] = {
        timer: state.statuses[statusKeys[si]].timer,
        stacks: state.statuses[statusKeys[si]].stacks || 0
      };
    }
    player.statusEffects = syncedStatuses;

    // Update all entities that belong to combat (projectiles, aoe)
    if (entities) {
      for (var i = entities.length - 1; i >= 0; i--) {
        var e = entities[i];
        if ((e instanceof Projectile || e instanceof AoeEffect) && typeof e.update === 'function') {
          e.update(dt);
        }
      }
    }
  }

  function completeGrip(attacker, target) {
    if (!target) return;

    if (typeof attacker.alignment === 'number') {
      attacker.alignment += GRIP_ALIGNMENT_SHIFT;
    }

    if (window.SupabaseHelper && window.SupabaseHelper.insertWorldEvent) {
      window.SupabaseHelper.insertWorldEvent('player_gripped', {
        attacker_id: attacker.id,
        target_id: target.id,
        attacker_name: attacker.name || 'Unknown',
        target_name: target.name || 'Unknown',
      }, attacker.plane || 'gaia', attacker.zone || 'unknown');
    }

    if (typeof target.executeGrip === 'function') {
      target.executeGrip();
    } else {
      if (typeof target.lives === 'number') {
        target.lives -= 1;
      }
    }
  }

  // ── Combat Tag Query ────────────────────────────────────────────────────────

  function getCombatTimeRemaining(player) {
    var state = getState(player);
    return state.combatTagged ? Math.ceil(state.combatTagTimer) : 0;
  }

  // ── Projectile Entity ───────────────────────────────────────────────────────

  function Projectile(x, y, vx, vy, spellDef, casterId) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.spellDef = spellDef;
    this.casterId = casterId;
    this.originX = x;
    this.originY = y;
    this.width = 6;
    this.height = 6;
    this.alive = true;
    this.type = 'projectile';
  }

  Projectile.prototype.update = function (dt) {
    if (!this.alive) return;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    var traveled = dist(this.originX, this.originY, this.x, this.y);
    if (traveled >= PROJECTILE_MAX_RANGE) {
      this.destroy();
      return;
    }

    var nearby = window.GameEngine.getEntitiesInRect(
      this.x - this.width / 2, this.y - this.height / 2,
      this.width, this.height
    );

    for (var i = 0; i < nearby.length; i++) {
      var e = nearby[i];
      if (e === this) continue;
      if (e instanceof Projectile || e instanceof AoeEffect) continue;
      if ((e.id || e) === this.casterId) continue;
      if (e.dead) continue;

      takeDamage(e, this.spellDef.damage, { id: this.casterId }, this.getDamageType());

      if (this.spellDef.status) {
        applyStatus(e, this.spellDef.status, this.spellDef.statusDuration);
      }

      this.destroy();
      return;
    }
  };

  Projectile.prototype.getDamageType = function () {
    switch (this.spellDef.id) {
      case 'ignis': return 'fire';
      case 'gelidus': return 'ice';
      case 'tenebris': return 'shadow';
      case 'contrarium': return 'antimana';
      default: return 'magic';
    }
  };

  Projectile.prototype.render = function (ctx, camera) {
    if (!this.alive) return;

    var sx = this.x - camera.x;
    var sy = this.y - camera.y;

    // Try to use spell effect sprite
    var spellSprite = window.GameEngine && window.GameEngine.spriteLoader && window.GameEngine.spriteLoader.getSprite('spell_effects');
    var spellSpriteMap = {
      ignis: { col: 0, row: 0 },
      gelidus: { col: 1, row: 0 },
      tenebris: { col: 2, row: 0 },
      viribus: { col: 0, row: 1 },
      contrarium: { col: 1, row: 1 },
      trickstus: { col: 2, row: 1 },
      armis: { col: 0, row: 2 },
      fimbulvetr: { col: 1, row: 2 },
      manus_dei: { col: 2, row: 2 },
    };

    if (spellSprite && spellSpriteMap[this.spellDef.id]) {
      var spritePos = spellSpriteMap[this.spellDef.id];
      
      // Add rotation based on velocity direction
      var angle = Math.atan2(this.vy, this.vx);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(angle);
      
      // Draw spell effect sprite
      ctx.drawImage(
        spellSprite,
        spritePos.col * 16, spritePos.row * 16, 16, 16,
        -8, -8, 16, 16
      );
      
      ctx.restore();
    } else {
      // Fallback to original circle rendering
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fillStyle = this.spellDef.color || '#ffffff';
      ctx.fill();
      ctx.closePath();

      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fillStyle = this.spellDef.trailColor || this.spellDef.color || '#ffffff';
      ctx.globalAlpha = 0.3;
      ctx.fill();
      ctx.closePath();
      ctx.globalAlpha = 1;
    }

    // Add particle trail effect for better visual impact
    this._drawTrail(ctx, sx, sy);
  };

  Projectile.prototype._drawTrail = function (ctx, sx, sy) {
    // Draw a simple particle trail
    var trailLength = 3;
    for (var i = 1; i <= trailLength; i++) {
      var alpha = 0.5 - (i / trailLength) * 0.4;
      var size = 2 - (i / trailLength);
      var trailX = sx - (this.vx / 60) * i * 2; // Trail behind projectile
      var trailY = sy - (this.vy / 60) * i * 2;
      
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(trailX, trailY, size, 0, Math.PI * 2);
      ctx.fillStyle = this.spellDef.trailColor || this.spellDef.color || '#ffffff';
      ctx.fill();
      ctx.closePath();
    }
    ctx.globalAlpha = 1;
  };

  Projectile.prototype.destroy = function () {
    this.alive = false;
    window.GameEngine.removeEntity(this);
  };

  // ── AoE Entity ──────────────────────────────────────────────────────────────

  function AoeEffect(x, y, radius, spellDef, casterId, duration) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.spellDef = spellDef;
    this.casterId = casterId;
    this.duration = duration;
    this.elapsed = 0;
    this.alive = true;
    this.hasAppliedDamage = false;
    this.type = 'aoe';
    this.width = radius * 2;
    this.height = radius * 2;
  }

  AoeEffect.prototype.update = function (dt) {
    if (!this.alive) return;

    this.elapsed += dt;

    if (!this.hasAppliedDamage) {
      this.hasAppliedDamage = true;

      var nearby = window.GameEngine.getEntitiesInRect(
        this.x - this.radius, this.y - this.radius,
        this.radius * 2, this.radius * 2
      );

      for (var i = 0; i < nearby.length; i++) {
        var e = nearby[i];
        if (e === this || e instanceof Projectile || e instanceof AoeEffect) continue;
        if ((e.id || e) === this.casterId) continue;
        if (e.dead) continue;

        var d = dist(this.x, this.y,
          (e.x || 0) + (e.width || 0) / 2,
          (e.y || 0) + (e.height || 0) / 2);
        if (d > this.radius) continue;

        takeDamage(e, this.spellDef.damage, { id: this.casterId }, 'magic');

        if (this.spellDef.status) {
          applyStatus(e, this.spellDef.status, this.spellDef.statusDuration);
        }
      }
    }

    if (this.elapsed >= this.duration) {
      this.alive = false;
      window.GameEngine.removeEntity(this);
    }
  };

  AoeEffect.prototype.render = function (ctx, camera) {
    if (!this.alive) return;

    var sx = this.x - camera.x;
    var sy = this.y - camera.y;
    var progress = Math.min(this.elapsed / this.duration, 1);
    var currentRadius = this.radius * progress;

    ctx.beginPath();
    ctx.arc(sx, sy, currentRadius, 0, Math.PI * 2);
    ctx.fillStyle = this.spellDef.color || '#ffffff';
    ctx.globalAlpha = 0.25 * (1 - progress);
    ctx.fill();
    ctx.closePath();

    ctx.beginPath();
    ctx.arc(sx, sy, currentRadius, 0, Math.PI * 2);
    ctx.strokeStyle = this.spellDef.color || '#ffffff';
    ctx.globalAlpha = 0.6 * (1 - progress);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.closePath();

    ctx.globalAlpha = 1;
  };

  // ── Init ────────────────────────────────────────────────────────────────────

  function initCombat(player) {
    var state = getState(player);
    state.comboCount = 0;
    state.comboTimer = 0;
    state.combatTagTimer = 0;
    state.combatTagged = false;
    state.dodgeTimer = 0;
    state.isDodging = false;
    state.parryTimer = 0;
    state.isParrying = false;
    state.posture = POSTURE_MAX;
    state.staggerTimer = 0;
    state.isStaggered = false;
    state.gripTimer = 0;
    state.gripTarget = null;
    state.isGripping = false;
    state.carryTarget = null;
    state.isCarrying = false;
    state.statuses = {};
    state.buffs = {};
    state.hitFlashTimer = 0;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  return {
    initCombat: initCombat,
    attackMelee: attackMelee,
    castSpell: castSpell,
    dodge: dodge,
    parry: parry,
    gripPlayer: gripPlayer,
    carryPlayer: carryPlayer,
    takeDamage: takeDamage,
    updateCombat: updateCombat,
    getCombatTimeRemaining: getCombatTimeRemaining,
    SPELLS: SPELLS,
    EQUIPMENT_STATS: EQUIPMENT_STATS,
  };
})();
