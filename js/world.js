// world.js — 2D tile-based world renderer for Ashen Lineage
window.World = (function () {
  "use strict";

  const TILE_SIZE = 16;
  const MAP_WIDTH = 200;
  const MAP_HEIGHT = 200;
  const RENDER_BUFFER = 2;

  const TILE = {
    GRASS: 0,
    STONE: 1,
    WATER: 2,
    MUD: 3,
    SNOW: 4,
    DUNGEON_FLOOR: 5,
    DUNGEON_WALL: 6,
    VOID: 7,
    SANCTUARY: 8,
    ORDERLY_BARRIER: 9,
    CHAOTIC_BARRIER: 10,
    TREE: 11,
    BROKEN_PILLAR: 12,
  };

  const TILE_COLORS = {
    [TILE.GRASS]: "#3a5a1c",
    [TILE.STONE]: "#6b6b6b",
    [TILE.WATER]: "#1a3a5c",
    [TILE.MUD]: "#5a4a2a",
    [TILE.SNOW]: "#d0d8e0",
    [TILE.DUNGEON_FLOOR]: "#3a3a4a",
    [TILE.DUNGEON_WALL]: "#2a2a3a",
    [TILE.VOID]: "#0a0a0a",
    [TILE.SANCTUARY]: "#c8b040",
    [TILE.ORDERLY_BARRIER]: "#e0d060",
    [TILE.CHAOTIC_BARRIER]: "#5a1a3a",
    [TILE.TREE]: "#2a4a1a",
    [TILE.BROKEN_PILLAR]: "#7a7a7a",
  };

  const NON_WALKABLE = new Set([
    TILE.WATER,
    TILE.VOID,
    TILE.DUNGEON_WALL,
    TILE.TREE,
    TILE.BROKEN_PILLAR,
  ]);

  let tileMap = null;
  let tilesetImage = null;
  let currentPlane = "gaia";
  let snowParticles = [];

  // ── Zone Definitions ──────────────────────────────────────────────

  const zones = [
    { name: "Sanctuary", bounds: { x: 92, y: 92, w: 16, h: 16 }, effects: ["sanctuary"] },
    { name: "Spawn",     bounds: { x: 85, y: 85, w: 30, h: 30 }, effects: [] },
    { name: "Tundra",    bounds: { x: 5, y: 5, w: 70, h: 70 },   effects: ["snow"] },
    { name: "Dungeon",   bounds: { x: 140, y: 5, w: 55, h: 60 }, effects: ["dark"] },
    { name: "Forest",    bounds: { x: 30, y: 130, w: 140, h: 65 }, effects: [] },
    { name: "Swamp",     bounds: { x: 140, y: 130, w: 55, h: 65 }, effects: [] },
    { name: "Borderlands", bounds: { x: 0, y: 0, w: MAP_WIDTH, h: MAP_HEIGHT }, effects: [] },
  ];

  // ── NPC Spawn Points ──────────────────────────────────────────────

  const npcs = [
    { type: "Doctor",       x: 96, y: 98 },
    { type: "Blacksmith",   x: 104, y: 98 },
    { type: "ClassTrainer", x: 100, y: 94 },
    { type: "Guard",        x: 93, y: 100 },
    { type: "Guard",        x: 107, y: 100 },
  ];

  // ── NPC Type Definitions ────────────────────────────────────────

  const NPC_DATA = {
    Doctor: {
      color: '#44aa44',
      letter: 'D',
      dialogue: "What ails thee, traveler? I can mend your wounds... for a price.",
      options: [
        { text: "Heal Broken Arm (50 Silver)", cost: 50, action: "heal_broken_arm" },
        { text: "Heal Broken Leg (50 Silver)", cost: 50, action: "heal_broken_leg" },
        { text: "Heal Slash Wound (30 Silver)", cost: 30, action: "heal_slash_wound" },
        { text: "Cure Cataracts (80 Silver)", cost: 80, action: "heal_cataracts" },
      ],
    },
    Blacksmith: {
      color: '#aa6633',
      letter: 'B',
      dialogue: "Fine steel doesn't come cheap. What do you need?",
      options: [
        { text: "Buy Iron Sword (100 Silver)", cost: 100, action: "buy_iron_sword" },
        { text: "Buy Steel Shield (150 Silver)", cost: 150, action: "buy_steel_shield" },
        { text: "Buy Leather Armor (120 Silver)", cost: 120, action: "buy_leather_armor" },
      ],
    },
    ClassTrainer: {
      color: '#6644aa',
      letter: 'T',
      dialogue: "Show me your worth, and I shall unlock your potential.",
      options: [
        { text: "Learn Ignis (50 Silver)", cost: 50, action: "learn_ignis" },
        { text: "Learn Gelidus (50 Silver)", cost: 50, action: "learn_gelidus" },
        { text: "Learn Armis (30 Silver)", cost: 30, action: "learn_armis" },
      ],
    },
    Guard: {
      color: '#888844',
      letter: 'G',
      dialogue: "All is orderly here. Move along, citizen.",
      hostileDialogue: "You dare show your face here, criminal?! To jail with you!",
      hostileThreshold: -160,
      options: [],
    },
  };

  function getNPCData(type) {
    return NPC_DATA[type] || null;
  }

  // ── Procedural Map Generation ─────────────────────────────────────

  function seededRandom(seed) {
    let s = seed;
    return function () {
      s = (s * 16807 + 0) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function generateGaiaMap() {
    const map = new Array(MAP_HEIGHT);
    const rand = seededRandom(42);

    for (let y = 0; y < MAP_HEIGHT; y++) {
      map[y] = new Uint8Array(MAP_WIDTH);
      for (let x = 0; x < MAP_WIDTH; x++) {
        map[y][x] = TILE.GRASS;
      }
    }

    // Water borders (5 tiles wide)
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const distEdge = Math.min(x, y, MAP_WIDTH - 1 - x, MAP_HEIGHT - 1 - y);
        if (distEdge < 5) {
          map[y][x] = TILE.WATER;
        } else if (distEdge < 8 && rand() < 0.4) {
          map[y][x] = TILE.WATER;
        }
      }
    }

    // Tundra — northwest
    for (let y = 5; y < 75; y++) {
      for (let x = 5; x < 75; x++) {
        if (map[y][x] === TILE.WATER) continue;
        const core = x < 60 && y < 60;
        if (core || rand() < 0.5) {
          map[y][x] = TILE.SNOW;
        }
        if (map[y][x] === TILE.SNOW && rand() < 0.06) {
          map[y][x] = TILE.STONE;
        }
      }
    }

    // Dungeon — northeast
    for (let y = 8; y < 62; y++) {
      for (let x = 142; x < 192; x++) {
        if (map[y][x] === TILE.WATER) continue;
        const onWall =
          y === 8 || y === 61 || x === 142 || x === 191 ||
          (x % 10 === 0 && y % 8 < 2) ||
          (y % 10 === 0 && x % 8 < 2);
        map[y][x] = onWall ? TILE.DUNGEON_WALL : TILE.DUNGEON_FLOOR;
      }
    }
    // Broken pillars inside dungeon
    for (let py = 15; py < 58; py += 7) {
      for (let px = 150; px < 188; px += 7) {
        if (rand() < 0.4) map[py][px] = TILE.BROKEN_PILLAR;
      }
    }

    // Swamp — southeast
    for (let y = 132; y < 192; y++) {
      for (let x = 142; x < 192; x++) {
        if (map[y][x] === TILE.WATER) continue;
        map[y][x] = rand() < 0.6 ? TILE.MUD : TILE.GRASS;
        if (rand() < 0.12) map[y][x] = TILE.WATER;
      }
    }

    // Forest — south-center
    for (let y = 132; y < 192; y++) {
      for (let x = 30; x < 140; x++) {
        if (map[y][x] === TILE.WATER) continue;
        if (rand() < 0.18) {
          map[y][x] = TILE.TREE;
        } else if (rand() < 0.05) {
          map[y][x] = TILE.STONE;
        }
      }
    }

    // Scattered trees on grassland
    for (let y = 20; y < 180; y++) {
      for (let x = 20; x < 180; x++) {
        if (map[y][x] === TILE.GRASS && rand() < 0.02) {
          map[y][x] = TILE.TREE;
        }
      }
    }

    // Mixed stone patches
    for (let y = 20; y < 180; y++) {
      for (let x = 20; x < 180; x++) {
        if (map[y][x] === TILE.GRASS && rand() < 0.015) {
          map[y][x] = TILE.STONE;
        }
      }
    }

    // Sanctuary — central golden area
    for (let y = 92; y < 108; y++) {
      for (let x = 92; x < 108; x++) {
        map[y][x] = TILE.SANCTUARY;
      }
    }
    // Orderly barrier ring around sanctuary
    for (let y = 90; y < 110; y++) {
      for (let x = 90; x < 110; x++) {
        const onEdge =
          y === 90 || y === 109 || x === 90 || x === 109;
        if (onEdge) map[y][x] = TILE.ORDERLY_BARRIER;
      }
    }

    // Clear spawn area around sanctuary
    for (let y = 85; y < 115; y++) {
      for (let x = 85; x < 115; x++) {
        if (map[y][x] === TILE.TREE || map[y][x] === TILE.STONE) {
          map[y][x] = TILE.GRASS;
        }
      }
    }

    // Void pocket (small, far corner)
    for (let y = 70; y < 78; y++) {
      for (let x = 120; x < 128; x++) {
        map[y][x] = TILE.VOID;
      }
    }

    // Chaotic barrier strips near borderlands
    for (let i = 0; i < 12; i++) {
      const bx = 10 + Math.floor(rand() * 180);
      const by = 10 + Math.floor(rand() * 180);
      for (let d = 0; d < 4; d++) {
        const tx = bx + d;
        const ty = by;
        if (tx < MAP_WIDTH && ty < MAP_HEIGHT && map[ty][tx] === TILE.GRASS) {
          map[ty][tx] = TILE.CHAOTIC_BARRIER;
        }
      }
    }

    return map;
  }

  // ── Tile Pattern Rendering ────────────────────────────────────────

  function drawTilePattern(ctx, id, px, py) {
    ctx.fillStyle = TILE_COLORS[id] || "#ff00ff";
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

    switch (id) {
      case TILE.GRASS:
        ctx.fillStyle = "#4a6a2c";
        ctx.fillRect(px + 3, py + 4, 1, 2);
        ctx.fillRect(px + 9, py + 2, 1, 3);
        ctx.fillRect(px + 6, py + 10, 1, 2);
        ctx.fillRect(px + 12, py + 8, 1, 2);
        break;

      case TILE.STONE:
        ctx.fillStyle = "#7b7b7b";
        ctx.fillRect(px + 2, py + 2, 5, 4);
        ctx.fillStyle = "#5b5b5b";
        ctx.fillRect(px + 8, py + 7, 6, 5);
        ctx.fillRect(px + 1, py + 10, 4, 3);
        break;

      case TILE.WATER:
        ctx.fillStyle = "#2a4a6c";
        ctx.fillRect(px + 1, py + 5, 6, 1);
        ctx.fillRect(px + 9, py + 10, 5, 1);
        ctx.fillStyle = "#0a2a4c";
        ctx.fillRect(px + 4, py + 12, 4, 1);
        break;

      case TILE.MUD:
        ctx.fillStyle = "#4a3a1a";
        ctx.fillRect(px + 2, py + 6, 3, 2);
        ctx.fillRect(px + 10, py + 3, 2, 2);
        ctx.fillStyle = "#6a5a3a";
        ctx.fillRect(px + 7, py + 11, 4, 2);
        break;

      case TILE.SNOW:
        ctx.fillStyle = "#e8f0f8";
        ctx.fillRect(px + 3, py + 3, 2, 1);
        ctx.fillRect(px + 10, py + 7, 2, 1);
        ctx.fillRect(px + 6, py + 12, 1, 1);
        break;

      case TILE.DUNGEON_FLOOR:
        ctx.fillStyle = "#2a2a3a";
        ctx.fillRect(px, py, 1, TILE_SIZE);
        ctx.fillRect(px, py, TILE_SIZE, 1);
        break;

      case TILE.DUNGEON_WALL:
        ctx.fillStyle = "#1a1a2a";
        ctx.fillRect(px + 2, py + 2, 12, 12);
        ctx.fillStyle = "#3a3a4a";
        ctx.fillRect(px + 4, py + 1, 2, 1);
        ctx.fillRect(px + 10, py + 1, 2, 1);
        break;

      case TILE.SANCTUARY:
        ctx.fillStyle = "#d8c050";
        ctx.fillRect(px + 4, py + 4, 8, 8);
        ctx.fillStyle = "#b8a030";
        ctx.fillRect(px + 7, py + 2, 2, 12);
        ctx.fillRect(px + 2, py + 7, 12, 2);
        break;

      case TILE.ORDERLY_BARRIER:
        ctx.fillStyle = "#f0e070";
        ctx.fillRect(px + 1, py + 1, 14, 14);
        ctx.fillStyle = "#d0c040";
        ctx.fillRect(px + 3, py + 3, 10, 10);
        break;

      case TILE.CHAOTIC_BARRIER:
        ctx.fillStyle = "#7a2a4a";
        ctx.fillRect(px + 2, py + 1, 4, 6);
        ctx.fillRect(px + 9, py + 8, 5, 5);
        ctx.fillStyle = "#4a0a2a";
        ctx.fillRect(px + 5, py + 5, 6, 6);
        break;

      case TILE.TREE:
        ctx.fillStyle = "#1a3a0a";
        ctx.fillRect(px + 4, py + 1, 8, 9);
        ctx.fillRect(px + 2, py + 3, 12, 5);
        ctx.fillStyle = "#5a3a1a";
        ctx.fillRect(px + 7, py + 10, 2, 6);
        break;

      case TILE.BROKEN_PILLAR:
        ctx.fillStyle = "#8a8a8a";
        ctx.fillRect(px + 5, py + 4, 6, 10);
        ctx.fillStyle = "#6a6a6a";
        ctx.fillRect(px + 4, py + 12, 8, 2);
        ctx.fillStyle = "#9a9a9a";
        ctx.fillRect(px + 6, py + 2, 4, 3);
        break;
    }
  }

  // ── Snow Particles ────────────────────────────────────────────────

  function initSnowParticles(count) {
    snowParticles = [];
    for (let i = 0; i < count; i++) {
      snowParticles.push({
        x: Math.random(),
        y: Math.random(),
        speed: 0.2 + Math.random() * 0.4,
        size: 1 + Math.random() * 2,
        drift: (Math.random() - 0.5) * 0.3,
      });
    }
  }

  function updateAndDrawSnow(ctx, camera) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const dt = 1 / 60;

    for (const p of snowParticles) {
      p.y += p.speed * dt;
      p.x += p.drift * dt;
      if (p.y > 1) { p.y = 0; p.x = Math.random(); }
      if (p.x < 0) p.x = 1;
      if (p.x > 1) p.x = 0;

      ctx.fillRect(
        Math.floor(p.x * w),
        Math.floor(p.y * h),
        p.size,
        p.size
      );
    }
  }

  // ── Public API ────────────────────────────────────────────────────

  function init(plane) {
    currentPlane = plane || "gaia";
    tileMap = generateGaiaMap();
    initSnowParticles(120);
  }

  function loadTileset(image) {
    tilesetImage = image;
  }

  function getTileAt(worldX, worldY) {
    const tx = Math.floor(worldX / TILE_SIZE);
    const ty = Math.floor(worldY / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= MAP_WIDTH || ty >= MAP_HEIGHT) return TILE.VOID;
    return tileMap[ty][tx];
  }

  function getZoneAt(worldX, worldY) {
    const tx = typeof worldX === "number" && worldX >= TILE_SIZE
      ? Math.floor(worldX / TILE_SIZE)
      : worldX;
    const ty = typeof worldY === "number" && worldY >= TILE_SIZE
      ? Math.floor(worldY / TILE_SIZE)
      : worldY;

    for (const zone of zones) {
      const b = zone.bounds;
      if (tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h) {
        return zone;
      }
    }
    return zones[zones.length - 1]; // Borderlands fallback
  }

  function isWalkable(worldX, worldY) {
    return !NON_WALKABLE.has(getTileAt(worldX, worldY));
  }

  function isSanctuary(worldX, worldY) {
    return getTileAt(worldX, worldY) === TILE.SANCTUARY;
  }

  function getNPCs() {
    return npcs.map(function (n) { return Object.assign({}, n); });
  }

  function getWorldBounds() {
    return {
      x: 0,
      y: 0,
      width: MAP_WIDTH * TILE_SIZE,
      height: MAP_HEIGHT * TILE_SIZE,
    };
  }

  // ── Rendering ─────────────────────────────────────────────────────

  function render(ctx, camera) {
    if (!tileMap) return;

    const startTX = Math.max(0, Math.floor(camera.x / TILE_SIZE) - RENDER_BUFFER);
    const startTY = Math.max(0, Math.floor(camera.y / TILE_SIZE) - RENDER_BUFFER);
    const endTX = Math.min(
      MAP_WIDTH,
      Math.ceil((camera.x + camera.width) / TILE_SIZE) + RENDER_BUFFER
    );
    const endTY = Math.min(
      MAP_HEIGHT,
      Math.ceil((camera.y + camera.height) / TILE_SIZE) + RENDER_BUFFER
    );

    for (let ty = startTY; ty < endTY; ty++) {
      for (let tx = startTX; tx < endTX; tx++) {
        const id = tileMap[ty][tx];
        const px = tx * TILE_SIZE - camera.x;
        const py = ty * TILE_SIZE - camera.y;

        if (tilesetImage) {
          ctx.drawImage(
            tilesetImage,
            id * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE,
            px, py, TILE_SIZE, TILE_SIZE
          );
        } else {
          drawTilePattern(ctx, id, px, py);
        }

        if (id === TILE.SANCTUARY) {
          ctx.fillStyle = "rgba(200, 176, 64, 0.18)";
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  }

  // ── Environmental Overlays ────────────────────────────────────────

  function applyZoneEffects(ctx, camera, playerX, playerY) {
    const zone = getZoneAt(playerX, playerY);
    if (!zone) return;

    for (const effect of zone.effects) {
      switch (effect) {
        case "snow":
          updateAndDrawSnow(ctx, camera);
          break;

        case "dark": {
          const cx = playerX - camera.x;
          const cy = playerY - camera.y;
          const radius = 64;
          const gradient = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
          gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
          gradient.addColorStop(1, "rgba(0, 0, 0, 0.92)");
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          break;
        }

        case "sanctuary":
          // Sanctuary glow is handled per-tile during render
          break;
      }
    }

    // Void override: if the player tile itself is void, black out everything
    if (getTileAt(playerX, playerY) === TILE.VOID) {
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  // ── Alignment Barrier Collision ──────────────────────────────────

  function checkAlignmentBarrier(player, newX, newY) {
    var tile = getTileAt(newX, newY);
    var KNOCKBACK_PX = 120;

    if (tile === TILE.ORDERLY_BARRIER && player.alignment < -1) {
      var dx = newX - player.x;
      var dy = newY - player.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      return {
        blocked: true,
        effect: 'order',
        knockbackX: player.x - (dx / len) * KNOCKBACK_PX,
        knockbackY: player.y - (dy / len) * KNOCKBACK_PX,
        text: 'ORDER REPELS YOU',
        color: '#FFD700',
      };
    }

    if (tile === TILE.CHAOTIC_BARRIER && player.alignment > 0) {
      var cdx = newX - player.x;
      var cdy = newY - player.y;
      var clen = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
      return {
        blocked: true,
        effect: 'chaos',
        knockbackX: player.x - (cdx / clen) * KNOCKBACK_PX,
        knockbackY: player.y - (cdy / clen) * KNOCKBACK_PX,
        text: 'THE DARKNESS REJECTS YOUR LIGHT',
        color: '#8B008B',
      };
    }

    return { blocked: false };
  }

  // ── Barrier Visual Effect Rendering ────────────────────────────

  function renderBarrierEffect(ctx, camera, effect) {
    if (!effect || !effect.timer) return;

    var duration = 0.3;
    var t = effect.timer / duration;
    if (t <= 0 || t > 1) return;

    var opacity = t < 0.5
      ? (t / 0.5) * 0.8
      : ((1 - t) / 0.5) * 0.8;

    if (effect.effect === 'order') {
      ctx.fillStyle = 'rgba(255, 255, 255, ' + opacity + ')';
    } else {
      ctx.fillStyle = 'rgba(80, 0, 80, ' + opacity + ')';
    }

    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  // ── Exports ───────────────────────────────────────────────────────

  return {
    init: init,
    render: render,
    loadTileset: loadTileset,
    getTileAt: getTileAt,
    getZoneAt: getZoneAt,
    isWalkable: isWalkable,
    isSanctuary: isSanctuary,
    applyZoneEffects: applyZoneEffects,
    getNPCs: getNPCs,
    getNPCData: getNPCData,
    NPC_DATA: NPC_DATA,
    getWorldBounds: getWorldBounds,
    checkAlignmentBarrier: checkAlignmentBarrier,
    renderBarrierEffect: renderBarrierEffect,
    TILE_SIZE: TILE_SIZE,
    MAP_WIDTH: MAP_WIDTH,
    MAP_HEIGHT: MAP_HEIGHT,
    TILE: TILE,
  };
})();
