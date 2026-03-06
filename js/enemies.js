window.Enemies = (function () {
  'use strict';

  var TILE_SIZE = 16;

  var ENEMY_TYPES = {
    hollow: {
      name: 'Hollow',
      hp: 40, maxHp: 40, damage: 8, speed: 40,
      aggroRange: 120, attackRange: 28, attackCooldown: 1.2,
      xpReward: 25, silverReward: [3, 8],
      color: '#554433', letter: 'H',
      width: 28, height: 28,
      drops: [
        { item: 'health_potion', chance: 0.2, qty: 1 },
        { item: 'leather_armor', chance: 0.05, qty: 1 },
      ],
    },
    shade: {
      name: 'Shade',
      hp: 25, maxHp: 25, damage: 12, speed: 50,
      aggroRange: 160, attackRange: 140, attackCooldown: 2.0,
      xpReward: 35, silverReward: [5, 12],
      color: '#6644aa', letter: 'S',
      width: 24, height: 24,
      ranged: true, projectileSpeed: 160, projectileColor: '#8866cc',
      drops: [
        { item: 'mana_potion', chance: 0.25, qty: 1 },
        { item: 'iron_sword',  chance: 0.04, qty: 1 },
      ],
    },
    brute: {
      name: 'Brute',
      hp: 80, maxHp: 80, damage: 18, speed: 28,
      aggroRange: 100, attackRange: 32, attackCooldown: 2.5,
      xpReward: 60, silverReward: [10, 25],
      color: '#886644', letter: 'B',
      width: 36, height: 36,
      drops: [
        { item: 'health_potion', chance: 0.35, qty: 1 },
        { item: 'chain_armor',   chance: 0.06, qty: 1 },
        { item: 'steel_shield',  chance: 0.04, qty: 1 },
      ],
    },
  };

  var ZONE_SPAWNS = {
    Forest:      { types: ['hollow', 'hollow', 'shade'], max: 8, respawnTime: 30 },
    Swamp:       { types: ['hollow', 'shade'],           max: 6, respawnTime: 25 },
    Dungeon:     { types: ['shade', 'shade', 'brute'],   max: 10, respawnTime: 20 },
    Tundra:      { types: ['brute', 'hollow'],           max: 5, respawnTime: 35 },
    Borderlands: { types: ['hollow'],                    max: 4, respawnTime: 40 },
  };

  var enemies = [];
  var respawnTimers = {};
  var localPlayer = null;

  function init(player) {
    localPlayer = player;
    enemies = [];
    respawnTimers = {};

    var zoneKeys = Object.keys(ZONE_SPAWNS);
    for (var z = 0; z < zoneKeys.length; z++) {
      var zoneName = zoneKeys[z];
      var cfg = ZONE_SPAWNS[zoneName];
      respawnTimers[zoneName] = 0;

      for (var i = 0; i < cfg.max; i++) {
        _spawnInZone(zoneName);
      }
    }
  }

  function _getZoneBounds(zoneName) {
    if (!window.World || !window.World.getZoneAt) return null;
    var zones = {
      Forest:      { x: 30, y: 130, w: 140, h: 65 },
      Swamp:       { x: 140, y: 130, w: 55, h: 65 },
      Dungeon:     { x: 140, y: 5, w: 55, h: 60 },
      Tundra:      { x: 5, y: 5, w: 70, h: 70 },
      Borderlands: { x: 0, y: 0, w: 200, h: 200 },
    };
    return zones[zoneName] || null;
  }

  function _spawnInZone(zoneName) {
    var cfg = ZONE_SPAWNS[zoneName];
    if (!cfg) return;

    var currentCount = 0;
    for (var i = 0; i < enemies.length; i++) {
      if (enemies[i].zone === zoneName && !enemies[i].dead) currentCount++;
    }
    if (currentCount >= cfg.max) return;

    var bounds = _getZoneBounds(zoneName);
    if (!bounds) return;

    var typeKey = cfg.types[Math.floor(Math.random() * cfg.types.length)];
    var def = ENEMY_TYPES[typeKey];
    if (!def) return;

    var margin = 3;
    var tx = bounds.x + margin + Math.floor(Math.random() * (bounds.w - margin * 2));
    var ty = bounds.y + margin + Math.floor(Math.random() * (bounds.h - margin * 2));
    var px = tx * TILE_SIZE + TILE_SIZE / 2;
    var py = ty * TILE_SIZE + TILE_SIZE / 2;

    if (window.World && !window.World.isWalkable(px, py)) return;

    var enemy = {
      type: typeKey,
      name: def.name,
      zone: zoneName,
      x: px, y: py,
      spawnX: px, spawnY: py,
      width: def.width, height: def.height,
      hp: def.hp, maxHp: def.maxHp,
      damage: def.damage, speed: def.speed,
      aggroRange: def.aggroRange,
      attackRange: def.attackRange,
      attackCooldown: def.attackCooldown,
      attackTimer: 0,
      xpReward: def.xpReward,
      silverReward: def.silverReward,
      drops: def.drops,
      color: def.color, letter: def.letter,
      ranged: def.ranged || false,
      projectileSpeed: def.projectileSpeed || 0,
      projectileColor: def.projectileColor || '#ffffff',

      dead: false,
      isDown: false,
      facing: 'south',
      state: 'idle',
      stateTimer: 0,
      patrolTarget: null,
      hitFlash: 0,
      isEnemy: true,

      spriteSheet: null,
    };

    enemy.goDown = function () {
      if (this.dead) return;
      this.dead = true;
      this.isDown = true;
      _onEnemyDeath(this, localPlayer);
    };

    var spriteKey = 'enemy_' + typeKey;
    if (window.GameEngine && window.GameEngine.spriteLoader) {
      enemy.spriteSheet = window.GameEngine.spriteLoader.getSprite(spriteKey);
    }

    enemies.push(enemy);
    if (window.GameEngine) window.GameEngine.addEntity(enemy);
  }

  function update(dt) {
    if (!localPlayer) return;

    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      if (e.dead) continue;
      _updateEnemy(e, dt);
    }

    _handleRespawns(dt);
  }

  function _updateEnemy(e, dt) {
    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.attackTimer > 0) e.attackTimer -= dt;

    var dx = localPlayer.x - e.x;
    var dy = localPlayer.y - e.y;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < e.aggroRange && !localPlayer.isDown && !localPlayer.isDead) {
      e.state = 'chase';

      if (dx !== 0 || dy !== 0) {
        if (Math.abs(dx) > Math.abs(dy)) {
          e.facing = dx > 0 ? 'east' : 'west';
        } else {
          e.facing = dy > 0 ? 'south' : 'north';
        }
      }

      if (dist <= e.attackRange) {
        e.state = 'attack';
        if (e.attackTimer <= 0) {
          _enemyAttack(e);
          e.attackTimer = e.attackCooldown;
        }
      } else {
        var len = dist || 1;
        var mx = (dx / len) * e.speed * dt;
        var my = (dy / len) * e.speed * dt;
        var nx = e.x + mx;
        var ny = e.y + my;

        if (!window.World || window.World.isWalkable(nx, ny)) {
          e.x = nx;
          e.y = ny;
        }
      }
    } else {
      if (e.state !== 'idle') {
        e.state = 'idle';
        e.stateTimer = 2 + Math.random() * 3;
      }

      e.stateTimer -= dt;
      if (e.stateTimer <= 0) {
        e.state = 'patrol';
        e.stateTimer = 2 + Math.random() * 2;
        e.patrolTarget = {
          x: e.spawnX + (Math.random() - 0.5) * 80,
          y: e.spawnY + (Math.random() - 0.5) * 80,
        };
      }

      if (e.state === 'patrol' && e.patrolTarget) {
        var pdx = e.patrolTarget.x - e.x;
        var pdy = e.patrolTarget.y - e.y;
        var pdist = Math.sqrt(pdx * pdx + pdy * pdy);

        if (pdist > 4) {
          var pmx = (pdx / pdist) * e.speed * 0.5 * dt;
          var pmy = (pdy / pdist) * e.speed * 0.5 * dt;
          var pnx = e.x + pmx;
          var pny = e.y + pmy;

          if (!window.World || window.World.isWalkable(pnx, pny)) {
            e.x = pnx;
            e.y = pny;

            if (Math.abs(pdx) > Math.abs(pdy)) {
              e.facing = pdx > 0 ? 'east' : 'west';
            } else {
              e.facing = pdy > 0 ? 'south' : 'north';
            }
          }
        } else {
          e.state = 'idle';
          e.stateTimer = 2 + Math.random() * 3;
        }
      }
    }
  }

  function _enemyAttack(e) {
    if (e.ranged) {
      _fireProjectile(e);
    } else {
      var dx = localPlayer.x - e.x;
      var dy = localPlayer.y - e.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= e.attackRange + 8) {
        window.Combat.takeDamage(localPlayer, e.damage, e, 'melee');
      }
    }
  }

  function _fireProjectile(e) {
    var dx = localPlayer.x - e.x;
    var dy = localPlayer.y - e.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var dirX = dx / len;
    var dirY = dy / len;

    var proj = {
      x: e.x + e.width / 2,
      y: e.y + e.height / 2,
      width: 6, height: 6,
      vx: dirX * e.projectileSpeed,
      vy: dirY * e.projectileSpeed,
      damage: e.damage,
      source: e,
      lifetime: 3,
      color: e.projectileColor,

      update: function (dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.lifetime -= dt;

        if (this.lifetime <= 0) {
          window.GameEngine.removeEntity(this);
          return;
        }

        var pdx = localPlayer.x + 16 - this.x;
        var pdy = localPlayer.y + 16 - this.y;
        if (Math.sqrt(pdx * pdx + pdy * pdy) < 16) {
          window.Combat.takeDamage(localPlayer, this.damage, this.source, 'magic');
          window.GameEngine.removeEntity(this);
        }
      },

      render: function (ctx, cam) {
        var sx = this.x - cam.x;
        var sy = this.y - cam.y;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(sx, sy, 3, 0, Math.PI * 2);
        ctx.fill();
      },
    };

    window.GameEngine.addEntity(proj);
  }

  function damageEnemy(enemy, amount, source) {
    if (enemy.dead) return;

    enemy.hp -= amount;
    enemy.hitFlash = 0.15;

    if (enemy.hp <= 0) {
      enemy.hp = 0;
      enemy.dead = true;
      _onEnemyDeath(enemy, source);
    }
  }

  function _onEnemyDeath(enemy, killer) {
    if (window.GameEngine) window.GameEngine.removeEntity(enemy);

    var silver = enemy.silverReward[0] +
      Math.floor(Math.random() * (enemy.silverReward[1] - enemy.silverReward[0] + 1));

    if (killer && typeof killer.silver === 'number') {
      killer.silver += silver;
    }

    if (killer && typeof killer.xp === 'number') {
      killer.xp += enemy.xpReward;
      if (window.UI) window.UI.showNotification('+' + enemy.xpReward + ' XP', '#ffcc00');
      _checkLevelUp(killer);
    }

    if (window.UI) window.UI.showNotification('+' + silver + ' Silver', '#cccccc');

    if (enemy.drops) {
      for (var d = 0; d < enemy.drops.length; d++) {
        var drop = enemy.drops[d];
        if (Math.random() < drop.chance) {
          _createLootDrop(enemy.x, enemy.y, drop.item, drop.qty);
        }
      }
    }

    var respawnZone = enemy.zone;
    if (respawnTimers[respawnZone] !== undefined) {
      var cfg = ZONE_SPAWNS[respawnZone];
      if (cfg) respawnTimers[respawnZone] = cfg.respawnTime;
    }
  }

  function _checkLevelUp(p) {
    var thresholds = [0, 100, 250, 500, 1000, 2000, 3500, 5500, 8000, 12000, 17000, 25000];
    var newLevel = 1;
    for (var i = thresholds.length - 1; i >= 0; i--) {
      if (p.xp >= thresholds[i]) {
        newLevel = i + 1;
        break;
      }
    }

    if (newLevel > p.level) {
      var levelsGained = newLevel - p.level;
      p.level = newLevel;
      p.maxHp += 5 * levelsGained;
      p.hp = p.maxHp;
      p.maxMana += 3 * levelsGained;
      p.mana = p.maxMana;
      p.maxStamina += 2 * levelsGained;
      p.stamina = p.maxStamina;

      if (p.level >= 15) {
        p.isUber = true;
        p.classTier = 'master';
      } else if (p.level >= 5) {
        p.classTier = 'advanced';
      }

      var SPELL_UNLOCKS = {
        2: 'ignis',
        4: 'gelidus',
        6: 'viribus',
        8: 'tenebris',
        10: 'contrarium',
        12: 'trickstus',
        14: 'armis',
        15: 'fimbulvetr',
        18: 'manus_dei',
      };

      if (!p.knownSpells) p.knownSpells = [];
      for (var lvl = p.level - levelsGained + 1; lvl <= p.level; lvl++) {
        var spellId = SPELL_UNLOCKS[lvl];
        if (spellId && p.knownSpells.indexOf(spellId) === -1) {
          p.knownSpells.push(spellId);
          if (window.UI) {
            var spellLabel = spellId.charAt(0).toUpperCase() + spellId.slice(1);
            window.UI.showNotification('Learned: ' + spellLabel, '#88ddff', 4);
          }
        }
      }

      if (window.UI) {
        window.UI.showNotification('LEVEL UP! Lv.' + p.level, '#ffdd00', 4);
      }

      if (window.SupabaseHelper && p.id) {
        window.SupabaseHelper.updateCharacterStats(p.id, {
          level: p.level,
          xp: p.xp,
          max_hp: p.maxHp,
          max_mana: p.maxMana,
          max_stamina: p.maxStamina,
          class_tier: p.classTier,
          known_spells: p.knownSpells,
        });
      }
    }
  }

  function _createLootDrop(x, y, itemName, qty) {
    var loot = {
      x: x + (Math.random() - 0.5) * 20,
      y: y + (Math.random() - 0.5) * 20,
      width: 12, height: 12,
      itemName: itemName,
      quantity: qty || 1,
      lifetime: 60,
      bobPhase: Math.random() * Math.PI * 2,
      isLoot: true,

      update: function (dt) {
        this.lifetime -= dt;
        this.bobPhase += dt * 3;

        if (this.lifetime <= 0) {
          window.GameEngine.removeEntity(this);
          return;
        }

        if (!localPlayer) return;
        var dx = localPlayer.x + 16 - this.x;
        var dy = localPlayer.y + 16 - this.y;
        if (Math.sqrt(dx * dx + dy * dy) < 24) {
          _pickupLoot(this);
          window.GameEngine.removeEntity(this);
        }
      },

      render: function (ctx, cam) {
        var sx = this.x - cam.x;
        var sy = this.y - cam.y + Math.sin(this.bobPhase) * 2;

        ctx.fillStyle = '#ffdd44';
        ctx.beginPath();
        ctx.arc(sx + 6, sy + 6, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = '4px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        var disp = (window.UI && window.Combat && window.Combat.EQUIPMENT_STATS)
          ? itemName.replace(/_/g, ' ')
          : itemName;
        ctx.fillText(disp, sx + 6, sy - 2);
      },
    };

    window.GameEngine.addEntity(loot);
  }

  function _pickupLoot(loot) {
    if (!localPlayer || !window.SupabaseHelper) return;

    window.SupabaseHelper.addInventoryItem({
      character_id: localPlayer.id,
      item_name: loot.itemName,
      quantity: loot.quantity,
      item_type: _getItemType(loot.itemName),
    });

    if (window.UI) {
      var label = loot.itemName.replace(/_/g, ' ');
      window.UI.showNotification('Picked up ' + label + (loot.quantity > 1 ? ' x' + loot.quantity : ''), '#44cc44');
    }

    window.SupabaseHelper.loadInventory(localPlayer.id).then(function (res) {
      if (res.data && window.UI) window.UI.loadInventoryItems(res.data);
    });
  }

  function _getItemType(name) {
    if (name.indexOf('potion') !== -1) return 'consumable';
    if (name.indexOf('sword') !== -1 || name.indexOf('blade') !== -1) return 'weapon';
    if (name.indexOf('armor') !== -1) return 'armor';
    if (name.indexOf('shield') !== -1) return 'shield';
    return 'misc';
  }

  function _handleRespawns(dt) {
    var keys = Object.keys(respawnTimers);
    for (var k = 0; k < keys.length; k++) {
      var zone = keys[k];
      if (respawnTimers[zone] > 0) {
        respawnTimers[zone] -= dt;
        if (respawnTimers[zone] <= 0) {
          respawnTimers[zone] = 0;
          _spawnInZone(zone);
        }
      }
    }
  }

  function getEnemies() {
    return enemies;
  }

  function renderEnemy(e, ctx, cam) {
    if (e.dead) return;

    var sx = e.x - cam.x;
    var sy = e.y - cam.y;

    if (e.hitFlash > 0) {
      ctx.globalAlpha = 0.6;
    }

    if (e.spriteSheet) {
      var dirRow = 0;
      switch (e.facing) {
        case 'south': dirRow = 0; break;
        case 'west':  dirRow = 1; break;
        case 'east':  dirRow = 2; break;
        case 'north': dirRow = 3; break;
      }
      ctx.drawImage(e.spriteSheet, 0, dirRow * 32, 32, 32, sx, sy, e.width, e.height);
    } else {
      ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : e.color;
      ctx.fillRect(sx, sy, e.width, e.height);

      ctx.fillStyle = '#ffffff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.letter, sx + e.width / 2, sy + e.height / 2);
    }

    ctx.globalAlpha = 1;

    // HP bar
    if (e.hp < e.maxHp) {
      var barW = e.width;
      var barH = 3;
      var barX = sx;
      var barY = sy - 5;
      ctx.fillStyle = '#333333';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = '#cc2222';
      ctx.fillRect(barX, barY, barW * (e.hp / e.maxHp), barH);
    }

    // Name
    ctx.fillStyle = '#ff8888';
    ctx.font = '4px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(e.name, sx + e.width / 2, sy - 7);
  }

  // Attach render to each enemy so the engine can call it
  function _attachRender(enemy) {
    enemy.render = function (ctx, cam) {
      renderEnemy(this, ctx, cam);
    };
    enemy.update = function (dt) {};
  }

  // Override the push to auto-attach render
  var _origPush = enemies.push;

  function initWithRender(player) {
    init(player);
    for (var i = 0; i < enemies.length; i++) {
      _attachRender(enemies[i]);
    }
  }

  // Patch _spawnInZone to attach render
  var _origSpawnInZone = _spawnInZone;

  return {
    init: function (player) {
      localPlayer = player;
      enemies = [];
      respawnTimers = {};

      var zoneKeys = Object.keys(ZONE_SPAWNS);
      for (var z = 0; z < zoneKeys.length; z++) {
        var zoneName = zoneKeys[z];
        var cfg = ZONE_SPAWNS[zoneName];
        respawnTimers[zoneName] = 0;

        for (var i = 0; i < cfg.max; i++) {
          var before = enemies.length;
          _spawnInZone(zoneName);
          if (enemies.length > before) {
            _attachRender(enemies[enemies.length - 1]);
          }
        }
      }
    },
    update: update,
    getEnemies: getEnemies,
    damageEnemy: damageEnemy,
    ENEMY_TYPES: ENEMY_TYPES,
  };
})();
