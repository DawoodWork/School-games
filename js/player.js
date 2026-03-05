/**
 * Ashen Lineage — Player Class
 * Handles local and remote player state, movement, combat, status effects,
 * injuries, insanity, alignment, and Supabase sync.
 */
(function () {
  'use strict';

  var MOVE_SPEED = 120;
  var SPRINT_STAMINA_COST = 30;
  var STAMINA_REGEN_IDLE = 15;
  var STAMINA_REGEN_WALK = 5;
  var MANA_CHARGE_RATE = 20;
  var BLEEDOUT_DURATION = 30;
  var COMBO_TIMEOUT = 1.5;
  var STAGGER_DURATION = 1.0;
  var COMBAT_TAG_DURATION = 10;
  var SYNC_DEBOUNCE_MS = 500;
  var ANIM_FRAME_DURATION = 0.15;
  var PLAYER_W = 12;
  var PLAYER_H = 16;

  var INJURY_TYPES = ['broken_arm', 'broken_leg', 'slash_wound', 'cataracts', 'anemia'];

  var STATUS_CONFIG = {
    onFire:      { dps: 8,  visual: false },
    blackFlames: { dps: 0,  visual: false },
    cursed:      { dps: 0,  visual: false },
    chilled:     { dps: 0,  visual: false },
    frostbite:   { dps: 5,  visual: false },
    manaLocked:  { dps: 0,  visual: false },
    blinded:     { dps: 0,  visual: true  },
    poisoned:    { dps: 5,  visual: false },
    anemia:      { dps: 0,  visual: true  },
  };

  // ── Constructor ──────────────────────────────────────────────────

  function Player(characterData) {
    var d = characterData || {};

    this.id            = d.id;
    this.userId        = d.user_id;
    this.name          = d.name;
    this.race          = d.race;
    this.x             = d.pos_x || 0;
    this.y             = d.pos_y || 0;
    this.hp            = d.hp || 100;
    this.maxHp         = d.max_hp || 100;
    this.mana          = d.mana || 0;
    this.maxMana       = d.max_mana || 100;
    this.stamina       = d.stamina || 100;
    this.maxStamina    = d.max_stamina || 100;
    this.silver        = d.silver || 0;
    this.valu          = d.valu || 0;
    this.insight       = d.insight || 0;
    this.alignment     = d.alignment || 0;
    this.lives         = d.lives_remaining || 3;
    this.currentClass  = d.current_class || null;
    this.subclass      = d.subclass || null;
    this.classTier     = d.class_tier || 0;
    this.plane         = d.current_plane || 'gaia';
    this.zone          = d.current_zone || 'Spawn';
    this.insanityStage = d.insanity_stage || 0;
    this.injuries      = d.injuries ? d.injuries.slice() : [];
    this.statusEffects = d.status_effects ? d.status_effects.slice() : [];
    this.isLocalPlayer = false;

    this.width  = PLAYER_W;
    this.height = PLAYER_H;

    // Physics / motion
    this.velocityX = 0;
    this.velocityY = 0;

    // Down / bleedout
    this.isDown    = false;
    this.downTimer = 0;

    // Combat
    this.combatTagged = false;
    this.combatTimer  = 0;

    // Actions
    this.isSprinting    = false;
    this.isBlocking     = false;
    this.isChargingMana = false;

    // Combo
    this.comboCount = 0;
    this.comboTimer = 0;

    // Posture / stagger
    this.posture      = 100;
    this.maxPosture   = 100;
    this.isStaggered  = false;
    this.staggerTimer = 0;

    // Animation
    this.animation = 'idle';
    this.animFrame = 0;
    this.animTimer = 0;
    this.facing    = 'south';

    // Sprite
    this.spriteSheet = null;

    // Damage flash
    this._flashTimer = 0;

    // Sync debounce
    this._syncTimeout = null;
    this._lastSyncTime = 0;
  }

  // ── isDead getter ────────────────────────────────────────────────

  Object.defineProperty(Player.prototype, 'isDead', {
    get: function () {
      return this.lives <= 0 && this.isDown;
    },
  });

  // ── Movement ─────────────────────────────────────────────────────

  Player.prototype.move = function (dx, dy, dt) {
    if (this.isDown || this.isStaggered) return;

    var speed = MOVE_SPEED;

    if (this.isSprinting && this.stamina > 0) {
      speed *= 1.5;
      this.stamina -= SPRINT_STAMINA_COST * dt;
      if (this.stamina < 0) this.stamina = 0;
    }

    if (this.injuries.indexOf('broken_leg') !== -1) {
      speed *= 0.8;
    }

    if (this._hasStatus('chilled')) {
      speed *= 0.7;
    }

    var nx = this.x + dx * speed * dt;
    var ny = this.y + dy * speed * dt;

    if (World.isWalkable(nx, this.y)) {
      this.x = nx;
    }
    if (World.isWalkable(this.x, ny)) {
      this.y = ny;
    }

    this._updateFacing(dx, dy);

    this.velocityX = dx * speed;
    this.velocityY = dy * speed;
  };

  Player.prototype._updateFacing = function (dx, dy) {
    if (dx === 0 && dy === 0) return;
    if (Math.abs(dy) >= Math.abs(dx)) {
      this.facing = dy > 0 ? 'south' : 'north';
    } else {
      this.facing = dx > 0 ? 'east' : 'west';
    }
  };

  // ── Mana ─────────────────────────────────────────────────────────

  Player.prototype.chargeMana = function (dt) {
    if (this.isDown) return;
    if (this._hasStatus('manaLocked') || this._hasStatus('blackFlames')) return;

    this.isChargingMana = true;
    this.mana = Math.min(this.maxMana, this.mana + MANA_CHARGE_RATE * dt);
  };

  Player.prototype.castSpell = function (spellId) {
    if (this.isDown) return false;
    if (this._hasStatus('manaLocked') || this._hasStatus('blackFlames')) return false;

    var cost = this._getSpellCost(spellId);
    if (this.mana < cost) return false;

    this.mana -= cost;
    return true;
  };

  Player.prototype._getSpellCost = function (spellId) {
    var costs = { fireball: 30, heal: 40, shield: 25, bolt: 20 };
    return costs[spellId] || 25;
  };

  // ── Injury ───────────────────────────────────────────────────────

  Player.prototype.addInjury = function (type) {
    if (INJURY_TYPES.indexOf(type) === -1) return;
    if (this.injuries.indexOf(type) !== -1) return;

    this.injuries.push(type);
    this._applyInjuryEffects(type);
  };

  Player.prototype.removeInjury = function (type) {
    var idx = this.injuries.indexOf(type);
    if (idx !== -1) {
      this.injuries.splice(idx, 1);
      this._removeInjuryEffects(type);
    }
  };

  Player.prototype._applyInjuryEffects = function (type) {
    if (type === 'slash_wound') {
      this.maxHp -= 20;
      if (this.hp > this.maxHp) this.hp = this.maxHp;
    }
  };

  Player.prototype._removeInjuryEffects = function (type) {
    if (type === 'slash_wound') {
      this.maxHp += 20;
    }
  };

  Player.prototype._getMaxCombo = function () {
    return this.injuries.indexOf('broken_arm') !== -1 ? 3 : Infinity;
  };

  // ── Insanity ─────────────────────────────────────────────────────

  Player.prototype.setInsanityStage = function (n) {
    this.insanityStage = Math.max(0, Math.min(5, n));
  };

  // ── Status Effects ───────────────────────────────────────────────

  Player.prototype.applyStatus = function (type, duration) {
    if (!STATUS_CONFIG[type]) return;
    this.statusEffects.push({ type: type, remaining: duration });
  };

  Player.prototype.updateStatuses = function (dt) {
    for (var i = this.statusEffects.length - 1; i >= 0; i--) {
      var se = this.statusEffects[i];
      se.remaining -= dt;

      var cfg = STATUS_CONFIG[se.type];
      if (cfg && cfg.dps > 0) {
        this._rawDamage(cfg.dps * dt);
      }

      if (se.remaining <= 0) {
        this.statusEffects.splice(i, 1);
      }
    }
  };

  Player.prototype._hasStatus = function (type) {
    for (var i = 0; i < this.statusEffects.length; i++) {
      if (this.statusEffects[i].type === type) return true;
    }
    return false;
  };

  Player.prototype._statusStackCount = function (type) {
    var count = 0;
    for (var i = 0; i < this.statusEffects.length; i++) {
      if (this.statusEffects[i].type === type) count++;
    }
    return count;
  };

  // ── Damage ───────────────────────────────────────────────────────

  Player.prototype.takeDamage = function (amount, source) {
    if (this.isDown) return;

    var cursedStacks = this._statusStackCount('cursed');
    var multiplier = 1 + cursedStacks * 0.5;
    var finalDmg = Math.round(amount * multiplier);

    this.hp -= finalDmg;
    this._flashTimer = 0.12;
    this.combatTagged = true;
    this.combatTimer = COMBAT_TAG_DURATION;

    if (this.hp <= 0) {
      this.hp = 0;
      this.goDown();
    }
  };

  Player.prototype._rawDamage = function (amount) {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.goDown();
    }
  };

  Player.prototype.goDown = function () {
    if (this.isDown) return;
    this.isDown = true;
    this.downTimer = BLEEDOUT_DURATION;
    this.animation = 'down';
  };

  Player.prototype.executeGrip = function (byPlayerId) {
    this.lives--;
    this.isDown = false;
    this.downTimer = 0;

    if (this.isLocalPlayer) {
      SupabaseHelper.insertWorldEvent('execute_grip', {
        victim: this.id,
        killer: byPlayerId,
      }, this.plane, this.zone);
    }

    if (this.lives <= 0) {
      this.wipe();
    }
  };

  Player.prototype.wipe = function () {
    return {
      id:         this.id,
      name:       this.name,
      race:       this.race,
      class:      this.currentClass,
      subclass:   this.subclass,
      classTier:  this.classTier,
      alignment:  this.alignment,
      insight:    this.insight,
      silver:     this.silver,
      valu:       this.valu,
      injuries:   this.injuries.slice(),
      insanity:   this.insanityStage,
      plane:      this.plane,
      zone:       this.zone,
      ancestor_character_id: this.id,
      inherited_race: this.race,
      inherited_alignment_seed: this.alignment,
      inherited_heirlooms: this.injuries,
      inherited_mana_unlocked: this.mana > 0,
      wipe_reason: 'death',
    };
  };

  // ── Alignment ────────────────────────────────────────────────────

  Player.prototype.changeAlignment = function (delta) {
    this.alignment = Math.max(-400, Math.min(400, this.alignment + delta));
  };

  Player.prototype.getAlignmentLabel = function () {
    if (this.alignment <= -200) return 'Corrupt';
    if (this.alignment <= -1)   return 'Chaotic';
    if (this.alignment <= 100)  return 'Neutral';
    if (this.alignment <= 300)  return 'Orderly';
    return 'Ordained';
  };

  // ── Supabase Sync ────────────────────────────────────────────────

  Player.prototype.syncToSupabase = function () {
    var self = this;
    if (self._syncTimeout) return;

    self._syncTimeout = setTimeout(function () {
      self._syncTimeout = null;
      SupabaseHelper.updateCharacterStats(self.id, {
        hp:              self.hp,
        max_hp:          self.maxHp,
        mana:            self.mana,
        max_mana:        self.maxMana,
        stamina:         self.stamina,
        max_stamina:     self.maxStamina,
        silver:          self.silver,
        valu:            self.valu,
        insight:         self.insight,
        alignment:       self.alignment,
        lives_remaining: self.lives,
        current_class:   self.currentClass,
        subclass:        self.subclass,
        class_tier:      self.classTier,
        current_plane:   self.plane,
        current_zone:    self.zone,
        insanity_stage:  self.insanityStage,
        injuries:        self.injuries,
        status_effects:  self.statusEffects,
      });
    }, SYNC_DEBOUNCE_MS);
  };

  Player.prototype.broadcastPosition = function () {
    SupabaseHelper.saveCharacterPosition(this.id, this.x, this.y);
  };

  Player.prototype.toPresenceState = function () {
    return {
      id:        this.id,
      name:      this.name,
      race:      this.race,
      x:         this.x,
      y:         this.y,
      hp:        this.hp,
      maxHp:     this.maxHp,
      facing:    this.facing,
      animation: this.animation,
      isDown:    this.isDown,
      plane:     this.plane,
      zone:      this.zone,
      alignment: this.alignment,
      class:     this.currentClass,
    };
  };

  // ── Update ───────────────────────────────────────────────────────

  Player.prototype.update = function (dt) {
    if (this.isDead) return;

    // Stamina regen
    if (!this.isSprinting && !this.isDown) {
      var isMoving = this.velocityX !== 0 || this.velocityY !== 0;
      var regenRate = isMoving ? STAMINA_REGEN_WALK : STAMINA_REGEN_IDLE;
      this.stamina = Math.min(this.maxStamina, this.stamina + regenRate * dt);
    }

    // Status effects
    this.updateStatuses(dt);

    // Combo timer
    if (this.comboCount > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this.comboTimer = 0;
      }
    }

    // Down / bleedout timer
    if (this.isDown) {
      this.downTimer -= dt;
      if (this.downTimer <= 0) {
        this.executeGrip(null);
      }
    }

    // Stagger recovery
    if (this.isStaggered) {
      this.staggerTimer -= dt;
      if (this.staggerTimer <= 0) {
        this.isStaggered = false;
        this.staggerTimer = 0;
      }
    }

    // Combat tag countdown
    if (this.combatTagged) {
      this.combatTimer -= dt;
      if (this.combatTimer <= 0) {
        this.combatTagged = false;
        this.combatTimer = 0;
      }
    }

    // Damage flash
    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
    }

    // Animation frame
    this.animTimer += dt;
    if (this.animTimer >= ANIM_FRAME_DURATION) {
      this.animTimer -= ANIM_FRAME_DURATION;
      this.animFrame++;
    }

    // Set animation state
    if (this.isDown) {
      this.animation = 'down';
    } else if (this.isStaggered) {
      this.animation = 'stagger';
    } else if (this.velocityX !== 0 || this.velocityY !== 0) {
      this.animation = this.isSprinting ? 'run' : 'walk';
    } else if (this.isChargingMana) {
      this.animation = 'charge';
    } else {
      this.animation = 'idle';
    }

    // Reset per-frame flags
    this.isChargingMana = false;
    this.velocityX = 0;
    this.velocityY = 0;

    // Zone tracking
    if (typeof World !== 'undefined' && World.getZoneAt) {
      var z = World.getZoneAt(this.x, this.y);
      if (z) this.zone = z.name;
    }

    // Sync for local player
    if (this.isLocalPlayer) {
      this.syncToSupabase();
    }
  };

  // ── Render ───────────────────────────────────────────────────────

  Player.prototype.render = function (ctx, camera) {
    var sx = Math.round(this.x - camera.x);
    var sy = Math.round(this.y - camera.y);

    // Sprite sheet or colored rectangle fallback
    if (this.spriteSheet) {
      this._drawSprite(ctx, sx, sy);
    } else {
      this._drawFallback(ctx, sx, sy);
    }

    // Damage flash overlay
    if (this._flashTimer > 0) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx, sy, PLAYER_W, PLAYER_H);
      ctx.globalAlpha = 1;
    }

    // On-fire flicker
    if (this._hasStatus('onFire')) {
      ctx.globalAlpha = 0.3 + Math.random() * 0.2;
      ctx.fillStyle = '#ff6600';
      ctx.fillRect(sx - 1, sy - 2, PLAYER_W + 2, PLAYER_H + 2);
      ctx.globalAlpha = 1;
    }

    // Username label
    var font = "'Press Start 2P', monospace";
    ctx.font = '4px ' + font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.name || '???', sx + PLAYER_W / 2, sy - 4);

    // HP bar
    var barW = PLAYER_W + 4;
    var barH = 2;
    var barX = sx - 2;
    var barY = sy + PLAYER_H + 2;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(barX, barY, barW, barH);
    var hpRatio = Math.max(0, this.hp / this.maxHp);
    ctx.fillStyle = hpRatio > 0.5 ? '#44cc44' : hpRatio > 0.25 ? '#cccc22' : '#cc2222';
    ctx.fillRect(barX, barY, barW * hpRatio, barH);

    // Status effect indicators
    this._drawStatusIndicators(ctx, sx, sy);
  };

  Player.prototype._drawFallback = function (ctx, sx, sy) {
    var bodyColor, outlineColor;

    if (this.isDown) {
      bodyColor = '#555555';
      outlineColor = '#333333';
    } else {
      var alignLabel = this.getAlignmentLabel();
      switch (alignLabel) {
        case 'Corrupt':  bodyColor = '#6a1a3a'; break;
        case 'Chaotic':  bodyColor = '#8a3a2a'; break;
        case 'Orderly':  bodyColor = '#3a5a8a'; break;
        case 'Ordained': bodyColor = '#8a7a2a'; break;
        default:         bodyColor = '#4a6a4a'; break;
      }
      outlineColor = '#1a1a1a';
    }

    // Outline
    ctx.fillStyle = outlineColor;
    ctx.fillRect(sx - 1, sy - 1, PLAYER_W + 2, PLAYER_H + 2);

    // Body
    ctx.fillStyle = bodyColor;
    ctx.fillRect(sx, sy, PLAYER_W, PLAYER_H);

    // Head highlight
    ctx.fillStyle = '#ddc8a0';
    ctx.fillRect(sx + 3, sy + 1, 6, 5);

    // Eyes based on facing
    ctx.fillStyle = '#1a1a1a';
    if (this.facing === 'south') {
      ctx.fillRect(sx + 4, sy + 3, 1, 1);
      ctx.fillRect(sx + 7, sy + 3, 1, 1);
    } else if (this.facing === 'north') {
      // no eyes visible from behind
    } else if (this.facing === 'east') {
      ctx.fillRect(sx + 7, sy + 3, 1, 1);
    } else {
      ctx.fillRect(sx + 4, sy + 3, 1, 1);
    }
  };

  Player.prototype._drawSprite = function (ctx, sx, sy) {
    var dirIndex = { south: 0, west: 1, east: 2, north: 3 };
    var row = dirIndex[this.facing] || 0;
    var col = this.animFrame % 4;

    ctx.drawImage(
      this.spriteSheet,
      col * PLAYER_W, row * PLAYER_H, PLAYER_W, PLAYER_H,
      sx, sy, PLAYER_W, PLAYER_H
    );
  };

  Player.prototype._drawStatusIndicators = function (ctx, sx, sy) {
    if (this.statusEffects.length === 0) return;

    var seen = {};
    var icons = [];
    for (var i = 0; i < this.statusEffects.length; i++) {
      var t = this.statusEffects[i].type;
      if (seen[t]) continue;
      seen[t] = true;
      icons.push(t);
    }

    var abbrevColors = {
      onFire:      { letter: 'F', color: '#ff4400' },
      blackFlames: { letter: 'B', color: '#220044' },
      cursed:      { letter: 'C', color: '#8800aa' },
      chilled:     { letter: 'C', color: '#6688ff' },
      frostbite:   { letter: 'X', color: '#aaccff' },
      manaLocked:  { letter: 'M', color: '#444488' },
      blinded:     { letter: 'B', color: '#888888' },
      poisoned:    { letter: 'P', color: '#44aa22' },
      anemia:      { letter: 'A', color: '#aa8888' },
    };

    var startX = sx - icons.length * 3;
    for (var j = 0; j < icons.length; j++) {
      var info = abbrevColors[icons[j]];
      if (!info) continue;

      ctx.fillStyle = info.color;
      ctx.beginPath();
      ctx.arc(startX + j * 6 + 2, sy - 8, 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = '2px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.letter, startX + j * 6 + 2, sy - 8);
    }
  };

  // ── Export ────────────────────────────────────────────────────────

  window.Player = Player;
})();
