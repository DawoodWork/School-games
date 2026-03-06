/**
 * Ashen Lineage — Proximity Chat System
 * Speech bubbles, chat log, profanity filter, rate limiting.
 * Uses Supabase Realtime broadcast + chat_messages table.
 */
(function () {
  'use strict';

  var FONT = "'Press Start 2P', monospace";
  var PROXIMITY = 300;
  var BUBBLE_LIFETIME = 8;
  var MAX_MSG_LEN = 200;
  var RATE_LIMIT_MS = 1500;
  var MAX_LOG = 30;
  var BUBBLE_PAD = 8;
  var BUBBLE_MAX_W = 120;
  var BUBBLE_FONT_SIZE = 6;
  var LOG_WIDTH = 300;
  var LOG_BG = 'rgba(22, 33, 62, 0.85)';
  var INPUT_BG = '#16213E';

  var PROFANITY = [
    'fuck', 'shit', 'ass', 'bitch', 'damn', 'cunt', 'dick', 'piss',
    'cock', 'bastard', 'slut', 'whore', 'nigger', 'nigga', 'faggot',
    'retard', 'kys', 'stfu'
  ];
  var profanityRegex = new RegExp('\\b(' + PROFANITY.join('|') + ')\\b', 'gi');

  var ALIGNMENT_COLORS = {
    Ordained: '#FFD700',
    Orderly:  '#FFFFFF',
    Neutral:  '#AAAAAA',
    Chaotic:  '#FF8C00',
    Corrupt:  '#FF3333'
  };

  // ── State ────────────────────────────────────────────────────────

  var localPlayer = null;
  var chatChannel = null;
  var bubbles = [];
  var chatLog = [];
  var logOpen = false;
  var inputOpen = false;
  var lastSendTime = 0;
  var inputOverlay = null;
  var inputField = null;
  var isMobile = false;

  // ── Init ─────────────────────────────────────────────────────────

  function init(player) {
    localPlayer = player;
    isMobile =
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    var plane = player.plane || 'gaia';
    chatChannel = window.SupabaseHelper.subscribeToChat(plane, function (payload) {
      receiveMessage(payload);
    });

    window.addEventListener('keydown', _onKeyDown);
  }

  function _onKeyDown(e) {
    if (e.key === 't' || e.key === 'T') {
      if (!inputOpen && !_isTypingElsewhere()) {
        e.preventDefault();
        openChatInput();
      }
    }
    if (e.key === 'Escape' && inputOpen) {
      closeChatInput();
    }
  }

  function _isTypingElsewhere() {
    var el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  // ── Profanity Filter ─────────────────────────────────────────────

  function filterProfanity(text) {
    return text.replace(profanityRegex, '***');
  }

  // ── Send ──────────────────────────────────────────────────────────

  function sendMessage(text) {
    if (!localPlayer || !chatChannel) return;

    text = (text || '').trim();
    if (!text) return;
    if (text.length > MAX_MSG_LEN) {
      text = text.substring(0, MAX_MSG_LEN);
    }

    var now = Date.now();
    if (now - lastSendTime < RATE_LIMIT_MS) {
      if (window.UI && window.UI.showNotification) {
        window.UI.showNotification('Too fast!', 'warning');
      }
      return;
    }
    lastSendTime = now;

    text = filterProfanity(text);

    var payload = {
      charId: localPlayer.id,
      username: localPlayer.name || localPlayer.username || 'Unknown',
      message: text,
      x: localPlayer.x,
      y: localPlayer.y,
      race: localPlayer.race || '',
      plane: localPlayer.plane || 'gaia',
      alignment: localPlayer.alignment || 'Neutral',
      timestamp: Date.now()
    };

    chatChannel.send({
      type: 'broadcast',
      event: 'chat',
      payload: payload
    });

    window.SupabaseHelper.sendChatMessage(
      localPlayer.id,
      text,
      localPlayer.x,
      localPlayer.y,
      localPlayer.plane || 'gaia'
    );

    _addBubble(payload);
    _addToLog(payload);
  }

  // ── Receive ───────────────────────────────────────────────────────

  function receiveMessage(payload) {
    if (!localPlayer || !payload) return;
    if (payload.charId === localPlayer.id) return;

    var dx = (payload.x || 0) - localPlayer.x;
    var dy = (payload.y || 0) - localPlayer.y;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > PROXIMITY) return;

    payload.message = filterProfanity(payload.message || '');
    _addBubble(payload);
    _addToLog(payload);
  }

  // ── Bubbles ───────────────────────────────────────────────────────

  function _addBubble(payload) {
    bubbles.push({
      charId: payload.charId,
      username: payload.username,
      message: payload.message,
      x: payload.x,
      y: payload.y,
      age: 0,
      opacity: 1
    });
  }

  function updateBubbles(dt) {
    for (var i = bubbles.length - 1; i >= 0; i--) {
      bubbles[i].age += dt;
      if (bubbles[i].age >= BUBBLE_LIFETIME) {
        bubbles.splice(i, 1);
      } else if (bubbles[i].age > BUBBLE_LIFETIME - 1) {
        bubbles[i].opacity = Math.max(0, BUBBLE_LIFETIME - bubbles[i].age);
      }
    }
  }

  function renderBubbles(ctx, camera) {
    if (!bubbles.length) return;

    ctx.save();
    ctx.font = BUBBLE_FONT_SIZE + 'px ' + FONT;
    ctx.textBaseline = 'top';

    for (var i = 0; i < bubbles.length; i++) {
      var b = bubbles[i];
      var sx = (b.x - camera.x) * (camera.zoom || 2) + ctx.canvas.width / 2;
      var sy = (b.y - camera.y - 24) * (camera.zoom || 2) + ctx.canvas.height / 2;

      var lines = _wrapText(ctx, b.message, BUBBLE_MAX_W - BUBBLE_PAD * 2);
      var lineH = BUBBLE_FONT_SIZE + 3;
      var textH = lines.length * lineH;
      var textW = 0;
      for (var l = 0; l < lines.length; l++) {
        var lw = ctx.measureText(lines[l]).width;
        if (lw > textW) textW = lw;
      }

      var boxW = textW + BUBBLE_PAD * 2;
      var boxH = textH + BUBBLE_PAD * 2;
      var bx = sx - boxW / 2;
      var by = sy - boxH;

      ctx.globalAlpha = b.opacity;

      ctx.fillStyle = INPUT_BG;
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, boxW, boxH);

      ctx.fillStyle = '#FFFFFF';
      for (var j = 0; j < lines.length; j++) {
        ctx.fillText(lines[j], bx + BUBBLE_PAD, by + BUBBLE_PAD + j * lineH);
      }
    }

    ctx.restore();
  }

  function _wrapText(ctx, text, maxW) {
    var words = text.split(' ');
    var lines = [];
    var line = '';

    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  // ── Chat Log ──────────────────────────────────────────────────────

  function _addToLog(payload) {
    chatLog.push({
      username: payload.username,
      message: payload.message,
      alignment: payload.alignment || 'Neutral',
      timestamp: payload.timestamp || Date.now()
    });
    if (chatLog.length > MAX_LOG) {
      chatLog.shift();
    }
  }

  function openChatLog() { logOpen = true; }
  function closeChatLog() { logOpen = false; }
  function toggleChatLog() { logOpen = !logOpen; }

  function renderChatLog(ctx, canvas) {
    if (!logOpen) return;

    ctx.save();

    var w = isMobile ? canvas.width * 0.8 : LOG_WIDTH;
    var h = canvas.height;

    ctx.fillStyle = LOG_BG;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);

    ctx.font = '7px ' + FONT;
    ctx.textBaseline = 'top';

    var padX = 8;
    var padY = 8;
    var lineH = 12;
    var maxLines = Math.floor((h - padY * 2) / lineH);
    var start = Math.max(0, chatLog.length - maxLines);

    for (var i = start; i < chatLog.length; i++) {
      var entry = chatLog[i];
      var y = padY + (i - start) * lineH;

      var d = new Date(entry.timestamp);
      var ts = _pad(d.getHours()) + ':' + _pad(d.getMinutes());

      ctx.fillStyle = '#666666';
      ctx.fillText(ts + ' ', padX, y);
      var tsW = ctx.measureText(ts + ' ').width;

      ctx.fillStyle = ALIGNMENT_COLORS[entry.alignment] || '#AAAAAA';
      ctx.fillText(entry.username + ': ', padX + tsW, y);
      var nameW = ctx.measureText(entry.username + ': ').width;

      ctx.fillStyle = '#DDDDDD';
      var msgMaxW = w - padX * 2 - tsW - nameW;
      var clipped = _clipText(ctx, entry.message, msgMaxW);
      ctx.fillText(clipped, padX + tsW + nameW, y);
    }

    ctx.restore();
  }

  function _pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function _clipText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 0 && ctx.measureText(text + '…').width > maxW) {
      text = text.slice(0, -1);
    }
    return text + '…';
  }

  // ── Chat Input Overlay ────────────────────────────────────────────

  function openChatInput() {
    if (inputOpen) return;
    inputOpen = true;

    inputOverlay = document.createElement('div');
    inputOverlay.style.cssText =
      'position:fixed;bottom:0;left:0;right:0;z-index:9999;' +
      'display:flex;align-items:center;padding:6px 8px;' +
      'background:' + INPUT_BG + ';border-top:2px solid #C0392B;' +
      'font-family:' + FONT + ';';

    inputField = document.createElement('input');
    inputField.type = 'text';
    inputField.maxLength = MAX_MSG_LEN;
    inputField.placeholder = 'Say something…';
    inputField.style.cssText =
      'flex:1;background:transparent;border:1px solid #333;color:#FFF;' +
      'padding:6px 8px;font-family:' + FONT + ';font-size:10px;' +
      'outline:none;border-radius:2px;';

    var sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send';
    sendBtn.style.cssText =
      'margin-left:6px;background:#C0392B;color:#FFF;border:none;' +
      'padding:6px 12px;font-family:' + FONT + ';font-size:10px;' +
      'cursor:pointer;border-radius:2px;';

    sendBtn.addEventListener('click', _submitInput);

    inputField.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') {
        _submitInput();
      }
    });

    inputOverlay.appendChild(inputField);
    inputOverlay.appendChild(sendBtn);
    document.body.appendChild(inputOverlay);

    setTimeout(function () { inputField.focus(); }, 50);
  }

  function _submitInput() {
    if (!inputField) return;
    var text = inputField.value;
    closeChatInput();
    if (text.trim()) {
      sendMessage(text);
    }
  }

  function closeChatInput() {
    if (!inputOpen) return;
    inputOpen = false;
    if (inputOverlay && inputOverlay.parentNode) {
      inputOverlay.parentNode.removeChild(inputOverlay);
    }
    inputOverlay = null;
    inputField = null;
  }

  function isChatInputOpen() {
    return inputOpen;
  }

  // ── Export ─────────────────────────────────────────────────────────

  window.Chat = {
    init: init,
    sendMessage: sendMessage,
    receiveMessage: receiveMessage,
    renderBubbles: renderBubbles,
    updateBubbles: updateBubbles,
    renderChatLog: renderChatLog,
    openChatLog: openChatLog,
    closeChatLog: closeChatLog,
    toggleChatLog: toggleChatLog,
    openChatInput: openChatInput,
    closeChatInput: closeChatInput,
    isChatInputOpen: isChatInputOpen
  };
})();
