/* Magnet Blocks – rendering, input, sound and UI. Geometry lives in geometry.js. */
(function () {
  'use strict';
  const G = window.MagnetGeometry;
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  const VIEW_W = 9;          // world units that always fit across the screen
  const VIEW_H = 7;          // ...and above the ground
  const GRASS = 18;          // px of grass between the ground line and the tray
  const TAP_PX = 10, TAP_MS = 500;
  const TOUCH_LIFT = 1.0;    // world units a touch-spawned piece floats above the finger

  const state = {
    pieces: [], nextId: 1, color: G.COLORS[3].hex, selected: null,
    mode: 'free', challengeIdx: 0, won: false,
    drag: null, glow: null, particles: [], muted: false,
    level: loadLevel(), // 1 ⭐ outline of the build, 2 ⭐⭐ counts only
  };
  function loadLevel() {
    try { const v = Number(localStorage.getItem('magnet-blocks-difficulty')); if (v === 1 || v === 2) return v; } catch (e) { /* private mode */ }
    return 1;
  }
  function slots() {
    return state.mode === 'challenge' && state.level === 1 ? G.targetSlots(G.CHALLENGES[state.challengeIdx]) : [];
  }
  const view = { W: 0, H: 0, dpr: 1, trayH: 100, groundY: 0, s: 40, topReserve: 100 };

  // ------------------------------------------------------------------- layout
  function layout() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.W = window.innerWidth;
    view.H = window.innerHeight;
    canvas.width = Math.round(view.W * view.dpr);
    canvas.height = Math.round(view.H * view.dpr);
    view.trayH = Math.max(96, Math.min(150, view.H * 0.16));
    view.groundY = view.H - view.trayH - GRASS;
    const card = $('card');
    const barBottom = $('bar').getBoundingClientRect().bottom;
    card.style.top = barBottom + 4 + 'px';
    view.topReserve = barBottom + 4 + (card.classList.contains('show') ? card.offsetHeight + 4 : 0);
    view.s = Math.max(20, Math.min(view.W / VIEW_W, (view.groundY - view.topReserve) / VIEW_H));
    for (const p of state.pieces) clampToView(p);
  }
  const w2s = (x, y) => ({ x: view.W / 2 + x * view.s, y: view.groundY - y * view.s });
  const s2w = (px, py) => ({ x: (px - view.W / 2) / view.s, y: (view.groundY - py) / view.s });
  const inTray = (py) => py >= view.H - view.trayH;

  function clampToView(p) {
    const halfW = view.W / 2 / view.s, top = (view.groundY - view.topReserve) / view.s;
    const b = G.pieceBounds(p);
    if (b.minX < -halfW) p.x += -halfW - b.minX;
    if (b.maxX > halfW) p.x -= b.maxX - halfW;
    if (b.maxY > top) p.y -= b.maxY - top;
    if (b.minY < 0) p.y -= b.minY;
  }

  // -------------------------------------------------------------------- audio
  let actx = null;
  function audio() {
    if (state.muted) return null;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { return null; }
    return actx;
  }
  function tone(freq, delay, dur, type, vol, slideTo) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const sfx = {
    click() { // magnet "tick-clack"
      tone(1500, 0, 0.05, 'square', 0.12, 600);
      tone(220, 0.01, 0.07, 'sine', 0.25, 110);
    },
    drop() { tone(300, 0, 0.09, 'triangle', 0.25, 150); },
    pop() { tone(700, 0, 0.12, 'sine', 0.22, 180); },
    rotate() { tone(500, 0, 0.08, 'triangle', 0.2, 800); },
    color() { tone(880, 0, 0.1, 'sine', 0.18, 1320); },
    success() { [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => tone(f, i * 0.09, 0.28, 'triangle', 0.25)); },
  };

  // ---------------------------------------------------------------- particles
  function burst(x, y, n, colors, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (0.3 + Math.random()) * power;
      state.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - power * 0.5,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, size: 5 + Math.random() * 7,
        color: colors[(Math.random() * colors.length) | 0], life: 1.2 + Math.random() * 0.8, age: 0 });
    }
  }
  function confetti() {
    const colors = G.COLORS.map((c) => c.hex);
    for (let i = 0; i < 160; i++) {
      state.particles.push({ x: Math.random() * view.W, y: -20 - Math.random() * view.H * 0.5,
        vx: (Math.random() - 0.5) * 120, vy: 80 + Math.random() * 220, rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 14, size: 7 + Math.random() * 8,
        color: colors[(Math.random() * colors.length) | 0], life: 3 + Math.random() * 1.5, age: 0 });
    }
    burst(view.W / 2, view.H * 0.4, 60, colors, 400);
  }

  // ------------------------------------------------------------------- pieces
  function addPiece(shape, x, y) {
    const p = { id: state.nextId++, shape, color: state.color, x, y, rot: 0, pop: performance.now() };
    state.pieces.push(p);
    return p;
  }
  function removePiece(p) {
    const i = state.pieces.indexOf(p);
    if (i >= 0) state.pieces.splice(i, 1);
    if (state.selected === p) state.selected = null;
    const c = w2s(p.x, p.y);
    burst(c.x, c.y, 14, [p.color, '#fff'], 220);
  }
  function others(p) { return state.pieces.filter((q) => q !== p); }
  function applySnap(p) {
    const r = G.snapPiece(p, others(p));
    p.x = r.x; p.y = r.y;
    return r;
  }

  function rotatePiece(piece) {
    piece.rot = (piece.rot + 1) % 4;
    clampToView(piece);
    const r = applySnap(piece);
    piece.pop = performance.now();
    if (r.contact) sfx.click(); else sfx.rotate();
    if (r.contact) state.glow = { x: r.contact.x, y: r.contact.y, fade: performance.now() };
  }

  // Big round ↻ button beside the selected piece (screen coords), or null.
  function rotateHandle() {
    const p = state.selected;
    if (!p || state.drag || state.pieces.indexOf(p) < 0) return null;
    const b = G.pieceBounds(p), c = w2s(b.maxX, b.maxY), r = 24;
    return {
      x: Math.min(view.W - r - 6, Math.max(r + 6, c.x + r * 0.9)),
      y: Math.min(view.H - view.trayH - r - 6, Math.max(view.topReserve + r, c.y - r * 0.9)),
      r,
    };
  }

  // -------------------------------------------------------------------- input
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function slotAt(px) {
    return G.SHAPE_ORDER[Math.max(0, Math.min(G.SHAPE_ORDER.length - 1, Math.floor((px / view.W) * G.SHAPE_ORDER.length)))];
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (state.drag) return;
    audio();
    const p = pos(e);
    const h = rotateHandle();
    if (h && Math.hypot(p.x - h.x, p.y - h.y) <= h.r + 8) {
      rotatePiece(state.selected);
      afterChange();
      return;
    }
    let piece, offX = 0, offY = 0, fromTray = false;
    if (inTray(p.y)) {
      fromTray = true;
      const w = s2w(p.x, p.y);
      piece = addPiece(slotAt(p.x), w.x, w.y);
      offY = e.pointerType === 'mouse' ? 0 : TOUCH_LIFT;
    } else {
      const w = s2w(p.x, p.y);
      piece = G.hitTest(state.pieces, w.x, w.y, 0.25 * (e.pointerType === 'mouse' ? 0.4 : 1));
      if (!piece) { state.selected = null; return; }
      offX = piece.x - w.x; offY = piece.y - w.y;
      state.pieces.splice(state.pieces.indexOf(piece), 1);
      state.pieces.push(piece);
      state.selected = piece;
    }
    canvas.setPointerCapture(e.pointerId);
    state.drag = { id: e.pointerId, piece, offX, offY, fromTray, startX: p.x, startY: p.y,
      t0: performance.now(), moved: false, overTray: fromTray, contactKey: null };
    if (fromTray) state.selected = piece;
    drag(p);
  });

  function drag(p) {
    const d = state.drag, piece = d.piece;
    if (Math.hypot(p.x - d.startX, p.y - d.startY) > TAP_PX) d.moved = true;
    d.overTray = inTray(p.y);
    const w = s2w(p.x, p.y);
    piece.x = w.x + d.offX; piece.y = w.y + d.offY;
    clampToView(piece);
    if (d.overTray && d.moved) { state.glow = null; return; }
    if (d.fromTray && !d.moved) return;
    const r = applySnap(piece);
    if (r.contact) {
      state.glow = { x: r.contact.x, y: r.contact.y, fade: null };
      if (r.key !== d.contactKey) { sfx.click(); piece.pop = performance.now(); }
    } else state.glow = null;
    d.contactKey = r.contact ? r.key : null;
  }

  canvas.addEventListener('pointermove', (e) => {
    if (state.drag && state.drag.id === e.pointerId) drag(pos(e));
  });

  function endDrag(e, cancelled) {
    const d = state.drag;
    if (!d || d.id !== e.pointerId) return;
    state.drag = null;
    const p = pos(e), piece = d.piece;
    if (cancelled || (d.overTray && (d.moved || !d.fromTray))) {
      removePiece(piece); sfx.pop(); state.glow = null; afterChange(); return;
    }
    if (d.fromTray && !d.moved) { // tap on a tray shape: drop a copy in the middle
      const mid = s2w(view.W / 2, view.groundY - (view.groundY - view.topReserve) * 0.55);
      piece.x = mid.x + (Math.random() - 0.5) * 2; piece.y = mid.y; piece.rot = 0;
      clampToView(piece);
      const r = applySnap(piece);
      if (r.contact) sfx.click(); else sfx.drop();
      piece.pop = performance.now();
    } else if (!d.moved && performance.now() - d.t0 < TAP_MS && !d.fromTray) {
      rotatePiece(piece); // tap = rotate + select
    } else {
      sfx.drop();
      if (state.glow) state.glow.fade = performance.now();
      piece.pop = performance.now();
    }
    if (state.glow && state.glow.fade === null) state.glow.fade = performance.now();
    afterChange();
  }
  canvas.addEventListener('pointerup', (e) => endDrag(e, false));
  canvas.addEventListener('pointercancel', (e) => endDrag(e, true));

  // ----------------------------------------------------------------------- UI
  const palette = $('palette');
  G.COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'swatch'; b.style.background = c.hex; b.dataset.color = c.hex;
    b.setAttribute('aria-label', c.name);
    b.addEventListener('click', () => setColor(c.hex));
    palette.appendChild(b);
  });
  function setColor(hex) {
    audio();
    state.color = hex;
    if (state.selected) { state.selected.color = hex; state.selected.pop = performance.now(); }
    sfx.color();
    syncPalette();
    afterChange();
  }
  function syncPalette() {
    for (const b of palette.children) b.classList.toggle('on', b.dataset.color === state.color);
  }

  function setMode(mode) {
    audio();
    state.mode = mode;
    $('btnFree').classList.toggle('on', mode === 'free');
    $('btnChallenge').classList.toggle('on', mode === 'challenge');
    $('card').classList.toggle('show', mode === 'challenge');
    if (mode === 'challenge') { state.won = false; renderCard(); openPicker(); }
    else closePicker();
    layout();
    afterChange();
  }

  // ----- choose what to build
  const doneBuilds = new Set();
  function openPicker() {
    $('pickGrid').innerHTML = G.CHALLENGES.map((ch, i) =>
      `<button class="pick${i === state.challengeIdx ? ' current' : ''}${doneBuilds.has(ch.id) ? ' done' : ''}" ` +
      `data-i="${i}" aria-label="${ch.name}">${ch.emoji}<span>${ch.name}</span></button>`).join('');
    for (const b of $('pickGrid').children) b.addEventListener('click', () => startChallenge(Number(b.dataset.i)));
    $('picker').classList.add('show');
  }
  function closePicker() { $('picker').classList.remove('show'); }
  function startChallenge(i) {
    audio();
    closePicker();
    clearAll(true);
    state.challengeIdx = i;
    state.won = false;
    $('card').classList.remove('won');
    renderCard();
    layout();
    sfx.color();
  }
  $('cardEmoji').addEventListener('click', openPicker);
  $('pickClose').addEventListener('click', closePicker);
  $('picker').addEventListener('click', (e) => { if (e.target === $('picker')) closePicker(); });
  $('btnFree').addEventListener('click', () => setMode('free'));
  $('btnChallenge').addEventListener('click', () => setMode('challenge'));
  $('btnClear').addEventListener('click', () => clearAll());
  $('btnSound').addEventListener('click', () => {
    state.muted = !state.muted;
    $('btnSound').textContent = state.muted ? '🔇' : '🔊';
    if (!state.muted) sfx.pop();
  });
  $('level').addEventListener('click', () => {
    state.level = state.level % 2 + 1;
    try { localStorage.setItem('magnet-blocks-difficulty', String(state.level)); } catch (e) { /* ignore */ }
    sfx.color();
    syncLevel();
  });
  function syncLevel() {
    $('level').textContent = '⭐'.repeat(state.level);
    $('level').setAttribute('aria-label', 'Difficulty ' + state.level + ' of 2');
  }
  $('next').addEventListener('click', () => startChallenge((state.challengeIdx + 1) % G.CHALLENGES.length));

  function clearAll(silent) {
    for (const p of state.pieces) { const c = w2s(p.x, p.y); burst(c.x, c.y, 6, [p.color, '#fff'], 200); }
    state.pieces.length = 0; state.selected = null; state.glow = null;
    if (!silent) sfx.pop();
    afterChange();
  }

  function shapeIcon(key, fill) {
    const sh = G.SHAPES[key];
    const pts = sh.poly.map((p) => `${(p[0] + sh.width / 2).toFixed(3)},${(sh.height / 2 - p[1]).toFixed(3)}`).join(' ');
    const m = Math.max(sh.width, sh.height);
    return `<svg viewBox="${-(m - sh.width) / 2 - 0.05} ${-(m - sh.height) / 2 - 0.05} ${m + 0.1} ${m + 0.1}"><polygon points="${pts}" fill="${fill}" stroke="${shade(fill, -0.38)}" stroke-width="0.08" stroke-linejoin="round"/></svg>`;
  }

  function renderCard() {
    const ch = G.CHALLENGES[state.challengeIdx];
    $('cardEmoji').textContent = ch.emoji;
    $('cardTitle').textContent = `Build a ${ch.name}!`;
    $('chips').innerHTML = ch.need.map((r, i) =>
      `<button class="chip" data-i="${i}" aria-label="${r.n} ${r.color} ${r.shape}">` +
      `${shapeIcon(r.shape, G.COLOR_HEX[r.color])}<span class="n"></span></button>`).join('');
    // Tapping a chip picks its colour, so little ones needn't hunt in the palette.
    for (const chip of $('chips').children) {
      chip.addEventListener('click', () => setColor(G.COLOR_HEX[ch.need[chip.dataset.i].color]));
    }
    updateCard();
  }
  function updateCard() {
    if (state.mode !== 'challenge') return null;
    const ch = G.CHALLENGES[state.challengeIdx];
    const prog = G.challengeProgress(state.pieces, ch);
    for (const chip of $('chips').children) {
      const i = Number(chip.dataset.i), need = ch.need[i].n, have = prog.have[i];
      chip.querySelector('.n').textContent = have >= need ? '✅' : `${have}/${need}`;
      chip.classList.toggle('done', have >= need);
    }
    return prog;
  }

  function afterChange() {
    const prog = updateCard();
    if (prog && prog.done && !state.won) {
      state.won = true;
      doneBuilds.add(G.CHALLENGES[state.challengeIdx].id);
      $('card').classList.add('won');
      sfx.success();
      confetti();
    }
  }

  // ---------------------------------------------------------------- rendering
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
    return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  }

  // pts: [{x,y}] screen coords
  function pathOf(pts) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }

  function drawBlock(pts, color, unit, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    pathOf(pts);
    ctx.fillStyle = color; ctx.fill();
    ctx.save(); ctx.clip();
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const g = ctx.createLinearGradient(0, minY, 0, maxY);
    g.addColorStop(0, 'rgba(255,255,255,.38)'); g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,.14)');
    ctx.fillStyle = g; ctx.fillRect(0, minY - 2, view.W, maxY - minY + 4);
    ctx.restore();
    pathOf(pts);
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, unit * 0.08);
    ctx.strokeStyle = shade(color, -0.38); ctx.stroke();
    ctx.restore();
  }

  function popScale(p, now) {
    if (!p.pop) return 1;
    const k = (now - p.pop) / 350;
    return k >= 1 ? 1 : 1 + 0.16 * Math.sin(k * Math.PI) * (1 - k);
  }

  function drawPiece(p, now) {
    const d = state.drag;
    let k = popScale(p, now);
    const dragging = d && d.piece === p;
    if (dragging && d.overTray && d.moved) k *= 0.6;
    const poly = G.worldPolygon(p).map((v) => w2s(p.x + (v.x - p.x) * k, p.y + (v.y - p.y) * k));
    if (state.selected === p) {
      ctx.save();
      pathOf(poly); ctx.lineJoin = 'round';
      ctx.lineWidth = view.s * 0.22; ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = view.s * 0.5; ctx.stroke();
      ctx.restore();
    }
    drawBlock(poly, p.color, view.s, dragging && d.overTray && d.moved ? 0.7 : 1);
  }

  function drawBackground(now) {
    const g = ctx.createLinearGradient(0, 0, 0, view.groundY);
    g.addColorStop(0, '#bde8ff'); g.addColorStop(1, '#effaff');
    ctx.fillStyle = g; ctx.fillRect(0, 0, view.W, view.H);
    // sun and drifting clouds
    ctx.fillStyle = '#fff3a8';
    ctx.beginPath(); ctx.arc(view.W * 0.85, view.groundY * 0.22, Math.min(46, view.W * 0.08), 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (let i = 0; i < 3; i++) {
      const cx = ((now / 60 + i * view.W * 0.4) % (view.W + 200)) - 100, cy = view.groundY * (0.28 + i * 0.17), r = 16 + i * 5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 7); ctx.arc(cx + r, cy - r * 0.4, r * 1.2, 0, 7); ctx.arc(cx + r * 2.1, cy, r, 0, 7);
      ctx.fill();
    }
    // grass
    ctx.fillStyle = '#7ed957'; ctx.fillRect(0, view.groundY, view.W, view.H - view.groundY);
    ctx.fillStyle = '#5cb83d'; ctx.fillRect(0, view.groundY, view.W, 4);
  }

  function trayGeom() {
    const n = G.SHAPE_ORDER.length, slotW = view.W / n;
    return { n, slotW, scale: Math.min(slotW / 2.5, (view.trayH - 30) / 1.2, 60), cy: view.H - view.trayH / 2 + 4 };
  }

  function drawTray() {
    const d = state.drag, del = d && d.overTray && d.moved;
    const t = trayGeom(), top = view.H - view.trayH;
    ctx.fillStyle = del ? '#d9534f' : '#3b2f63';
    ctx.beginPath(); ctx.roundRect(-10, top, view.W + 20, view.trayH + 10, 26); ctx.fill();
    ctx.fillStyle = del ? '#e57671' : '#4d4080';
    for (let i = 0; i < t.n; i++) {
      ctx.beginPath(); ctx.roundRect(i * t.slotW + 6, top + 10, t.slotW - 12, view.trayH - 18, 18); ctx.fill();
    }
    if (del) {
      ctx.font = `${Math.min(56, view.trayH * 0.5)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🗑️', view.W / 2, t.cy);
      return;
    }
    G.SHAPE_ORDER.forEach((key, i) => {
      const sh = G.SHAPES[key], cx = (i + 0.5) * t.slotW;
      const pts = sh.poly.map((v) => ({ x: cx + v[0] * t.scale, y: t.cy - v[1] * t.scale }));
      drawBlock(pts, state.color, t.scale);
    });
  }

  // ⭐: one plain grey outline of the build (no colours, no piece lines).
  function drawTarget() {
    const ss = slots(); if (!ss.length) return;
    ctx.beginPath();
    for (const sl of ss) {
      G.worldPolygon(sl).forEach((v, i) => { const q = w2s(v.x, v.y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(59,47,99,.2)'; ctx.fill();
  }

  function drawGlow(now) {
    const g = state.glow; if (!g) return;
    let a = 1;
    if (g.fade !== null) { a = 1 - (now - g.fade) / 450; if (a <= 0) { state.glow = null; return; } }
    const c = w2s(g.x, g.y), r = view.s * (0.45 + 0.08 * Math.sin(now / 80));
    const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
    grad.addColorStop(0, `rgba(255,255,255,${0.95 * a})`); grad.addColorStop(0.4, `rgba(255,226,90,${0.7 * a})`);
    grad.addColorStop(1, 'rgba(255,226,90,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 7); ctx.fill();
  }

  function drawRotateHandle(now) {
    const h = rotateHandle(); if (!h) return;
    const bob = Math.sin(now / 250) * 1.5;
    ctx.save();
    ctx.translate(h.x, h.y + bob);
    ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, h.r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#8e4fd0'; ctx.fillStyle = '#8e4fd0'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    const r = h.r * 0.5, a0 = -Math.PI * 0.35, a1 = Math.PI * 1.25;
    ctx.beginPath(); ctx.arc(0, 0, r, a0, a1); ctx.stroke();
    // arrowhead at the start of the arc, pointing anticlockwise like the turn
    ctx.translate(Math.cos(a0) * r, Math.sin(a0) * r); ctx.rotate(a0);
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(7, 3); ctx.lineTo(-7, 3); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawParticles(dt) {
    const ps = state.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt; p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.age > p.life || p.y > view.H + 40) { ps.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.min(1, (p.life - p.age) * 2);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawBackground(now);
    drawTarget();
    const d = state.drag, held = d && d.piece;
    for (const p of state.pieces) if (p !== held) drawPiece(p, now);
    drawGlow(now);
    drawTray();
    if (held) drawPiece(held, now);
    drawRotateHandle(now);
    drawParticles(dt);
    requestAnimationFrame(frame);
  }

  // --------------------------------------------------------------------- boot
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 150));
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  syncPalette();
  syncLevel();
  layout();
  requestAnimationFrame(frame);

  // Small hook for the Playwright smoke test and debugging.
  window.magnetGame = {
    state, view, w2s, s2w, setMode, rotateHandle, slots,
    trayPoint(shape) {
      const t = trayGeom();
      return { x: (G.SHAPE_ORDER.indexOf(shape) + 0.5) * t.slotW, y: t.cy };
    },
  };
})();
