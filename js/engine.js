window.GameEngine = (function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  const TARGET_FPS = 60;
  const FRAME_DURATION = 1000 / TARGET_FPS;
  const CAMERA_LERP_SPEED = 0.1;
  const DEFAULT_ZOOM = 2;
  const MIN_TAP_TARGET = 64;

  // ── State ──────────────────────────────────────────────────────────────────

  let canvas, ctx;
  let running = false;
  let rafId = null;
  let lastTimestamp = 0;
  let accumulator = 0;

  let localPlayer = null;
  let world = null;
  let entities = [];

  // ── Input ──────────────────────────────────────────────────────────────────

  const input = {
    keys: new Set(),
    mouse: { x: 0, y: 0, clicked: false, rightClicked: false },
    joystick: { dx: 0, dy: 0 },
    isMobile: false,
  };

  function detectMobile() {
    input.isMobile =
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  // ── Desktop Input ──────────────────────────────────────────────────────────

  function normalizeKey(key) {
    return key.length === 1 ? key.toLowerCase() : key;
  }

  function initDesktopInput() {
    window.addEventListener('keydown', function (e) {
      input.keys.add(normalizeKey(e.key));
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', function (e) {
      input.keys.delete(normalizeKey(e.key));
    });

    canvas.addEventListener('mousedown', function (e) {
      if (e.button === 0) input.mouse.clicked = true;
      if (e.button === 2) input.mouse.rightClicked = true;
    });

    canvas.addEventListener('mouseup', function (e) {
      if (e.button === 0) input.mouse.clicked = false;
      if (e.button === 2) input.mouse.rightClicked = false;
    });

    canvas.addEventListener('mousemove', function (e) {
      var rect = canvas.getBoundingClientRect();
      input.mouse.x = (e.clientX - rect.left) / camera.zoom;
      input.mouse.y = (e.clientY - rect.top) / camera.zoom;
    });

    canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });
  }

  // ── Mobile Input ───────────────────────────────────────────────────────────

  var mobileUI = {
    joystickCenter: null,
    joystickActive: false,
    joystickTouchId: null,
    joystickRadius: 50,
    buttons: [],
  };

  function initMobileInput() {
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    canvas.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });

    buildMobileButtons();
  }

  function buildMobileButtons() {
    var w = canvas.width / camera.zoom;
    var h = canvas.height / camera.zoom;
    var pad = 16;
    var btnSize = Math.max(MIN_TAP_TARGET, 64);

    mobileUI.joystickCenter = {
      x: 80,
      y: h - 80,
    };
    mobileUI.joystickRadius = 50;

    mobileUI.buttons = [
      { id: 'attack', x: w - pad - btnSize, y: h - pad - btnSize, w: btnSize * 1.2, h: btnSize * 1.2, label: 'ATK', active: false, touchId: null },
      { id: 'mana', x: w - pad - btnSize * 2.5, y: h - pad - btnSize * 0.5, w: btnSize, h: btnSize, label: 'MANA', active: false, touchId: null },
      { id: 'chat', x: w - pad - btnSize, y: pad, w: btnSize, h: btnSize * 0.6, label: 'CHAT', active: false, touchId: null },
    ];
  }

  function getTouchPos(touch) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (touch.clientX - rect.left) / camera.zoom,
      y: (touch.clientY - rect.top) / camera.zoom,
    };
  }

  function handleTouchStart(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var touch = e.changedTouches[i];
      var pos = getTouchPos(touch);

      var hitButton = false;
      for (var b = 0; b < mobileUI.buttons.length; b++) {
        var btn = mobileUI.buttons[b];
        if (pos.x >= btn.x && pos.x <= btn.x + btn.w && pos.y >= btn.y && pos.y <= btn.y + btn.h) {
          btn.active = true;
          btn.touchId = touch.identifier;
          hitButton = true;
          handleMobileButton(btn.id, true);
          break;
        }
      }

      if (!hitButton && pos.x < canvas.width / camera.zoom / 2) {
        mobileUI.joystickActive = true;
        mobileUI.joystickTouchId = touch.identifier;
        mobileUI.joystickCenter = { x: pos.x, y: pos.y };
        input.joystick.dx = 0;
        input.joystick.dy = 0;
      }
    }
  }

  function handleTouchMove(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var touch = e.changedTouches[i];
      var pos = getTouchPos(touch);

      if (mobileUI.joystickActive && touch.identifier === mobileUI.joystickTouchId) {
        var dx = pos.x - mobileUI.joystickCenter.x;
        var dy = pos.y - mobileUI.joystickCenter.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var maxDist = mobileUI.joystickRadius;
        if (dist > maxDist) {
          dx = (dx / dist) * maxDist;
          dy = (dy / dist) * maxDist;
        }
        input.joystick.dx = dx / maxDist;
        input.joystick.dy = dy / maxDist;
      }
    }
  }

  function handleTouchEnd(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var touch = e.changedTouches[i];

      if (mobileUI.joystickActive && touch.identifier === mobileUI.joystickTouchId) {
        mobileUI.joystickActive = false;
        mobileUI.joystickTouchId = null;
        input.joystick.dx = 0;
        input.joystick.dy = 0;
      }

      for (var b = 0; b < mobileUI.buttons.length; b++) {
        var btn = mobileUI.buttons[b];
        if (btn.touchId === touch.identifier) {
          btn.active = false;
          btn.touchId = null;
          handleMobileButton(btn.id, false);
        }
      }
    }
  }

  function handleMobileButton(id, pressed) {
    switch (id) {
      case 'attack':
        input.mouse.clicked = pressed;
        break;
      case 'mana':
        if (pressed) input.keys.add('g');
        else input.keys.delete('g');
        break;
      case 'chat':
        if (pressed) input.keys.add('t');
        break;
    }
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  var camera = {
    x: 0,
    y: 0,
    zoom: DEFAULT_ZOOM,
    viewWidth: 0,
    viewHeight: 0,
  };

  function updateCamera() {
    if (!localPlayer || !world) return;

    var targetX = localPlayer.x + (localPlayer.width || 0) / 2 - camera.viewWidth / 2;
    var targetY = localPlayer.y + (localPlayer.height || 0) / 2 - camera.viewHeight / 2;

    camera.x += (targetX - camera.x) * CAMERA_LERP_SPEED;
    camera.y += (targetY - camera.y) * CAMERA_LERP_SPEED;

    var worldW = world.width || camera.viewWidth;
    var worldH = world.height || camera.viewHeight;

    if (camera.x < 0) camera.x = 0;
    if (camera.y < 0) camera.y = 0;
    if (camera.x > worldW - camera.viewWidth) camera.x = worldW - camera.viewWidth;
    if (camera.y > worldH - camera.viewHeight) camera.y = worldH - camera.viewHeight;

    camera.x = Math.round(camera.x);
    camera.y = Math.round(camera.y);
  }

  function recalcViewport() {
    camera.viewWidth = canvas.width / camera.zoom;
    camera.viewHeight = canvas.height / camera.zoom;
  }

  // ── Sprite Loader ──────────────────────────────────────────────────────────

  var spriteLoader = {
    sprites: new Map(),
    progress: { loaded: 0, total: 0 },

    loadSprite: function (name, path) {
      spriteLoader.progress.total++;
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          spriteLoader.sprites.set(name, img);
          spriteLoader.progress.loaded++;
          resolve(img);
        };
        img.onerror = function () {
          reject(new Error('Failed to load sprite: ' + path));
        };
        img.src = path;
      });
    },

    getSprite: function (name) {
      return spriteLoader.sprites.get(name) || null;
    },

    loadAll: function (manifest) {
      var promises = [];
      var keys = Object.keys(manifest);
      for (var i = 0; i < keys.length; i++) {
        promises.push(spriteLoader.loadSprite(keys[i], manifest[keys[i]]));
      }
      return Promise.all(promises);
    },
  };

  // ── Entity System ──────────────────────────────────────────────────────────

  function addEntity(entity) {
    entities.push(entity);
  }

  function removeEntity(entity) {
    var idx = entities.indexOf(entity);
    if (idx !== -1) entities.splice(idx, 1);
  }

  function getEntitiesInRect(x, y, w, h) {
    var results = [];
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      var ex = e.x || 0;
      var ey = e.y || 0;
      var ew = e.width || 0;
      var eh = e.height || 0;
      if (ex + ew > x && ex < x + w && ey + eh > y && ey < y + h) {
        results.push(e);
      }
    }
    return results;
  }

  // ── Render Pipeline ────────────────────────────────────────────────────────

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(camera.zoom, 0, 0, camera.zoom, 0, 0);

    renderBackground();
    renderTiles();
    renderEntities();
    renderPlayer();

    ctx.setTransform(camera.zoom, 0, 0, camera.zoom, 0, 0);
    renderUI();

    if (input.isMobile) renderMobileHUD();
  }

  function renderBackground() {
    if (world && typeof world.renderBackground === 'function') {
      world.renderBackground(ctx, camera);
    }
  }

  function renderTiles() {
    if (world && typeof world.renderTiles === 'function') {
      world.renderTiles(ctx, camera);
    }
  }

  function renderEntities() {
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (typeof e.render === 'function') {
        e.render(ctx, camera);
      }
    }
  }

  function renderPlayer() {
    if (localPlayer && typeof localPlayer.render === 'function') {
      localPlayer.render(ctx, camera);
    }
  }

  function renderUI() {
    if (world && typeof world.renderUI === 'function') {
      world.renderUI(ctx, camera);
    }
    if (localPlayer && typeof localPlayer.renderHUD === 'function') {
      localPlayer.renderHUD(ctx, camera);
    }
  }

  function renderMobileHUD() {
    ctx.setTransform(camera.zoom, 0, 0, camera.zoom, 0, 0);
    ctx.globalAlpha = 0.35;

    if (mobileUI.joystickActive) {
      var jc = mobileUI.joystickCenter;
      var jr = mobileUI.joystickRadius;
      ctx.beginPath();
      ctx.arc(jc.x, jc.y, jr, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.closePath();

      var knobX = jc.x + input.joystick.dx * jr;
      var knobY = jc.y + input.joystick.dy * jr;
      ctx.beginPath();
      ctx.arc(knobX, knobY, jr * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#cccccc';
      ctx.fill();
      ctx.closePath();
    }

    for (var i = 0; i < mobileUI.buttons.length; i++) {
      var btn = mobileUI.buttons[i];
      ctx.fillStyle = btn.active ? '#ffffff' : '#888888';
      ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#000000';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2);
      ctx.globalAlpha = 0.35;
    }

    ctx.globalAlpha = 1;
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  function update(dt) {
    if (localPlayer && typeof localPlayer.update === 'function') {
      localPlayer.update(dt, input);
    }

    for (var i = 0; i < entities.length; i++) {
      if (typeof entities[i].update === 'function') {
        entities[i].update(dt);
      }
    }

    if (world && typeof world.update === 'function') {
      world.update(dt);
    }

    updateCamera();
  }

  // ── Game Loop ──────────────────────────────────────────────────────────────

  function loop(timestamp) {
    if (!running) return;
    rafId = requestAnimationFrame(loop);

    var elapsed = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    if (elapsed > 200) elapsed = 200;
    accumulator += elapsed;

    var dt = FRAME_DURATION / 1000;

    while (accumulator >= FRAME_DURATION) {
      update(dt);
      accumulator -= FRAME_DURATION;
    }

    render();
  }

  // ── Resize Handling ────────────────────────────────────────────────────────

  function handleResize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.imageSmoothingEnabled = false;
    recalcViewport();
    if (input.isMobile) buildMobileButtons();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');

    canvas.style.imageRendering = 'pixelated';
    canvas.style.imageRendering = '-moz-crisp-edges';
    canvas.style.imageRendering = 'crisp-edges';
    ctx.imageSmoothingEnabled = false;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    recalcViewport();

    detectMobile();
    initDesktopInput();
    if (input.isMobile) initMobileInput();

    window.addEventListener('resize', handleResize);
  }

  function start(player, worldRef) {
    localPlayer = player;
    world = worldRef;
    running = true;
    lastTimestamp = performance.now();
    accumulator = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function getCamera() {
    return camera;
  }

  return {
    init: init,
    start: start,
    stop: stop,
    getCamera: getCamera,
    addEntity: addEntity,
    removeEntity: removeEntity,
    getEntitiesInRect: getEntitiesInRect,
    input: input,
    spriteLoader: spriteLoader,
  };
})();
