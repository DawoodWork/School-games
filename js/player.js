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
  var PLAYER_W = 32;
  var PLAYER_H = 32;

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
    this.isUber        = this.classTier === 'master' || this.classTier >= 3;
    this.plane         = d.current_plane || 'gaia';
    this.zone          = d.current_zone || 'Spawn';
    this.insanityStage = d.insanity_stage || 0;
    this.injuries      = d.injuries ? d.injuries.slice() : [];
    this.statusEffects = d.status_effects && typeof d.status_effects === 'object' && !Array.isArray(d.status_effects) ? Object.assign({}, d.status_effects) : {};
    this.knownSpells   = d.known_spells ? d.known_spells.slice() : [];
    this.selectedSpell = 0;
    this.isLocalPlayer = false;

    // Equipment
    var equip = d.equipment || {};
    this.equipment = {
      weapon: equip.weapon || null,
      armor:  equip.armor  || null,
      shield: equip.shield || null,
    };
    this.xp    = d.xp || 0;
    this.level = d.level || 1;

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
      if (World.checkAlignmentBarrier) {
        var bx = World.checkAlignmentBarrier(this, nx, this.y);
        if (bx.blocked) {
          this.x = bx.knockbackX;
          this.y = bx.knockbackY;
          this._barrierEffect = { effect: bx.effect, timer: 0.3, text: bx.text, color: bx.color };
          if (window.UI && window.UI.showNotification) {
            window.UI.showNotification(bx.text, bx.color, 2);
          }
          return;
        }
      }
      this.x = nx;
    }
    if (World.isWalkable(this.x, ny)) {
      if (World.checkAlignmentBarrier) {
        var by = World.checkAlignmentBarrier(this, this.x, ny);
        if (by.blocked) {
          this.x = by.knockbackX;
          this.y = by.knockbackY;
          this._barrierEffect = { effect: by.effect, timer: 0.3, text: by.text, color: by.color };
          if (window.UI && window.UI.showNotification) {
            window.UI.showNotification(by.text, by.color, 2);
          }
          return;
        }
      }
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

  Player.prototype.castSpell = function (spellId, targetPos) {
    if (this.isDown) return false;
    if (typeof Combat !== 'undefined' && Combat.castSpell) {
      return Combat.castSpell(this, spellId, targetPos);
    }
    return false;
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
    if (!this.statusEffects || Array.isArray(this.statusEffects)) {
      this.statusEffects = {};
    }
    this.statusEffects[type] = { timer: duration };
  };

  Player.prototype.updateStatuses = function (dt) {
    // Status effects are now managed by Combat.updateCombat and synced as an object
    // This method is kept for backwards compatibility but should not be called directly
  };

  Player.prototype._hasStatus = function (type) {
    if (this.statusEffects && typeof this.statusEffects === 'object' && !Array.isArray(this.statusEffects)) {
      return !!this.statusEffects[type];
    }
    return false;
  };

  Player.prototype._statusStackCount = function (type) {
    if (this.statusEffects && typeof this.statusEffects === 'object' && !Array.isArray(this.statusEffects)) {
      var s = this.statusEffects[type];
      return s ? (s.stacks || 1) : 0;
    }
    return 0;
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
    } else {
      this.hp = Math.round(this.maxHp * 0.25);
    }
  };

  Player.prototype.wipe = function () {
    var lineageData = {
      user_id:    this.userId,
      character_id: this.id,
      wipe_date:  new Date().toISOString(),
      inherited_heirlooms: [],
    };

    var self = this;

    if (typeof SupabaseHelper !== 'undefined' && SupabaseHelper.insertLineage) {
      SupabaseHelper.insertLineage(lineageData);
    }

    if (typeof UI !== 'undefined' && UI.showDeathScreen) {
      UI.showDeathScreen(this, {
        name: this.name,
        race: this.race,
        class: this.currentClass,
        alignment: this.alignment,
        insight: this.insight,
        silver: this.silver,
        valu: this.valu,
        inherited_heirlooms: [],
      }, function () {
        window.location.reload();
      });
    }
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
        equipment:       self.equipment,
        xp:              self.xp,
        level:           self.level,
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
      equipment: this.equipment,
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

    // Equipment overlay rendering
    this._drawEquipment(ctx, sx, sy);

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
    var label = this.name || '???';
    var labelX = sx + PLAYER_W / 2;
    var labelY = sy - 4;
    ctx.font = '5px ' + font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(label, labelX, labelY);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, labelX, labelY);

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
    ctx.fillRect(sx + 10, sy + 4, 12, 10);

    // Eyes based on facing
    ctx.fillStyle = '#1a1a1a';
    if (this.facing === 'south') {
      ctx.fillRect(sx + 12, sy + 8, 2, 2);
      ctx.fillRect(sx + 18, sy + 8, 2, 2);
    } else if (this.facing === 'north') {
      // no eyes visible from behind
    } else if (this.facing === 'east') {
      ctx.fillRect(sx + 18, sy + 8, 2, 2);
    } else {
      ctx.fillRect(sx + 12, sy + 8, 2, 2);
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
    var icons = Object.keys(this.statusEffects);
    if (icons.length === 0) return;

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

    var startX = sx + PLAYER_W / 2 - icons.length * 3;
    for (var j = 0; j < icons.length; j++) {
      var info = abbrevColors[icons[j]];
      if (!info) continue;

      ctx.fillStyle = info.color;
      ctx.beginPath();
      ctx.arc(startX + j * 6 + 2, sy - 8, 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = '3px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.letter, startX + j * 6 + 2, sy - 8);
    }
  };

  // ── Equipment Rendering ──────────────────────────────────────────────

  Player.prototype._drawEquipment = function (ctx, sx, sy) {
    if (!this.equipment) return;

    var equipmentSprite = window.GameEngine && window.GameEngine.spriteLoader && window.GameEngine.spriteLoader.getSprite('equipment_icons');
    if (!equipmentSprite) return;

    var equipMap = {
      iron_sword:     { col: 0, row: 0 },
      steel_sword:    { col: 1, row: 0 },
      dark_blade:     { col: 2, row: 0 },
      iron_shield:    { col: 0, row: 1 },
      steel_shield:   { col: 1, row: 1 },
      leather_armor:  { col: 0, row: 2 },
      chain_armor:    { col: 1, row: 2 },
      plate_armor:    { col: 2, row: 2 },
    };

    // Draw weapon on right side
    if (this.equipment.weapon && equipMap[this.equipment.weapon]) {
      var weaponPos = equipMap[this.equipment.weapon];
      var weaponX = sx + PLAYER_W - 8;  // Right side of player
      var weaponY = sy + 8;             // Middle height
      
      // Adjust weapon position based on facing direction
      if (this.facing === 'west') {
        weaponX = sx - 4; // Left side when facing west
      }
      
      ctx.drawImage(
        equipmentSprite,
        weaponPos.col * 16, weaponPos.row * 16, 16, 16,
        weaponX, weaponY, 12, 12
      );
    }

    // Draw shield on left side
    if (this.equipment.shield && equipMap[this.equipment.shield]) {
      var shieldPos = equipMap[this.equipment.shield];
      var shieldX = sx - 4;             // Left side of player
      var shieldY = sy + 6;             // Slightly higher
      
      // Adjust shield position based on facing direction
      if (this.facing === 'west') {
        shieldX = sx + PLAYER_W - 8; // Right side when facing west
      }
      
      ctx.drawImage(
        equipmentSprite,
        shieldPos.col * 16, shieldPos.row * 16, 16, 16,
        shieldX, shieldY, 10, 10
      );
    }

    // Draw armor overlay (subtle tint on player sprite)
    if (this.equipment.armor && this.spriteSheet) {
      var armorTint = {
        leather_armor:  'rgba(139, 69, 19, 0.2)',   // Brown tint
        chain_armor:    'rgba(128, 128, 128, 0.25)', // Gray tint
        plate_armor:    'rgba(192, 192, 192, 0.3)',  // Silver tint
      };

      var tint = armorTint[this.equipment.armor];
      if (tint) {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = tint;
        ctx.fillRect(sx, sy, PLAYER_W, PLAYER_H);
        ctx.globalAlpha = 1;
      }
    }
  };

  // ── Export ────────────────────────────────────────────────────────

  window.Player = Player;
})();
