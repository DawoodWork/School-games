# Ashen Lineage — Project Context

## Architecture Overview

Ashen Lineage is a 2D pixel-art souls-like RPG rendered on HTML5 Canvas. The codebase is vanilla JavaScript using IIFE module patterns (no build tools, no bundler). All client modules attach to `window.*`.

**Stack:**
- Frontend: Vanilla JS, HTML5 Canvas, CSS (inline in HTML)
- Backend: Supabase (Auth, PostgreSQL, Realtime)
- Hosting: Vercel (static files + serverless API routes)
- Assets: 32x32 pixel sprites, 16x16 tile tilesets

**Data Flow:**
```
Supabase DB -> loadCharacter() -> new Player(data) -> Game Loop
Game Loop: handleInput() -> player.update(dt) -> Combat.updateCombat(dt) -> UI.renderHUD()
Combat syncs state back to player object -> player.syncToSupabase()
```

## File Structure

```
js/
  engine.js    (512 lines) — Game loop (60fps), camera, input (desktop+mobile), sprite loader, entity system
  world.js     (638 lines) — Procedural map gen (200x200 tiles), zones, tilesets, NPCs, collision
  player.js    (~690 lines) — Player constructor, movement, injuries, damage, death/lineage, rendering
  combat.js    (~830 lines) — 9 spells, melee combo, projectiles, AoE, dodge, parry, block, grip, statuses
  ui.js        (~1440 lines) — HUD, menus, inventory display, spell hotbar, NPC dialogue, death screen, insanity FX
  chat.js      (402 lines) — Proximity chat, speech bubbles, profanity filter, chat log
  enemies.js   (~500 lines) — Enemy types (Hollow/Shade/Brute), AI, spawning, loot drops, XP/leveling
  supabase.js  (~370 lines) — All DB operations: auth, characters, inventory, lineage, chat, realtime, admin
  game.js      (~430 lines) — Boot sequence, character creation, game init, input routing, realtime subscriptions

api/
  admin.js   — Serverless admin actions (give/remove items, set class, abilities, stats, alignment, teleport)
  chat.js    — Chat message API
  sync.js    — Character state sync API

assets/
  sprites/          — 14 assembled PNGs (player_default, 4 NPCs, 6 races, 3 enemies)
  sprites/_raw/     — Raw directional frames from PixelLab
  tilesets/         — 4 tileset PNGs + 4 JSON configs (grass_stone, grass_mud, grass_snow, dungeon)

HTML files:
  index.html  — Auth (sign in/register), redirects to game.html
  game.html   — Main game canvas, character creation modal
  admin.html  — Admin console
```

## Module Pattern

Every JS file uses the IIFE pattern and exports to `window`:
```javascript
window.ModuleName = (function () {
  'use strict';
  // private vars and functions
  return { publicMethod: fn, ... };
})();
// OR for constructors:
window.Player = Player; // inside IIFE
```

Script load order in game.html:
1. supabase.js
2. engine.js
3. world.js
4. player.js
5. combat.js
6. chat.js
7. ui.js
8. game.js

## What Works

- **Auth:** Sign up, sign in, sign out via Supabase Auth
- **Character creation:** Race/name selection, stored in Supabase `characters` table
- **Movement:** WASD/arrows with sprint (Shift), facing directions (north/south/east/west)
- **World:** Procedural 200x200 map with zones (Sanctuary, Spawn, Tundra, Dungeon, Forest, Swamp, Borderlands)
- **Collision:** Walls, water, trees block movement
- **Zone effects:** Snow particles (Tundra), darkness (Dungeon), sanctuary glow, void blackout
- **Alignment barriers:** Order/Chaos barriers with knockback
- **NPC dialogue:** Proximity-triggered dialogue with buy/learn options
- **Sprites:** Player + NPCs + race sprites render with directional animation
- **Tilesets:** 4 terrain types with Wang tile rendering
- **HUD:** HP/MP/Stamina bars, life skulls, currencies, zone badge, alignment meter
- **Spell hotbar:** Renders known spells with selection
- **Chat:** Proximity chat with bubbles, profanity filter, rate limiting
- **Realtime:** Player presence via Supabase Realtime channels
- **Admin console:** Full admin panel at admin.html
- **Death screen:** Lineage summary, "BEGIN NEW LINEAGE" button
- **Insanity effects:** 5 stages of visual distortion
- **Combat mechanics:** Melee combo (5-hit), 9 spells, projectiles, AoE, dodge, parry, block, grip/carry

## Recently Fixed Bugs (this session)

All of these are fixed and working:

1. `status_effects.slice` crash — uses `Object.assign({}, ...)` now
2. `getFacingVector` direction mismatch — handles both north/south/east/west and up/down/left/right
3. `completeGrip` not triggering death — calls `target.executeGrip()`
4. `downed` vs `isDown` mismatch — standardized to `isDown`, uses `goDown()` when HP reaches 0
5. Pause menu buttons not wired — added `handlePauseClick()` with Resume/Sign Out
6. Chat `addNotification` — changed to `showNotification`
7. Chat plane default 'mortal' — changed to 'gaia'
8. `player.isUber` never set — derived from `classTier`

## Recently Implemented Systems (this session)

### Item Use/Equip System (DONE)
- Consumables: health_potion (+30 HP), mana_potion (+25 MP)
- Equipment slots: `player.equipment.weapon`, `.armor`, `.shield`
- Equipment stats defined in `Combat.EQUIPMENT_STATS`
- Combat bonuses: weapon adds melee damage, armor reduces damage taken, shield adds max posture
- Inventory click: first click selects, second click uses/equips
- Equipment persisted to Supabase via `equipment` JSON column
- Supabase functions added: `updateInventoryItem`, `removeInventoryItem`

### Enemy/Monster System (DONE)
- New file `js/enemies.js` with 3 enemy types:
  - Hollow (melee, 40 HP, Forest/Swamp)
  - Shade (ranged with projectiles, 25 HP, Dungeon)
  - Brute (tank, 80 HP, Tundra)
- AI: idle -> patrol -> aggro chase -> attack
- Zone-based spawning with max caps and respawn timers
- Integrated with engine entity system and combat damage pipeline
- Enemies have `goDown()` that triggers death/drops/XP flow
- Sprite support: falls back to colored rectangles if sprite not loaded

### XP/Leveling/Progression System (DONE)
- XP awarded on enemy kills (25/35/60 per type)
- 12 level thresholds from 0 to 25000 XP
- Per-level stat bonuses: +5 maxHp, +3 maxMana, +2 maxStamina
- Class tier auto-advancement: advanced at Lv.5, master at Lv.15
- Spell unlocks at levels 2,4,6,8,10,12,14,15,18
- Level/XP shown in character sheet
- Auto-persists to Supabase on level-up

### Loot Drop System (DONE)
- Drop tables per enemy type with configurable chances
- Loot entities spawn at death position with bobbing animation
- Auto-pickup when player walks near (24px radius)
- Silver always drops from kills
- Adds to inventory and reloads UI

## What Still Needs Work

### Polish and Testing
- Verify death/bleedout flow works end-to-end with enemies
- `goDown()` timer -> auto-wipe if not rescued
- Test equipment bonuses actually apply in combat
- Test spell unlocks persist correctly
- Verify Supabase schema has `equipment`, `xp`, `level` columns

### Content Expansion
- More enemy types and zone variety
- Boss encounters
- Quest/objective system
- More items and equipment tiers
- More spells beyond the current 9

### Visual Polish
- Combat animations (attack/cast/death queued in PixelLab, processing)
- Equipment overlays on player sprite
- Spell projectile effect sprites
- Better enemy death visual (currently just disappears)

## Supabase Schema (known tables)

- `profiles` — user_id, username, is_admin, avatar_url
- `characters` — id, user_id, name, race, pos_x, pos_y, hp, max_hp, mana, max_mana, stamina, max_stamina, silver, valu, insight, alignment, lives_remaining, current_class, subclass, class_tier, current_plane, current_zone, insanity_stage, injuries, status_effects, known_spells, is_online, last_seen
- `inventory` — id, character_id, item_name, quantity, item_type, item_data
- `lineage` — id, user_id, character_name, character_race, cause_of_death, killer_name, final_alignment, insanity_at_death, lives_used, silver_at_death, inherited_silver, inherited_alignment_seed, inherited_race, inherited_mana_unlocked, inherited_heirlooms
- `chat_messages` — id, character_id, message, pos_x, pos_y, plane, created_at
- `world_events` — id, event_type, event_data, plane, zone, created_at

## MCP Servers Available

- **PixelLab** (`pixellab`): Generate pixel art sprites and tilesets. Use `create_character`, `animate_character`, `create_topdown_tileset` for game assets.
- **Supabase** (`supabase`): Direct database operations. Can be used to inspect/modify schema, run queries.
- **Apify** (`apify`): Web scraping and automation. Has a "Pixel Art Generator" actor.

## Key Constants

- `TILE_SIZE = 16` (world tiles are 16x16 pixels)
- `PLAYER_W = 32, PLAYER_H = 32` (player sprites are 32x32)
- `MAP_WIDTH = 200, MAP_HEIGHT = 200` (map is 200x200 tiles = 3200x3200 pixels)
- `DEFAULT_ZOOM = 2` (camera zoom)
- `TARGET_FPS = 60`
- Sprite sheets: 4 columns (frames) x 4 rows (directions: south, west, east, north)

## Development Notes

- No build step needed. Edit JS files directly and refresh browser.
- Local testing: `python3 -m http.server 8080` in project root
- Deploy: `vercel --prod` (configured in package.json)
- The game uses a seeded PRNG (seed 42) for map generation so the world is deterministic
- All game coordinates are in pixels. Tile coordinates = pixel / TILE_SIZE
