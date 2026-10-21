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

  const FREE_KEY = 'magnet-blocks-free';
  const state = {
    // Each mode keeps its own board; `pieces` is always the current mode's board, so
    // starting a challenge never wipes a free build.
    boards: { free: [], challenge: [] }, pieces: null,
    nextId: 1, color: G.COLORS[3].hex, selected: null,
    mode: 'free', challengeIdx: 0, won: false,
    drag: null, glow: null, particles: [], muted: false,
    lastBinned: null, binUndoUntil: 0, landed: false,
    score: Number(load('magnet-blocks-score', 0)) || 0, lastGain: 0,
  };
  state.pieces = state.boards.free;
  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); if (v !== null) return v; } catch (e) { /* private mode */ }
    return fallback;
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }
  function drop(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
  function slots() {
    return state.mode === 'challenge' ? G.targetSlots(G.CHALLENGES[state.challengeIdx]) : [];
  }
  const view = { W: 0, H: 0, dpr: 1, trayH: 100, groundY: 0, s: 40, topReserve: 100 };

  // ------------------------------------------------------------------- layout
  function layout() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.W = window.innerWidth;
    view.H = window.innerHeight;
    canvas.width = Math.round(view.W * view.dpr);
    canvas.height = Math.round(view.H * view.dpr);
    view.trayH = Math.max(72, Math.min(150, view.H * 0.16)); // clamp(72px, 16vh, 150px)
    view.groundY = view.H - view.trayH - GRASS;
    const card = $('card');
    const barBottom = $('bar').getBoundingClientRect().bottom;
    card.style.top = barBottom + 4 + 'px';
    view.topReserve = barBottom + 4 + (card.classList.contains('show') ? card.offsetHeight + 4 : 0);
    // No minimum scale: on a short landscape phone a floor pushed the top of the build
    // under the card. A challenge only needs its own height (plus headroom to lift the
    // last piece in), so it can use a bigger scale than free build's fixed VIEW_H.
    view.s = Math.min(view.W / VIEW_W, (view.groundY - view.topReserve) / fitHeight());
    $('next').style.bottom = view.trayH + GRASS + 14 + 'px';
    for (const p of state.pieces) clampToView(p);
  }
  // World units of height the view must show above the ground.
  function fitHeight() {
    if (state.mode !== 'challenge') return VIEW_H;
    const maxY = Math.max(0, ...slots().map((sl) => G.pieceBounds(sl).maxY));
    return Math.max(maxY + 0.75, 3.5);
  }
  const compactHud = () => window.matchMedia('(max-height: 500px)').matches;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    select() { tone(660, 0, 0.06, 'sine', 0.15); },
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
  // quiet: no burst, for a tray spawn that is simply put back.
  function removePiece(p, quiet) {
    const i = state.pieces.indexOf(p);
    if (i >= 0) state.pieces.splice(i, 1);
    if (state.selected === p) state.selected = null;
    if (quiet) return;
    const c = w2s(p.x, p.y);
    burst(c.x, c.y, 14, [p.color, '#fff'], 220);
  }
  // Snapshots are the plain {shape, color, x, y, rot} of pieces. They're used to undo a bin
  // delete or a clear, and to save the free build.
  function snapshot(pieces) {
    return pieces.map((p) => ({ shape: p.shape, color: p.color, x: p.x, y: p.y, rot: p.rot }));
  }
  // Adds the snapshotted pieces to `board` (the current board by default) with fresh ids.
  function restore(snaps, board) {
    const now = performance.now();
    for (const s of snaps) {
      if (!s || !G.SHAPES[s.shape] || typeof s.color !== 'string' || !Number.isFinite(s.x) ||
          !Number.isFinite(s.y) || ![0, 1, 2, 3].includes(s.rot)) continue; // skip bad saved data
      (board || state.pieces).push({ id: state.nextId++, shape: s.shape, color: s.color, x: s.x, y: s.y, rot: s.rot, pop: now });
    }
  }
  function others(p) { return state.pieces.filter((q) => q !== p); }
  function applySnap(p) {
    const r = G.snapPiece(p, others(p));
    p.x = r.x; p.y = r.y;
    return r;
  }
  // The part of the world blocks may use: x within ±halfW, y up to top.
  function viewBounds() {
    return { halfW: view.W / 2 / view.s, top: (view.groundY - view.topReserve) / view.s };
  }

  // Blocks never overlap: a block let go inside another moves to the nearest free spot
  // (on top, if that's as near), and snaps there. Then loose blocks fall (see settle).
  // Returns true if `piece` itself is falling, so its sound waits for the landing.
  function place(piece) {
    if (G.overlapsAny(piece, others(piece))) {
      const spot = G.findFreeSpot(piece, others(piece), viewBounds());
      if (spot) { piece.x = spot.x; piece.y = spot.y; applySnap(piece); }
    }
    return settle().some((m) => m.piece === piece);
  }
  // Gravity: blocks that aren't held up by the ground, another block or a magnet fall.
  // Their positions change at once; they're drawn falling into place (see fallOffset).
  // A board passed in (a saved one, on load) settles without the animation.
  const FALL_MS = 170; // per √unit, so a long fall speeds up like a real one
  function settle(board) {
    const moves = G.settle(board || state.pieces);
    const now = performance.now();
    for (const m of moves) {
      const h = Math.hypot(m.fromX - m.piece.x, m.fromY - m.piece.y);
      m.piece.fall = reducedMotion() || board ? null : { fromX: m.fromX, fromY: m.fromY, t0: now, dur: FALL_MS * Math.sqrt(h) };
    }
    return moves;
  }
  // Offset (world units) from a falling block's resting place to where it's drawn.
  function fallOffset(p, now) {
    const f = p.fall;
    if (!f) return null;
    const k = (now - f.t0) / f.dur;
    if (k >= 1) {
      p.fall = null; p.pop = now;
      if (!state.landed) { // one landing sound per frame: a thud on the ground, a clack on a block
        state.landed = true;
        if (G.pieceBounds(p).minY < 0.01) sfx.drop(); else sfx.click();
      }
      return null;
    }
    const e = 1 - k * k; // starts slow, lands fast
    return { x: (f.fromX - p.x) * e, y: (f.fromY - p.y) * e };
  }

  function rotatePiece(piece) {
    piece.rot = (piece.rot + 1) % 4;
    clampToView(piece);
    const r = applySnap(piece);
    piece.pop = performance.now();
    if (place(piece)) sfx.rotate();
    else if (r.contact) sfx.click(); else sfx.rotate();
    if (r.contact) state.glow = { x: r.contact.x, y: r.contact.y, fade: performance.now() };
  }

  // Big round ↻ button beside the selected piece (screen coords), or null.
  function rotateHandle() {
    const p = state.selected;
    if (!p || state.drag || state.pieces.indexOf(p) < 0) return null;
    const b = G.pieceBounds(p), c = w2s(b.maxX, b.maxY), r = 17;
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

  // ---------------------------------------------------------------- trash bin
  // A bin that appears top-right only while a block is being dragged. A block is deleted
  // only if it rests over the bin for BIN_DWELL ms (so a fling across it does nothing),
  // and for BIN_UNDO ms afterwards a tap on the bin brings it back.
  const BIN_DWELL = 200, BIN_UNDO = 4000, BIN_HIT = 52, BIN_POP = 150;
  function binGeom() {
    const R = compactHud() ? 26 : 32;
    return { x: view.W - 16 - R, y: view.topReserve + 16 + R, R, hit: BIN_HIT };
  }
  const binUndoable = (now) => !!state.lastBinned && now < state.binUndoUntil;
  // Shown during a real drag (not a tap) and while its undo is on offer.
  const binVisible = (now) => (state.drag && state.drag.moved) || binUndoable(now);
  function unbin() {
    if (!state.lastBinned) return;
    restore([state.lastBinned]);
    state.selected = state.pieces[state.pieces.length - 1] || null;
    state.lastBinned = null; state.binUndoUntil = 0;
    if (state.selected) place(state.selected);
    sfx.drop();
    afterChange();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (state.drag) return;
    audio();
    const p = pos(e);
    const now = performance.now();
    if (binUndoable(now)) { // checked first: the bin floats over the board for a few seconds
      const b = binGeom();
      if (Math.hypot(p.x - b.x, p.y - b.y) <= b.R + 14) { unbin(); return; }
    }
    const h = rotateHandle();
    if (h && Math.hypot(p.x - h.x, p.y - h.y) <= h.r + 12) { // a little bigger than it looks, for small fingers
      rotatePiece(state.selected);
      afterChange();
      return;
    }
    let piece, offX = 0, offY = 0, fromTray = false, wasSelected = false;
    if (inTray(p.y)) {
      fromTray = true;
      const w = s2w(p.x, p.y);
      piece = addPiece(slotAt(p.x), w.x, w.y);
      offY = e.pointerType === 'mouse' ? 0 : TOUCH_LIFT;
    } else {
      const w = s2w(p.x, p.y);
      piece = G.hitTest(state.pieces, w.x, w.y, 0.25 * (e.pointerType === 'mouse' ? 0.4 : 1));
      if (!piece) { state.selected = null; return; }
      wasSelected = state.selected === piece;
      offX = piece.x - w.x; offY = piece.y - w.y;
      piece.fall = null;
      state.pieces.splice(state.pieces.indexOf(piece), 1);
      state.pieces.push(piece);
      state.selected = piece;
    }
    canvas.setPointerCapture(e.pointerId);
    // start: where an existing block was, so a cancelled drag can put it back.
    state.drag = { id: e.pointerId, piece, offX, offY, fromTray, wasSelected, startX: p.x, startY: p.y,
      start: { x: piece.x, y: piece.y, rot: piece.rot },
      t0: now, moved: false, leftTray: false, binSince: null, binArmed: false, binShownAt: 0, contactKey: null };
    if (fromTray) state.selected = piece;
    drag(p, true);
  });

  // A finger resting over the bin sends no pointermove, so the dwell is also re-checked
  // every frame and on release, not only in drag().
  function updateBinArm(d, now) {
    d.binArmed = d.binSince !== null && now - d.binSince >= BIN_DWELL;
    if (d.binArmed) state.glow = null;
    return d.binArmed;
  }

  function drag(p, initial) {
    const d = state.drag, piece = d.piece, now = performance.now();
    if (!d.moved && Math.hypot(p.x - d.startX, p.y - d.startY) > TAP_PX) { d.moved = true; d.binShownAt = now; }
    const w = s2w(p.x, p.y);
    // "Left the tray" (tray spawns only) is judged on the finger plus a touch lift, not the
    // bare finger: a block set on the ground by touch leaves the finger ~0.5
    // units below the grass, which is already inside the tray. The drawn block can't be used
    // either, because clampToView always keeps it above the ground.
    // The lift is capped at half the spawn's depth into the tray, so on big screens (where a
    // full TOUCH_LIFT reaches above the tray top) a spawn still has to really move up and out.
    // Not judged on the pointerdown call: nothing has moved yet.
    if (!initial && !d.leftTray) {
      const trayTop = view.H - view.trayH;
      const lift = Math.max(0, Math.min(d.offY * view.s, (d.startY - trayTop) / 2));
      d.leftTray = p.y - lift < trayTop;
    }
    piece.x = w.x + d.offX; piece.y = w.y + d.offY;
    clampToView(piece);
    // The bin hit test uses the block, not the finger (TOUCH_LIFT shifts the finger): its
    // centre near the bin, or the block covering the bin's centre. The second case is for wide
    // blocks (trapezoid, arch), which clampToView stops short of the corner, so their centre
    // can never get within BIN_HIT on bigger screens.
    const b = binGeom(), c = w2s(piece.x, piece.y), bw = s2w(b.x, b.y);
    const overBin = Math.hypot(c.x - b.x, c.y - b.y) <= b.hit || !!G.hitTest([piece], bw.x, bw.y, 0);
    if (d.moved && overBin) {
      if (d.binSince === null) d.binSince = now;
    } else d.binSince = null;
    if (updateBinArm(d, now)) { state.glow = null; d.contactKey = null; return; } // no snapping over an armed bin
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
    const piece = d.piece;
    // Only an armed bin ever deletes a block that has been on the board. Dropping over the
    // tray just leaves the block resting on the ground.
    if (cancelled && !d.fromTray) { // the OS took the touch away: put the block back where it was
      piece.x = d.start.x; piece.y = d.start.y; piece.rot = d.start.rot;
      state.glow = null; afterChange(); return;
    }
    if (d.fromTray && (cancelled ? !(d.moved && d.leftTray) : d.moved && !d.leftTray)) {
      // A new block that never left the tray is quietly put back (no pop, no burst).
      removePiece(piece, true); state.glow = null; afterChange(); return;
    }
    if (!cancelled && updateBinArm(d, performance.now())) {
      // Undo puts it back where it was picked up (a new block falls from the bin's corner).
      state.lastBinned = Object.assign(snapshot([piece])[0], d.fromTray ? {} : d.start);
      state.binUndoUntil = performance.now() + BIN_UNDO;
      removePiece(piece); sfx.pop();
      settle();
      const b = binGeom();
      burst(b.x, b.y, 10, [piece.color, '#fff'], 160);
      state.glow = null; afterChange(); return;
    }
    // A cancelled tray spawn that had left the tray falls through and stays where it is.
    if (d.fromTray && !d.moved) { // tap on a tray shape: drop a copy in the middle
      const mid = s2w(view.W / 2, view.groundY - (view.groundY - view.topReserve) * 0.55);
      piece.x = mid.x + (Math.random() - 0.5) * 2; piece.y = mid.y; piece.rot = 0;
      clampToView(piece);
      const r = applySnap(piece);
      if (!place(piece)) { if (r.contact) sfx.click(); else sfx.drop(); }
      piece.pop = performance.now();
    } else if (!d.moved && performance.now() - d.t0 < TAP_MS && !d.fromTray) {
      // First tap selects (so a colour can be picked); tapping the selected block turns it.
      if (d.wasSelected) rotatePiece(piece);
      else { piece.pop = performance.now(); sfx.select(); }
    } else {
      if (!place(piece)) sfx.drop();
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
    state.pieces = state.boards[mode];
    state.selected = null; state.glow = null;
    endUndos(); // an undo belongs to the board it came from
    $('btnFree').classList.toggle('on', mode === 'free');
    $('btnChallenge').classList.toggle('on', mode === 'challenge');
    $('card').classList.toggle('show', mode === 'challenge');
    // state.won is kept: the challenge board comes back as it was, and resetting it would
    // award a finished build a second time.
    $('next').classList.toggle('show', mode === 'challenge' && state.won);
    $('card').classList.toggle('won', mode === 'challenge' && state.won);
    if (mode === 'challenge') { renderCard(); openPicker(); }
    else closePicker();
    layout();
    afterChange();
  }

  // ----- choose what to build
  const doneBuilds = new Set([].concat(load('magnet-blocks-done', [])));
  const TIER_DOT = { 1: '🟢', 2: '🟡', 3: '🔴' };
  const TIER_NAME = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
  const current = () => G.CHALLENGES[state.challengeIdx];
  const packOf = (id) => G.PACKS.find((p) => p.id === id);
  const packBuilds = (id) => G.CHALLENGES.filter((c) => c.pack === id);
  const potential = (ch) => G.challengeScore(ch, !doneBuilds.has(ch.id));
  let pickerPack = null;
  function openPicker() {
    pickerPack = pickerPack || current().pack;
    $('packTabs').innerHTML = G.PACKS.map((p) => {
      const all = packBuilds(p.id), done = all.filter((c) => doneBuilds.has(c.id)).length;
      return `<button class="packTab${p.id === pickerPack ? ' on' : ''}" data-pack="${p.id}" role="tab" ` +
        `aria-label="${p.name}">${p.emoji}<span>${done}/${all.length}</span></button>`;
    }).join('');
    for (const b of $('packTabs').children) b.addEventListener('click', () => { pickerPack = b.dataset.pack; sfx.color(); openPicker(); });
    // The builds in this pack, easiest first, with their tier and the points they're worth.
    $('pickGrid').innerHTML = G.CHALLENGES.map((ch, i) => ch.pack !== pickerPack ? '' :
      `<button class="pick${i === state.challengeIdx ? ' current' : ''}${doneBuilds.has(ch.id) ? ' done' : ''}" ` +
      `data-i="${i}" aria-label="${ch.name}">${ch.emoji}<span>${ch.name}</span>` +
      `<span class="meta">${TIER_DOT[ch.tier]} ${TIER_NAME[ch.tier]}</span><span class="meta">${potential(ch)} 🏆</span></button>`).join('');
    for (const b of $('pickGrid').children) b.addEventListener('click', () => startChallenge(Number(b.dataset.i)));
    $('picker').classList.toggle('halloween', pickerPack === 'halloween');
    $('picker').classList.add('show');
  }
  function closePicker() { $('picker').classList.remove('show'); pickerPack = null; }
  function startChallenge(i) {
    audio();
    closePicker();
    endUndos();
    clearAll(true, state.boards.challenge); // only the challenge board; a free build is kept
    state.challengeIdx = i;
    state.won = false;
    $('card').classList.remove('won');
    $('next').classList.remove('show');
    renderCard();
    layout();
    sfx.color();
  }
  $('cardEmoji').addEventListener('click', openPicker);
  $('pickClose').addEventListener('click', closePicker);
  $('picker').addEventListener('click', (e) => { if (e.target === $('picker')) closePicker(); });
  $('btnFree').addEventListener('click', () => setMode('free'));
  $('btnChallenge').addEventListener('click', () => setMode('challenge'));

  // ----- 🧹 press and hold to clear (a ring fills around it), then ↩️ undo in the same spot.
  // A tap does nothing, so a stray touch can't wipe a build.
  const HOLD_MS = 700, CLEAR_UNDO_MS = 6000;
  const btnClear = $('btnClear');
  const clr = { t0: 0, raf: 0, undo: null, timer: 0, swallowClick: false };
  function setHold(k) { btnClear.style.setProperty('--hold', String(k)); btnClear.classList.toggle('holding', k > 0); }
  function holdStart() {
    if (clr.undo || clr.raf) return;
    audio();
    clr.t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - clr.t0) / HOLD_MS);
      setHold(k);
      if (k < 1) { clr.raf = requestAnimationFrame(tick); return; }
      clr.raf = 0; setHold(0);
      clr.swallowClick = true; // the release that follows must not hit the ↩️ that replaces 🧹
      clearWithUndo();
    };
    clr.raf = requestAnimationFrame(tick);
  }
  function holdEnd() { // released early: nothing happens
    if (clr.raf) { cancelAnimationFrame(clr.raf); clr.raf = 0; }
    setHold(0);
  }
  function setClearButton(undo) {
    btnClear.textContent = undo ? '↩️' : '🧹';
    btnClear.setAttribute('aria-label', undo ? 'Undo clear' : 'Clear everything (press and hold)');
    btnClear.title = undo ? 'Undo' : 'Press and hold to clear';
    btnClear.classList.toggle('undo', undo);
  }
  function clearWithUndo() {
    if (!state.pieces.length) return;
    clr.undo = { board: state.pieces, snaps: snapshot(state.pieces) };
    clearAll();
    setClearButton(true);
    clr.timer = setTimeout(endClearUndo, CLEAR_UNDO_MS);
  }
  function endClearUndo() {
    clearTimeout(clr.timer);
    clr.undo = null;
    setClearButton(false);
  }
  function undoClear() {
    const u = clr.undo; if (!u) return;
    endClearUndo();
    restore(u.snaps, u.board);
    // Blocks added since the clear stay; anything they're in the way of moves aside.
    if (G.separate(u.board, viewBounds()) || u.board.length > u.snaps.length) settle();
    sfx.drop();
    afterChange();
  }
  // Both undos only make sense on the board they came from.
  function endUndos() { endClearUndo(); state.lastBinned = null; state.binUndoUntil = 0; }
  btnClear.addEventListener('pointerdown', (e) => {
    clr.swallowClick = false;
    if (e.button === 0) holdStart();
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btnClear.addEventListener(ev, holdEnd);
  btnClear.addEventListener('click', () => {
    if (clr.swallowClick) { clr.swallowClick = false; return; }
    if (clr.undo) undoClear();
  });
  // Keyboard: hold Enter or Space the same way; a press while ↩️ shows undoes.
  btnClear.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); // no native click, and no auto-repeat clicks while held
    if (e.repeat) return;
    if (clr.undo) undoClear(); else holdStart();
  });
  btnClear.addEventListener('keyup', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    holdEnd(); clr.swallowClick = false;
  });
  setClearButton(false);

  // ----- welcome: shown on the first visit, and again from ❓
  $('welcomePacks').textContent = G.PACKS.map((p) => `${p.emoji} ${p.name}`).join(' · ');
  function showWelcome() { closePicker(); $('welcome').classList.add('show'); }
  function startFrom(mode) {
    modeChosen = true;
    $('welcome').classList.remove('show');
    save('magnet-blocks-welcomed', true);
    setMode(mode);
  }
  $('welcomeChallenge').addEventListener('click', () => startFrom('challenge'));
  $('welcomeFree').addEventListener('click', () => startFrom('free'));
  // ✖️ or a tap outside just closes it. On the first visit that leaves the blank board in free build.
  let modeChosen = false;
  function closeWelcome() {
    if (modeChosen) { $('welcome').classList.remove('show'); save('magnet-blocks-welcomed', true); }
    else startFrom('free');
  }
  $('welcomeClose').addEventListener('click', closeWelcome);
  $('welcome').addEventListener('click', (e) => { if (e.target === $('welcome')) closeWelcome(); });
  $('btnHelp').addEventListener('click', showWelcome);
  // "🏆 Prizes, backgrounds & points": from ❓ to the shelf (focus returns to 🏆 when it closes).
  $('welcomePrizes').addEventListener('click', () => { closeWelcome(); openShelf(); });
  $('btnSound').addEventListener('click', () => {
    state.muted = !state.muted;
    $('btnSound').textContent = state.muted ? '🔇' : '🔊';
    if (!state.muted) sfx.pop();
  });
  $('next').addEventListener('click', () => startChallenge(G.nextChallenge(state.challengeIdx, doneBuilds)));

  function clearAll(silent, board) {
    board = board || state.pieces;
    if (board === state.pieces) {
      for (const p of board) { const c = w2s(p.x, p.y); burst(c.x, c.y, 6, [p.color, '#fff'], 200); }
      state.selected = null; state.glow = null;
    }
    board.length = 0;
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
    $('cardTitle').textContent = `${TIER_DOT[ch.tier]} Build a ${ch.name}!`;
    $('chips').innerHTML = ch.need.map((r, i) =>
      `<button class="chip" data-i="${i}" aria-label="${r.n} ${r.color} ${r.shape}">` +
      `${shapeIcon(r.shape, G.COLOR_HEX[r.color])}<span class="n"></span></button>`).join('');
    // Tapping a chip picks its colour, so little ones needn't hunt in the palette.
    for (const chip of $('chips').children) {
      chip.addEventListener('click', () => setColor(G.COLOR_HEX[ch.need[chip.dataset.i].color]));
    }
    updateGain();
    updateCard();
  }
  function updateGain() { $('gain').textContent = `+${potential(current())} 🏆`; }
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
    save(FREE_KEY, snapshot(state.boards.free)); // the free build survives a reload
    const prog = updateCard();
    if (prog && prog.done && !state.won) {
      state.won = true;
      const ch = current();
      const gain = potential(ch);
      const packWasDone = packBuilds(ch.pack).every((c) => doneBuilds.has(c.id));
      doneBuilds.add(ch.id);
      save('magnet-blocks-done', [...doneBuilds]);
      $('gain').textContent = `+${gain} 🏆`;
      $('card').classList.add('won');
      sfx.success();
      confetti();
      addScore(gain, `+${gain}`, 0);
      // Finishing a whole themed pack for the first time: a bonus and an encore.
      if (!packWasDone && packBuilds(ch.pack).every((c) => doneBuilds.has(c.id))) {
        addScore(G.PACK_BONUS, `${packOf(ch.pack).emoji} +${G.PACK_BONUS}`, 1300);
        const gen = scoreGen;
        setTimeout(() => { if (gen === scoreGen) { confetti(); sfx.success(); } }, 1300); // not after a reset
      }
      unlockGifts(); // any 🎁 crossed waits for the count-up to finish
      const nx = G.CHALLENGES[G.nextChallenge(state.challengeIdx, doneBuilds)];
      $('nextEmoji').textContent = nx.emoji;
      $('next').setAttribute('aria-label', 'Next: ' + nx.name);
      $('next').classList.add('show');
    }
  }

  // ----- score: a "+N" flies from the card to the 🏆 counter, which counts up
  let shownScore = state.score;
  let countUps = 0; // "+N"s still flying or counting up; a 🎁 celebration waits for none
  let scoreGen = 0;  // bumped by a reset, so "+N"s and count-ups already on their way stop
  // The counter, its label, and the strip to the next gift (which follows the count-up).
  function syncScore() {
    const s = Math.round(shownScore), m = G.nextMilestone(s), strip = $('giftStrip');
    $('scoreN').textContent = String(s);
    $('score').setAttribute('aria-label', `Score ${s}. Gifts`);
    $('scoreIcon').textContent = m ? '🏆' : '👑'; // every gift earned: the crown
    if ($('gifts').classList.contains('show')) renderHowPoints(); // keeps the grown-ups line current
    strip.hidden = !m;
    if (!m) return;
    $('giftFill').style.width = (m.k * 100).toFixed(1) + '%';
    strip.classList.toggle('near', m.k >= 0.75); // a 🎁 peeks out near the end (never "N to go")
    strip.setAttribute('aria-valuemin', String(m.from));
    strip.setAttribute('aria-valuemax', String(m.to));
    strip.setAttribute('aria-valuenow', String(s));
  }
  function addScore(gain, label, delay) {
    state.score += gain; state.lastGain = gain;
    save('magnet-blocks-score', state.score);
    countUps++;
    const gen = scoreGen;
    setTimeout(() => { if (gen === scoreGen) flyToScore(label); }, delay);
  }
  function flyToScore(label) {
    const gen = scoreGen;
    const from = $('card').getBoundingClientRect(), to = $('score').getBoundingClientRect();
    const fly = document.createElement('div');
    fly.className = 'fly'; fly.textContent = label;
    fly.style.left = from.left + from.width / 2 + 'px'; fly.style.top = from.top + from.height / 2 + 'px';
    document.body.appendChild(fly);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fly.style.transform = `translate(${to.left + to.width / 2 - from.left - from.width / 2}px, ${to.top - from.top - from.height / 2}px) scale(.6)`;
      fly.style.opacity = '0.2';
    }));
    setTimeout(() => {
      fly.remove();
      if (gen !== scoreGen) return;
      const start = shownScore, t0 = performance.now();
      const step = (now) => {
        if (gen !== scoreGen) return;
        const k = Math.min(1, (now - t0) / 700);
        shownScore = start + (state.score - start) * k;
        syncScore();
        if (k < 1) { requestAnimationFrame(step); return; }
        countUps = Math.max(0, countUps - 1);
        showNextGift();
      };
      requestAnimationFrame(step);
      $('score').classList.remove('bump'); void $('score').offsetWidth; $('score').classList.add('bump');
      tone(1568, 0, 0.12, 'sine', 0.2); tone(2093, 0.08, 0.18, 'sine', 0.2); // "ding-ding"
    }, 900);
  }

  // ----- 🎁 gifts: the 🏆 score unlocks free-build skies and block looks (G.GIFTS).
  // Saved as {v, unlocked, scene, skin, seen}. The score is the source of truth: everything
  // it has reached is unlocked on load, so a lost or stale key never loses a gift.
  const GIFTS_KEY = 'magnet-blocks-gifts';
  const giftById = (id) => G.GIFTS.find((g) => g.id === id);
  const SKY_ICON = { sunny: '☀️', night: '🌙', sea: '🐟', space: '🪐', dusk: '🎃' };
  const SCENE_NAME = { sunny: 'Sunny sky', dusk: 'Dusk sky' }, SKIN_NAME = { plain: 'Plain blocks' };
  // Where a chosen sky shows: free build and every pack that isn't themed (e.g. "🎨 free build and 🧸 builds").
  const SKY_WHERE = ['🎨 free build'].concat(G.PACKS.filter((p) => !p.themed).map((p) => `${p.emoji} builds`)).join(' and ');
  $('skyCaption').textContent = 'Shows in ' + SKY_WHERE;
  for (const g of G.GIFTS) {
    if (g.scene && !SCENE_NAME[g.scene]) SCENE_NAME[g.scene] = g.name;
    if (g.skin) SKIN_NAME[g.skin] = g.name;
  }
  // The skies / looks on offer: the default first, then the unlocked ones in gift order.
  const scenesOf = (unlocked) => ['sunny'].concat(G.GIFTS.filter((g) => g.scene && unlocked.has(g.id)).map((g) => g.scene));
  const skinsOf = (unlocked) => ['plain'].concat(G.GIFTS.filter((g) => g.skin && unlocked.has(g.id)).map((g) => g.skin));
  function loadGifts() {
    const raw = load(GIFTS_KEY, null);
    const stored = raw && typeof raw === 'object' ? raw : {};
    const known = (ids) => (Array.isArray(ids) ? ids : []).filter((id) => giftById(id));
    const unlocked = new Set(known(stored.unlocked).concat(G.milestonesReached(state.score)));
    // No key yet but a score (a player from before gifts, or a lost key): everything reached
    // unlocks silently and unseen, so the 🏆 dot shows instead of a flood of celebrations.
    return {
      unlocked, seen: new Set(known(stored.seen)),
      scene: scenesOf(unlocked).includes(stored.scene) ? stored.scene : 'sunny',
      skin: skinsOf(unlocked).includes(stored.skin) ? stored.skin : 'plain',
    };
  }
  const gifts = loadGifts();
  function saveGifts() {
    save(GIFTS_KEY, { v: 1, unlocked: [...gifts.unlocked], scene: gifts.scene, skin: gifts.skin, seen: [...gifts.seen] });
  }
  // The gifts the child can see: unlocked, minus any still waiting for (or showing, unopened) its
  // celebration, so the shelf never gives away a surprise. They're saved as unlocked at once,
  // though, so a reload mid-count-up keeps the gift (it then shows with the dot instead).
  function shownGifts() {
    const pending = new Set(giftQueue.concat(cel.gift && !cel.opened ? [cel.gift.id] : []));
    return new Set([...gifts.unlocked].filter((id) => !pending.has(id)));
  }
  // A dot on 🏆 while a gift on the shelf hasn't been seen.
  function updateDot() {
    $('giftDot').hidden = ![...shownGifts()].some((id) => !gifts.seen.has(id));
  }

  // ----- modal focus. While a modal dialog is open everything else on the page is `inert`, so
  // Tab and screen readers stay inside it, and Tab / Shift+Tab wrap round its buttons.
  // A stack, so a dialog over a dialog works. (The picker and welcome could use it too: #22.)
  const modals = [];
  function syncInert() {
    const top = modals[modals.length - 1];
    for (const el of document.body.children) if (el.tagName !== 'SCRIPT') el.inert = !!top && el !== top;
  }
  function trapFocus(dialog) {
    if (!modals.includes(dialog)) modals.push(dialog);
    syncInert();
  }
  // Call before moving focus back out: an inert element can't take focus.
  function releaseFocus(dialog) {
    const i = modals.indexOf(dialog);
    if (i >= 0) modals.splice(i, 1);
    syncInert();
  }
  document.addEventListener('keydown', (e) => {
    const top = modals[modals.length - 1];
    if (e.key !== 'Tab' || !top) return;
    const items = [...top.querySelectorAll('button, [href], input, summary, [tabindex]')].filter((b) =>
      !b.disabled && b.tabIndex >= 0 && b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden' &&
      getComputedStyle(b).pointerEvents !== 'none'); // e.g. the opened 🎁 while it fades out
    // Always moved here, never by the browser, so it can't land on something fading out.
    e.preventDefault();
    if (!items.length) return;
    const i = items.indexOf(document.activeElement), n = items.length;
    items[i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? n - 1 : 1)) % n].focus();
  });

  // ----- celebration: one overlay per new gift, in turn, once the score has counted up
  const giftQueue = [];
  const cel = { gift: null, opened: false, openTimer: 0, closeTimer: 0, nextTimer: 0 };
  // How long the 🎁 waits before opening itself, and the opened gift before closing (ms).
  // Only the smoke test changes these.
  const giftTiming = { open: 6000, close: 5000 };
  function unlockGifts() {
    for (const id of G.milestonesReached(state.score)) {
      if (gifts.unlocked.has(id)) continue;
      gifts.unlocked.add(id); giftQueue.push(id);
    }
    saveGifts(); // unlocked straight away, so a reload mid-celebration still keeps it (with the dot)
    showNextGift();
  }
  function showNextGift() {
    // Waits for an open reset confirmation too: on top of it, the gift would leave it inert.
    if (cel.gift || countUps || !giftQueue.length || $('reset').classList.contains('show')) return;
    closeShelf(); // first, so its focus return happens before the gift takes focus
    const g = giftById(giftQueue.shift());
    cel.gift = g; cel.opened = false;
    $('gift').setAttribute('aria-label', 'New gift: ' + g.name);
    $('gift').classList.remove('opened');
    $('gift').classList.add('show');
    trapFocus($('gift'));
    $('giftBox').focus();
    cel.openTimer = setTimeout(openGift, giftTiming.open); // opens itself if nobody taps it
  }
  function openGift() {
    const g = cel.gift; if (!g || cel.opened) return;
    clearTimeout(cel.openTimer);
    cel.opened = true;
    gifts.seen.add(g.id);
    if (g.scene) gifts.scene = g.scene; // and switch it on
    if (g.skin) gifts.skin = g.skin;
    saveGifts();
    renderPreview(g);
    $('gift').classList.add('opened');
    $('giftShow').focus();
    audio(); sfx.success();
    if (!reducedMotion()) {
      const r = $('giftBox').getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, 40, G.COLORS.map((c) => c.hex).concat('#fff'), 320);
    }
    cel.closeTimer = setTimeout(closeGift, giftTiming.close);
  }
  // A gift closed before it was opened stays unseen, so the 🏆 dot shows for it.
  function closeGift(quiet) {
    if (!cel.gift) return;
    clearTimeout(cel.openTimer); clearTimeout(cel.closeTimer);
    cel.gift = null;
    $('gift').classList.remove('show', 'opened');
    releaseFocus($('gift'));
    updateDot();
    if (quiet) return;
    if (giftQueue.length) cel.nextTimer = setTimeout(showNextGift, 300);
    else $('score').focus();
  }
  function renderPreview(g) {
    const el = $('giftPreview');
    el.innerHTML = '';
    if (g.skin) el.appendChild(blockThumb(g.skin, 140));
    else el.innerHTML = `<span class="thumb big sky-${g.scene}">${SKY_ICON[g.scene]}</span>`;
    $('giftEmoji').textContent = g.emoji;
    // Named for the grown-up reading along; a sky says where it shows.
    $('giftName').textContent = g.kind === 'crown' ? 'Crown and dusk sky · you found them all!'
      : g.kind === 'scene' ? `${g.name} · in ${SKY_WHERE}` : g.name;
  }
  $('giftBox').addEventListener('click', openGift);
  $('giftShow').addEventListener('click', () => closeGift());
  $('giftClose').addEventListener('click', () => closeGift());
  // Before it's opened, a stray tap beside the 🎁 does nothing; after, any tap closes it.
  $('gift').addEventListener('click', (e) => { if (e.target === $('gift') && cel.opened) closeGift(); });

  // ----- the shelf (🏆): pick a free-build sky and a block look
  // A square block in a little canvas, drawn with the given look.
  function blockThumb(skin, size) {
    const c = document.createElement('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = c.height = Math.round(size * dpr);
    c.style.width = c.style.height = size + 'px';
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    const u = size * 0.56, o = (size - u) / 2;
    drawBlock([{ x: o, y: o }, { x: o + u, y: o }, { x: o + u, y: o + u }, { x: o, y: o + u }], G.COLORS[3].hex, u, 1, x, skin);
    return c;
  }
  let shelfTimer = 0;
  function renderShelf() {
    const tile = (kind, id, name, on) =>
      `<button class="tile${on ? ' on' : ''}" data-kind="${kind}" data-id="${id}" aria-label="${name}" aria-pressed="${on}">` +
      (kind === 'scene' ? `<span class="thumb sky-${id}">${SKY_ICON[id]}</span>` : '') + '</button>';
    const shown = shownGifts(), s = Math.round(shownScore), m = G.nextMilestone(s);
    // The header: "🏆 300 → 🎁 600" over a bar, so there's something to aim for ("👑 3000" once all are found).
    $('shelfScore').textContent = `${m ? '🏆' : '👑'} ${s}`;
    $('shelfTarget').textContent = m ? `→ 🎁 ${m.to}` : '';
    $('shelfBar').hidden = !m;
    if (m) {
      $('shelfFill').style.width = (m.k * 100).toFixed(1) + '%';
      $('shelfBar').setAttribute('aria-valuenow', String(Math.round(m.k * 100)));
    }
    // Exactly one wrapped 🎁 "next" tile, in the row its gift belongs to (the crown's dusk sky
    // counts as a sky), showing its target and with its own bar; none once everything is found. No 🔒 tiles.
    const nextRow = m ? (m.gift.skin ? 'skin' : 'scene') : null;
    const nextTile = (kind) => nextRow !== kind ? '' :
      `<button class="tile wrapped" data-next="1" aria-label="Next gift at ${m.to}: a surprise ${kind === 'skin' ? 'block look' : 'sky'}">` +
      `<span class="tileNum" aria-hidden="true">${m.to}</span>🎁` +
      `<span class="tileBar" aria-hidden="true"><i style="width:${(m.k * 100).toFixed(1)}%"></i></span></button>`;
    $('skyTiles').innerHTML = scenesOf(shown).map((id) => tile('scene', id, SCENE_NAME[id], id === gifts.scene)).join('') + nextTile('scene');
    $('skinTiles').innerHTML = skinsOf(shown).map((id) => tile('skin', id, SKIN_NAME[id], id === gifts.skin)).join('') + nextTile('skin');
    for (const b of $('skinTiles').querySelectorAll('[data-kind="skin"]')) b.appendChild(blockThumb(b.dataset.id, 64));
    for (const b of document.querySelectorAll('#gifts .tile')) b.addEventListener('click', () => pickTile(b));
  }
  function pickTile(b) {
    if (b.dataset.next) { // not yet: it wiggles and its bar pulses
      b.classList.remove('wiggle'); void b.offsetWidth; b.classList.add('wiggle');
      sfx.select();
      return;
    }
    // A themed pack keeps its own scene, so a sky picked there can't show yet: 🎨 wiggles once the
    // shelf has closed, to say where it will. (In free build and other packs it shows straight away.)
    if (b.dataset.kind === 'scene' && state.mode === 'challenge' && packOf(current().pack).themed) setTimeout(nudgeFree, 400);
    gifts[b.dataset.kind] = b.dataset.id;
    saveGifts();
    sfx.color();
    for (const t of document.querySelectorAll('#gifts .tile[data-kind="' + b.dataset.kind + '"]')) {
      t.classList.toggle('on', t === b); t.setAttribute('aria-pressed', String(t === b));
    }
    clearTimeout(shelfTimer);
    shelfTimer = setTimeout(closeShelf, 400); // long enough to see the choice light up
  }
  function nudgeFree() {
    const f = $('btnFree');
    f.classList.remove('nudge'); void f.offsetWidth; f.classList.add('nudge');
    clearTimeout(nudgeFree.timer);
    nudgeFree.timer = setTimeout(() => f.classList.remove('nudge'), 1200);
  }
  function openShelf() {
    audio();
    for (const id of shownGifts()) gifts.seen.add(id); // opening the shelf clears the dot
    saveGifts(); updateDot();
    renderShelf(); renderHowPoints();
    $('howPoints').open = false; // the grown-ups part starts closed each time
    $('gifts').classList.add('show');
    $('gifts').scrollTop = 0;
    trapFocus($('gifts'));
    (document.querySelector('#gifts .tile.on') || $('giftsClose')).focus();
  }
  function closeShelf() {
    clearTimeout(shelfTimer);
    if (!$('gifts').classList.contains('show')) return;
    $('gifts').classList.remove('show');
    releaseFocus($('gifts'));
    $('score').focus();
  }
  $('score').addEventListener('click', openShelf); // a plain tap: 🏆 has no other gesture
  $('giftsClose').addEventListener('click', closeShelf);
  $('gifts').addEventListener('click', (e) => { if (e.target === $('gifts')) closeShelf(); });

  // ----- for grown-ups (bottom of the shelf): how points work, every gift, and the next one by name
  function renderHowPoints() {
    $('howGifts').innerHTML = G.GIFTS.map((g) => {
      const got = gifts.unlocked.has(g.id);
      return `<tr><td aria-label="${got ? 'Found' : 'Not yet'}">${got ? '✓' : '🎁'}</td><td class="pts">${g.at}</td>` +
        `<td>${g.emoji}</td><td>${g.name}</td></tr>`;
    }).join('');
    const m = G.nextMilestone(state.score);
    $('howNow').textContent = m ? `Now: ${state.score} 🏆. Next gift at ${m.to}: ${m.gift.emoji} ${m.gift.name}` : 'Every gift found! 👑';
  }

  // ----- reset (grown-ups, from the ❓ panel): erases the score, finished builds and gifts,
  // but keeps the free build and the welcomed flag.
  function openReset() { $('reset').classList.add('show'); trapFocus($('reset')); $('resetKeep').focus(); }
  function closeReset() { $('reset').classList.remove('show'); releaseFocus($('reset')); $('resetOpen').focus(); showNextGift(); }
  function eraseProgress() {
    for (const k of ['magnet-blocks-score', 'magnet-blocks-done', GIFTS_KEY]) drop(k);
    // Stop a win that's still counting up: its "+N"s, count-ups, encore and celebrations.
    scoreGen++; countUps = 0;
    for (const f of document.querySelectorAll('.fly')) f.remove();
    state.score = 0; state.lastGain = 0; shownScore = 0;
    doneBuilds.clear();
    giftQueue.length = 0; clearTimeout(cel.nextTimer); closeGift(true);
    if (state.won) {
      // A finished build left on the board would be scored again by the next change, so it
      // goes, along with the ➡️ and the card's won look.
      state.won = false;
      clearAll(true, state.boards.challenge);
      $('next').classList.remove('show');
      $('card').classList.remove('won');
    }
    gifts.unlocked.clear(); gifts.seen.clear(); gifts.scene = 'sunny'; gifts.skin = 'plain';
    syncScore(); updateDot(); updateGain();
  }
  $('resetOpen').addEventListener('click', openReset);
  $('resetKeep').addEventListener('click', closeReset);
  $('resetErase').addEventListener('click', () => { eraseProgress(); sfx.pop(); closeReset(); });
  $('reset').addEventListener('click', (e) => { if (e.target === $('reset')) closeReset(); });

  // Esc closes the topmost of these.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('reset').classList.contains('show')) closeReset();
    else if (cel.gift) closeGift();
    else if ($('gifts').classList.contains('show')) closeShelf();
  });

  // ---------------------------------------------------------------- rendering
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
    return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  }

  // pts: [{x,y}] screen coords. c: the canvas context (the stage unless a gift thumbnail).
  function pathOf(pts, c) {
    c = c || ctx;
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
  }

  // skin: the 🎁 block look (gifts.skin by default). Looks only add highlights on top of
  // the fill: the block's colour and outline never change, because challenges match on colour.
  function drawBlock(pts, color, unit, alpha, c, skin) {
    c = c || ctx;
    c.save();
    c.globalAlpha = alpha === undefined ? 1 : alpha;
    pathOf(pts, c);
    c.fillStyle = color; c.fill();
    c.save(); c.clip();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const g = c.createLinearGradient(0, minY, 0, maxY);
    g.addColorStop(0, 'rgba(255,255,255,.38)'); g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,.14)');
    c.fillStyle = g; c.fillRect(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4);
    drawSkin(c, skin || gifts.skin, minX, minY, maxX, maxY, c !== ctx);
    c.restore();
    pathOf(pts, c);
    c.lineJoin = 'round'; c.lineWidth = Math.max(2, unit * 0.08);
    c.strokeStyle = shade(color, -0.38); c.stroke();
    c.restore();
  }

  // ✨ a few twinkling white stars, or 🫧 a glossy bubble highlight: white, at most 30% opacity,
  // drawn inside the block's clip. still: no twinkle (reduced motion, or a thumbnail).
  const SPARKS = [[0.3, 0.32, 1], [0.68, 0.5, 0.8], [0.42, 0.74, 0.65]];
  function drawSkin(c, skin, minX, minY, maxX, maxY, still) {
    if (skin !== 'sparkle' && skin !== 'bubble') return;
    const w = maxX - minX, h = maxY - minY, a0 = c.globalAlpha, m = Math.min(w, h);
    c.fillStyle = '#fff';
    if (skin === 'bubble') {
      c.globalAlpha = a0 * 0.3;
      c.beginPath(); c.ellipse(minX + w * 0.36, minY + h * 0.34, m * 0.2, m * 0.11, -0.6, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(minX + w * 0.6, minY + h * 0.24, m * 0.06, 0, Math.PI * 2); c.fill();
    } else {
      const phase = (minX + minY) * 0.01;
      SPARKS.forEach(([fx, fy, size], i) => {
        const tw = still || motionOff ? 1 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(frameNow / 350 + i * 2.1 + phase));
        c.globalAlpha = a0 * 0.3 * tw;
        const x = minX + w * fx, y = minY + h * fy, r = m * 0.14 * size, k = r * 0.28;
        c.beginPath(); // four-point star
        c.moveTo(x, y - r); c.quadraticCurveTo(x + k, y - k, x + r, y); c.quadraticCurveTo(x + k, y + k, x, y + r);
        c.quadraticCurveTo(x - k, y + k, x - r, y); c.quadraticCurveTo(x - k, y - k, x, y - r);
        c.fill();
      });
    }
    c.globalAlpha = a0;
  }

  function popScale(p, now) {
    if (!p.pop) return 1;
    const k = (now - p.pop) / 350;
    return k >= 1 ? 1 : 1 + 0.16 * Math.sin(k * Math.PI) * (1 - k);
  }

  function drawPiece(p, now) {
    const d = state.drag;
    let k = popScale(p, now);
    const armed = d && d.piece === p && d.binArmed; // shrinks "into" the armed bin
    if (armed) k *= 0.6;
    const off = fallOffset(p, now) || { x: 0, y: 0 };
    const poly = G.worldPolygon(p).map((v) => w2s(p.x + (v.x - p.x) * k + off.x, p.y + (v.y - p.y) * k + off.y));
    if (state.selected === p) {
      ctx.save();
      pathOf(poly); ctx.lineJoin = 'round';
      ctx.lineWidth = view.s * 0.22; ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = view.s * 0.5; ctx.stroke();
      ctx.restore();
    }
    drawBlock(poly, p.color, view.s, armed ? 0.7 : 1);
  }

  const theme = () => (state.mode === 'challenge' ? current().pack : 'toybox');
  // What's drawn behind the board: a themed pack's challenges keep its own scene; free build and
  // the other packs show the sky chosen on the 🏆 shelf (the outline is drawn to read on each).
  const sky = () => (state.mode === 'challenge' && packOf(theme()).themed ? theme() : gifts.scene);
  function drawBackground(now) {
    const draw = {
      halloween: drawSpookyBackground, dusk: drawSpookyBackground,
      night: drawNightBackground, sea: drawSeaBackground, space: drawSpaceBackground,
    }[sky()] || drawSunnyBackground;
    draw(now);
  }
  function drawSunnyBackground(now) {
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

  // 🎃 pack: a dusk sky, a big moon, bats flitting by and pumpkins in the grass.
  function drawSpookyBackground(now) {
    const g = ctx.createLinearGradient(0, 0, 0, view.groundY);
    g.addColorStop(0, '#2d1b4e'); g.addColorStop(0.65, '#7a3f8f'); g.addColorStop(1, '#f39a52');
    ctx.fillStyle = g; ctx.fillRect(0, 0, view.W, view.H);
    const mr = Math.min(46, view.W * 0.08), mx = view.W * 0.85, my = view.groundY * 0.22;
    ctx.save();
    ctx.shadowColor = '#fff3c4'; ctx.shadowBlur = 30;
    ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, 7); ctx.fill();
    ctx.restore();
    ctx.font = '26px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
      const bx = ((now / 45 + i * view.W * 0.37) % (view.W + 120)) - 60;
      const by = view.groundY * (0.3 + i * 0.16) + Math.sin(now / 300 + i * 2) * 12;
      ctx.fillText('🦇', bx, by);
    }
    ctx.fillStyle = '#3f7a3a'; ctx.fillRect(0, view.groundY, view.W, view.H - view.groundY);
    ctx.fillStyle = '#2f5e2b'; ctx.fillRect(0, view.groundY, view.W, 4);
    ctx.font = `${GRASS + 6}px serif`; ctx.textBaseline = 'bottom';
    for (const fx of [0.06, 0.94]) ctx.fillText('🎃', view.W * fx, view.groundY + GRASS - 2);
  }

  // ----- 🎁 free-build skies. Twinkles, fish and bubbles hold still under reduced motion.
  const rnd = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }; // stable "random"
  function skyGradient(top, bottom) {
    const g = ctx.createLinearGradient(0, 0, 0, view.groundY);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, view.W, view.H);
  }
  function drawGround(fill, edge) {
    ctx.fillStyle = fill; ctx.fillRect(0, view.groundY, view.W, view.H - view.groundY);
    ctx.fillStyle = edge; ctx.fillRect(0, view.groundY, view.W, 4);
  }
  // Where the moon or planet goes: top right, but below the bar and palette (on a phone
  // they wrap to three rows and would hide it).
  const skyMark = () => ({ x: view.W * 0.84, y: Math.max(view.groundY * 0.22, view.topReserve + 44) });
  function drawStars(now, n, depth) {
    ctx.fillStyle = '#fff';
    for (let i = 0; i < n; i++) {
      ctx.globalAlpha = motionOff ? 0.8 : 0.4 + 0.6 * Math.abs(Math.sin(now / 700 + i * 1.7));
      ctx.beginPath(); ctx.arc(rnd(i) * view.W, rnd(i + 100) * view.groundY * depth, 0.8 + rnd(i + 200) * 1.6, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // 🌙 night: deep blue, twinkling stars and a glowing moon.
  function drawNightBackground(now) {
    skyGradient('#0d1b3e', '#34508f');
    drawStars(now, 45, 0.8);
    ctx.save();
    ctx.shadowColor = '#fff8dc'; ctx.shadowBlur = 24; ctx.fillStyle = '#fff8dc';
    const m = skyMark();
    ctx.beginPath(); ctx.arc(m.x, m.y, Math.min(40, view.W * 0.07), 0, 7); ctx.fill();
    ctx.restore();
    drawGround('#2e6b4a', '#22553a');
  }
  // 🌊 underwater: fish swimming by, bubbles rising, a sandy floor.
  function drawSeaBackground(now) {
    const t = motionOff ? 0 : now;
    skyGradient('#5cc8f0', '#1260a8');
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) {
      const x = rnd(i) * view.W + Math.sin(t / 900 + i) * 6;
      const y = view.groundY - ((t / 30 + rnd(i + 50) * view.groundY) % view.groundY);
      ctx.beginPath(); ctx.arc(x, y, 2 + rnd(i + 70) * 4, 0, 7); ctx.fill(); ctx.stroke();
    }
    ctx.font = '28px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000'; // opaque: a see-through fill would fade the emoji too
    ['🐟', '🐠', '🐡'].forEach((f, i) => {
      const x = view.W + 60 - ((t / 40 + i * view.W * 0.4) % (view.W + 120)); // swims right to left, head first
      ctx.fillText(f, x, view.groundY * (0.3 + i * 0.18) + Math.sin(t / 500 + i * 2) * 8);
    });
    drawGround('#ecd08a', '#d3b064');
    ctx.font = `${GRASS + 4}px serif`; ctx.textBaseline = 'bottom';
    ctx.fillText('🐚', view.W * 0.06, view.groundY + GRASS - 1);
    ctx.fillText('🦀', view.W * 0.94, view.groundY + GRASS - 1);
  }
  // 🚀 space: a starfield, a ringed planet and a grey moon surface.
  function drawSpaceBackground(now) {
    skyGradient('#070720', '#2a1b5e');
    drawStars(now, 70, 1);
    ctx.font = `${Math.round(Math.min(56, view.W * 0.12))}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText('🪐', skyMark().x, skyMark().y);
    drawGround('#8f8aa8', '#6f6a8a');
    ctx.fillStyle = '#7a7594';
    for (const fx of [0.12, 0.47, 0.8]) { ctx.beginPath(); ctx.ellipse(view.W * fx, view.groundY + 10, 16, 4, 0, 0, 7); ctx.fill(); }
  }

  function trayGeom() {
    const n = G.SHAPE_ORDER.length, slotW = view.W / n;
    return { n, slotW, scale: Math.min(slotW / 2.5, (view.trayH - 30) / 1.2, 60), cy: view.H - view.trayH / 2 + 4 };
  }

  function drawTray() {
    const t = trayGeom(), top = view.H - view.trayH;
    ctx.fillStyle = '#3b2f63';
    ctx.beginPath(); ctx.roundRect(-10, top, view.W + 20, view.trayH + 10, 26); ctx.fill();
    ctx.fillStyle = '#4d4080';
    for (let i = 0; i < t.n; i++) {
      ctx.beginPath(); ctx.roundRect(i * t.slotW + 6, top + 10, t.slotW - 12, view.trayH - 18, 18); ctx.fill();
    }
    G.SHAPE_ORDER.forEach((key, i) => {
      const sh = G.SHAPES[key], cx = (i + 0.5) * t.slotW;
      const pts = sh.poly.map((v) => ({ x: cx + v[0] * t.scale, y: t.cy - v[1] * t.scale }));
      drawBlock(pts, state.color, t.scale);
    });
  }

  // How the outline is drawn on what's behind it (sky()); anything unlisted gets the sunny grey.
  // On a dark sky the grey vanishes, so it gets a light fill and a solid white edge; a sky with
  // light parts too (dusk's orange glow, the sea's pale top) adds a dark halo outside the white,
  // so one of the two always stands out. (Kept deliberately small: a full per-theme map is #33.)
  const DARK_OUTLINE = { fill: 'rgba(255,255,255,.28)', edge: '#fff' };
  const HALO_OUTLINE = { fill: 'rgba(255,255,255,.28)', edge: '#fff', halo: 'rgba(30,16,60,.8)' };
  const OUTLINE = { sunny: { fill: 'rgba(59,47,99,.2)' }, night: DARK_OUTLINE, space: DARK_OUTLINE,
    sea: HALO_OUTLINE, dusk: HALO_OUTLINE, halloween: HALO_OUTLINE };
  // One plain outline of the build (no colours, no piece lines).
  function drawTarget() {
    const ss = slots(); if (!ss.length) return;
    const o = OUTLINE[sky()] || OUTLINE.sunny;
    const addSlots = () => {
      for (const sl of ss) {
        G.worldPolygon(sl).forEach((v, i) => { const q = w2s(v.x, v.y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
        ctx.closePath();
      }
    };
    ctx.beginPath(); addSlots();
    ctx.fillStyle = o.fill; ctx.fill();
    if (!o.edge) return;
    // Edge round the outside only: clip to everything outside the build (the screen with the
    // slots cut out, even-odd), so the lines between pieces stay hidden. Strokes are centred on
    // the path, so half of each width shows: white 0-2px out, then the halo 2-4px out.
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, view.W, view.H); addSlots(); ctx.clip('evenodd');
    ctx.beginPath(); addSlots();
    ctx.lineJoin = 'round';
    if (o.halo) { ctx.lineWidth = 8; ctx.strokeStyle = o.halo; ctx.stroke(); }
    ctx.lineWidth = 4; ctx.strokeStyle = o.edge; ctx.stroke();
    ctx.restore();
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
    ctx.strokeStyle = '#8e4fd0'; ctx.fillStyle = '#8e4fd0'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    const r = h.r * 0.5, a0 = -Math.PI * 0.35, a1 = Math.PI * 1.25;
    ctx.beginPath(); ctx.arc(0, 0, r, a0, a1); ctx.stroke();
    // arrowhead at the start of the arc, pointing anticlockwise like the turn
    ctx.translate(Math.cos(a0) * r, Math.sin(a0) * r); ctx.rotate(a0);
    ctx.beginPath(); ctx.moveTo(0, -4.5); ctx.lineTo(5, 2.5); ctx.lineTo(-5, 2.5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // The bin: a white disc with a purple bin; armed, it grows, turns red and opens its lid.
  function drawBin(now) {
    if (!binVisible(now)) return;
    const d = state.drag, b = binGeom(), still = reducedMotion();
    if (d) updateBinArm(d, now);
    const armed = !!(d && d.binArmed);
    // Pops in when a drag starts; after a delete it simply stays, showing the ↩️ badge.
    const pop = still || !d ? 1 : Math.min(1, (now - d.binShownAt) / BIN_POP);
    const grow = 1 - (1 - pop) * (1 - pop); // ease-out pop-in
    const k = grow * (armed ? 1.2 : 1);
    if (k <= 0.01) return;
    // How far the lid is open (0..1): animated over ~120ms, or snapped open for reduced motion.
    const lid = !armed ? 0 : still ? 1 : Math.min(1, (now - d.binSince - BIN_DWELL) / 120);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(k, k);
    if (armed && !still) ctx.rotate(Math.sin(now / 60) * 0.08); // wiggle
    const R = b.R, ink = armed ? '#fff' : '#3b2f63';
    ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
    ctx.fillStyle = armed ? '#d9534f' : '#fff';
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = 'transparent';
    // can
    const u = R / 32;
    ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = 3 * u; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-11 * u, -6 * u); ctx.lineTo(11 * u, -6 * u); ctx.lineTo(8.5 * u, 15 * u); ctx.lineTo(-8.5 * u, 15 * u);
    ctx.closePath(); ctx.stroke();
    for (const x of [-4.5, 0, 4.5]) { ctx.beginPath(); ctx.moveTo(x * u, -1 * u); ctx.lineTo(x * 0.8 * u, 10 * u); ctx.stroke(); }
    // lid, hinged at its right end
    ctx.save();
    ctx.translate(13 * u, -10 * u); ctx.rotate(-lid * 0.9);
    ctx.fillRect(-26 * u, -1.5 * u, 26 * u, 3 * u);
    ctx.fillRect(-16 * u, -5 * u, 6 * u, 4 * u);
    ctx.restore();
    ctx.restore();
    if (!d && binUndoable(now)) { // ↩️ badge: tap the bin to get the block back
      const bx = b.x - b.R * 0.75, by = b.y + b.R * 0.75, br = Math.max(13, b.R * 0.48);
      ctx.save();
      ctx.fillStyle = '#ffe27a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = `${Math.round(br * 1.25)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('↩️', bx, by + 1);
      ctx.restore();
    }
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
  let frameNow = last, motionOff = false; // read by the sky and block-look drawing
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    frameNow = now; motionOff = reducedMotion(); state.landed = false;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawBackground(now);
    drawTarget();
    const d = state.drag, held = d && d.piece;
    for (const p of state.pieces) if (p !== held) drawPiece(p, now);
    drawGlow(now);
    drawTray();
    drawBin(now);
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
  syncScore();
  if (state.score > 0) saveGifts(); // writes back anything the score unlocked (e.g. a migration)
  updateDot();
  { const saved = load(FREE_KEY, []); if (Array.isArray(saved)) restore(saved, state.boards.free); }
  layout();
  // A free build saved before blocks stopped overlapping can have blocks hidden under
  // each other, or floating: pull them apart and let them settle.
  G.separate(state.boards.free, viewBounds()); settle(state.boards.free);
  save(FREE_KEY, snapshot(state.boards.free));
  // First visit: a blank board and the welcome. After that: straight into challenges.
  if (load('magnet-blocks-welcomed', false)) { modeChosen = true; setMode('challenge'); } else showWelcome();
  requestAnimationFrame(frame);

  // Small hook for the Playwright smoke test and debugging.
  window.magnetGame = {
    state, view, w2s, s2w, setMode, rotateHandle, slots, theme, sky, gifts, giftTiming,
    binPoint() { const b = binGeom(); return { x: b.x, y: b.y }; },
    trayPoint(shape) {
      const t = trayGeom();
      return { x: (G.SHAPE_ORDER.indexOf(shape) + 0.5) * t.slotW, y: t.cy };
    },
  };
})();
