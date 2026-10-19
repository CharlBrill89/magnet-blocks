'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geometry.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const piece = (shape, x, y, rot = 0, id = shape + x + y) => ({ id, shape, color: '#000', x, y, rot });

test('shape sizes and areas match the box', () => {
  near(G.polygonArea(G.SHAPES.square.poly), 1);
  near(G.polygonArea(G.SHAPES.triangle.poly), 0.5);
  near(G.polygonArea(G.SHAPES.trapezoid.poly), 1.5);
  near(G.polygonArea(G.SHAPES.quarter.poly), Math.PI / 4, 0.01);
  near(G.polygonArea(G.SHAPES.arch.poly), 2 - Math.PI / 8, 0.01);
  assert.deepEqual([G.SHAPES.arch.width, G.SHAPES.arch.height], [2, 1]);
  assert.deepEqual([G.SHAPES.trapezoid.width, G.SHAPES.trapezoid.height], [2, 1]);
  assert.deepEqual([G.SHAPES.quarter.width, G.SHAPES.quarter.height], [1, 1]);
  const counts = G.SHAPE_ORDER.map((k) => G.SHAPES[k].count).sort();
  assert.deepEqual(counts, [1, 2, 3, 4, 5]);
  assert.equal(G.COLORS.length, 7);
});

test('rotation turns 90° CCW and bounds swap', () => {
  const p = piece('arch', 0, 5, 1);
  const b = G.pieceBounds(p);
  near(b.maxX - b.minX, 1);
  near(b.maxY - b.minY, 2);
  assert.deepEqual(G.rotate(1, 0, 1), [-0, 1]);
  const q = piece('trapezoid', 0, 5, 2); // upside down: wide edge on top
  const poly = G.worldPolygon(q);
  const top = Math.max(...poly.map((v) => v.y));
  near(poly.filter((v) => Math.abs(v.y - top) < 1e-9).length, 2);
});

test('magnet snap aligns neighbouring squares', () => {
  const a = piece('square', 0, 0.5);
  const b = piece('square', 1.15, 0.62, 0, 'b');
  const r = G.snapPiece(b, [a]);
  assert.equal(r.kind, 'magnet');
  near(r.x, 1);
  near(r.y, 0.5);
  assert.ok(r.contact);
});

test('stacking snaps on top and chooses nearest pair', () => {
  const a = piece('square', 0, 0.5);
  const b = piece('square', 0.1, 1.62, 0, 'b');
  const r = G.snapPiece(b, [a]);
  near(r.x, 0);
  near(r.y, 1.5);
});

test('nothing in range: piece stays put in the air', () => {
  const a = piece('square', 0, 0.5);
  const b = piece('square', 4, 4, 0, 'b');
  const r = G.snapPiece(b, [a]);
  assert.equal(r.kind, 'none');
  assert.equal(r.x, 4);
  assert.equal(r.y, 4);
});

test('ground snap and never sinking', () => {
  const lone = piece('square', 3, 0.7, 0, 'l');
  let r = G.snapPiece(lone, []);
  assert.equal(r.kind, 'ground');
  near(r.y, 0.5);
  const sunk = piece('triangle', 0, -2, 0, 's');
  r = G.snapPiece(sunk, []);
  near(G.pieceBounds({ ...sunk, x: r.x, y: r.y }).minY, 0);
});

test('a magnet snap that would sink the piece is rejected in favour of the ground', () => {
  const base = piece('square', 0, 0.5);
  // Dragged square hangs slightly below ground next to the base; the closest
  // pair would pull it down into the ground, so it rests on y=0 and slides.
  const d = piece('square', 1.1, 0.35, 0, 'd');
  const r = G.snapPiece(d, [base]);
  const minY = G.pieceBounds({ ...d, x: r.x, y: r.y }).minY;
  assert.ok(minY >= -1e-6);
  near(r.x, 1);
});

test('rotated arch sits on the ground with feet down', () => {
  const arch = piece('arch', 0, 0.1, 0);
  const r = G.snapPiece(arch, []);
  near(r.y, 0.5);
});

test('connectivity needs coincident snap points', () => {
  const a = piece('square', 0, 0.5, 0, 'a');
  const b = piece('square', 1, 0.5, 0, 'b');
  const c = piece('square', 5, 0.5, 0, 'c');
  const d = piece('square', 1.5, 1.5, 0, 'd'); // shares corner/mid points with b
  const groups = G.components([a, b, c, d]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.length).sort(), [1, 3]);
  assert.equal(G.components([]).length, 0);
});

test('hit testing prefers the topmost piece and honours margin', () => {
  const a = piece('square', 0, 0.5, 0, 'a');
  const b = piece('square', 0.2, 0.5, 0, 'b');
  assert.equal(G.hitTest([a, b], 0.1, 0.5, 0).id, 'b');
  assert.equal(G.hitTest([a, b], 2, 0.5, 0), null);
  assert.equal(G.hitTest([a], 0.6, 0.5, 0.2).id, 'a');
  // the arch's cut-out is not solid
  const arch = piece('arch', 0, 0.5, 0, 'arch');
  assert.equal(G.hitTest([arch], 0, 0.1, 0), null);
});

const hex = (name) => G.COLOR_HEX[name];
const colored = (shape, color, x, y, id) => ({ id, shape, color: hex(color), x, y, rot: 0 });

test('challenges: complete once one snapped structure has the shapes in the right colours', () => {
  const tower = G.CHALLENGES.find((c) => c.id === 'tower');
  // 2 purple + 2 teal squares + gold triangle
  const stack = ['purple', 'purple', 'teal', 'teal'].map((c, i) => colored('square', c, 0, i + 0.5, 's' + i));
  stack.push(colored('triangle', 'gold', 0, 4.5, 't'));
  assert.equal(G.challengeProgress(stack, tower).done, true);
  // split the stack: no longer one structure
  const split = stack.slice();
  split[2] = colored('square', 'teal', 6, 2.5, 'far');
  const prog = G.challengeProgress(split, tower);
  assert.equal(prog.done, false);
  // extras and strays elsewhere don't matter
  const extra = stack.concat([colored('arch', 'red', 8, 0.5, 'stray')]);
  assert.equal(G.challengeProgress(extra, tower).done, true);
  assert.equal(G.challengeProgress([], tower).done, false);
  assert.deepEqual(G.challengeProgress([], tower).have, [0, 0, 0]);
});

test('challenges: wrong colours do not count', () => {
  const tower = G.CHALLENGES.find((c) => c.id === 'tower');
  const stack = ['purple', 'purple', 'teal', 'blue'].map((c, i) => colored('square', c, 0, i + 0.5, 's' + i));
  stack.push(colored('triangle', 'gold', 0, 4.5, 't'));
  const prog = G.challengeProgress(stack, tower);
  assert.equal(prog.done, false);
  assert.deepEqual(prog.have, [2, 1, 1]);
  stack[3].color = hex('teal'); // recolour fixes it
  assert.equal(G.challengeProgress(stack, tower).done, true);
});

test('challenges: the right pieces in the wrong arrangement do not count', () => {
  const tower = G.CHALLENGES.find((c) => c.id === 'tower');
  // all five pieces, snapped side by side on the ground instead of stacked
  const row = ['purple', 'purple', 'teal', 'teal'].map((c, i) => colored('square', c, i, 0.5, 's' + i));
  row.push(colored('triangle', 'gold', 4, 0.5, 't'));
  assert.equal(G.components(row).length, 1);
  const prog = G.challengeProgress(row, tower);
  assert.equal(prog.done, false);
  assert.deepEqual(prog.have, [1, 0, 0]); // only pieces in the right place get ticked
  // stack the first three properly: those three now count
  const part = ['purple', 'purple', 'teal'].map((c, i) => colored('square', c, 0, i + 0.5, 'p' + i));
  part.push(colored('square', 'teal', 1, 0.5, 'p3'), colored('triangle', 'gold', 2, 0.5, 'pt'));
  assert.deepEqual(G.challengeProgress(part, tower).have, [2, 1, 0]);
  // the build can stand anywhere on the board
  const moved = ['purple', 'purple', 'teal', 'teal'].map((c, i) => colored('square', c, 7, i + 0.5, 'm' + i));
  moved.push(colored('triangle', 'gold', 7, 4.5, 'mt'));
  assert.equal(G.challengeProgress(moved, tower).done, true);
  // a quarter turned the wrong way is not in the right place
  const ghost = G.CHALLENGES.find((c) => c.id === 'ghost');
  const slots = G.targetSlots(ghost);
  assert.equal(G.challengeProgress(slots, ghost).done, true);
  const wrong = slots.map((p) => Object.assign({}, p));
  wrong[3].rot = 0;
  assert.equal(G.challengeProgress(wrong, ghost).done, false);
});

test('every challenge fits in the box and uses real colours', () => {
  assert.equal(G.CHALLENGES.filter((c) => c.pack === 'toybox').length, 10);
  assert.ok(G.CHALLENGES.filter((c) => c.pack === 'halloween').length >= 6);
  assert.equal(new Set(G.CHALLENGES.map((c) => c.id)).size, G.CHALLENGES.length, 'ids are unique');
  for (const ch of G.CHALLENGES) {
    assert.ok(G.PACKS.some((p) => p.id === ch.pack), ch.id + ' pack');
    const perShape = {};
    for (const r of ch.need) {
      assert.ok(G.SHAPES[r.shape], ch.id + ' ' + r.shape);
      assert.ok(hex(r.color), ch.id + ' ' + r.color);
      assert.ok(r.n > 0);
      perShape[r.shape] = (perShape[r.shape] || 0) + r.n;
    }
    for (const [shape, n] of Object.entries(perShape)) assert.ok(n <= G.SHAPES[shape].count, ch.id + ' ' + shape);
  }
});

test('every target layout is one grounded, non-overlapping structure that fits the view', () => {
  for (const ch of G.CHALLENGES) {
    const slots = G.targetSlots(ch);
    assert.equal(G.components(slots).length, 1, ch.id + ' is connected');
    const b = slots.map((p) => G.pieceBounds(p));
    near(Math.min(...b.map((q) => q.minY)), 0);
    const minX = Math.min(...b.map((q) => q.minX)), maxX = Math.max(...b.map((q) => q.maxX));
    near(minX + maxX, 0); // centred
    assert.ok(maxX - minX <= 8, ch.id + ' fits');
    for (const a of slots) for (const o of slots) {
      if (a !== o) assert.ok(!G.pointInPolygon(a.x, a.y, G.worldPolygon(o)), ch.id + ' overlap');
    }
    // building the layout exactly completes the challenge
    assert.equal(G.challengeProgress(slots, ch).done, true, ch.id);
  }
});

test('needs are derived from the layout', () => {
  assert.deepEqual(G.needFromLayout([['square', 'red'], ['triangle', 'red'], ['square', 'red']]),
    [{ shape: 'square', color: 'red', n: 2 }, { shape: 'triangle', color: 'red', n: 1 }]);
});

test('challenge score: 10 per piece × tier, bonus the first time', () => {
  const rocket = G.CHALLENGES.find((c) => c.id === 'rocket'); // 5 pieces, easy
  assert.equal(rocket.tier, 1);
  assert.equal(G.challengeScore(rocket, false), 50);
  assert.equal(G.challengeScore(rocket, true), 100);
  const horse = G.CHALLENGES.find((c) => c.id === 'horse'); // 6 pieces, hard
  assert.equal(horse.tier, 3);
  assert.equal(G.challengeScore(horse, false), 180);
});

test('tiers: turned pieces and more kinds of shape make a build harder', () => {
  assert.equal(G.tierOf([['square', 'red', 0, 0.5, 0], ['square', 'red', 0, 1.5, 0]]), 1);
  assert.ok(G.complexity([['quarter', 'red', 0, 0.5, 1]]) > G.complexity([['quarter', 'red', 0, 0.5, 0]]));
  for (const t of [1, 2, 3]) assert.ok(G.CHALLENGES.some((c) => c.tier === t && c.pack === 'toybox'), 'toybox tier ' + t);
});

test('each pack runs from easiest to hardest, and harder builds score more', () => {
  for (const pack of G.PACKS) {
    const path = G.CHALLENGES.filter((c) => c.pack === pack.id);
    for (let i = 1; i < path.length; i++) {
      assert.ok(path[i].complexity >= path[i - 1].complexity, pack.id + ' sorted');
      assert.ok(path[i].tier >= path[i - 1].tier, pack.id + ' tiers rise');
    }
    const first = path[0], last = path[path.length - 1];
    assert.ok(G.challengeScore(last, 1, false) > G.challengeScore(first, 1, false), pack.id + ' scores rise');
  }
  // packs are contiguous in CHALLENGES
  const order = G.CHALLENGES.map((c) => c.pack).filter((p, i, a) => p !== a[i - 1]);
  assert.deepEqual(order, G.PACKS.map((p) => p.id));
});

test('next goes along the pack path to the next unfinished build', () => {
  const idx = (id) => G.CHALLENGES.findIndex((c) => c.id === id);
  const toy = G.CHALLENGES.filter((c) => c.pack === 'toybox');
  const first = idx(toy[0].id), second = idx(toy[1].id), third = idx(toy[2].id);
  assert.equal(G.nextChallenge(first, new Set()), second);
  assert.equal(G.nextChallenge(first, new Set([toy[0].id, toy[1].id])), third);   // skips finished ones
  const lastToy = idx(toy[toy.length - 1].id);
  assert.equal(G.nextChallenge(lastToy, new Set([toy[toy.length - 1].id])), first); // wraps within the pack
  assert.equal(G.CHALLENGES[G.nextChallenge(lastToy, new Set())].pack, 'toybox');
  // everything finished: just the next one along
  assert.equal(G.nextChallenge(first, new Set(toy.map((c) => c.id))), second);
});
