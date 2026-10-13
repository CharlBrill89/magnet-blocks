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

test('challenges: complete once one snapped structure has the counts', () => {
  const tower = G.CHALLENGES.find((c) => c.id === 'tower');
  const stack = [0, 1, 2, 3].map((i) => piece('square', 0, i + 0.5, 0, 's' + i));
  stack.push(piece('triangle', 0, 4.5, 0, 't'));
  assert.equal(G.challengeProgress(stack, tower).done, true);
  // split the stack: no longer one structure
  const split = stack.slice();
  split[2] = piece('square', 6, 2.5, 0, 'far');
  const prog = G.challengeProgress(split, tower);
  assert.equal(prog.done, false);
  // extras and strays elsewhere don't matter
  const extra = stack.concat([piece('arch', 8, 0.5, 0, 'stray')]);
  assert.equal(G.challengeProgress(extra, tower).done, true);
  assert.equal(G.challengeProgress([], tower).done, false);
});

test('every challenge fits in the box', () => {
  assert.equal(G.CHALLENGES.length, 10);
  for (const ch of G.CHALLENGES) {
    for (const [shape, n] of Object.entries(ch.need)) assert.ok(n <= G.SHAPES[shape].count, ch.id + shape);
  }
});
