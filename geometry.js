/*
 * Magnet Blocks – pure geometry, snapping and challenge logic.
 *
 * No DOM, no canvas, no globals: everything here runs in Node (see tests/) and
 * in the browser (exposed as window.MagnetGeometry).
 *
 * World units: the square is 1x1, the ground is the line y = 0, +y is up.
 * A piece is { id, shape, color, x, y, rot }: (x, y) is the world position of
 * the centre of the shape's bounding box, rot is the number of 90° CCW turns.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MagnetGeometry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-6;
  /** Max distance (world units) at which two snap points pull together. */
  const SNAP_THRESHOLD = 0.3;
  /** Snap points closer than this count as "touching" (pieces are connected). */
  const CONTACT_EPS = 0.06;

  function arc(cx, cy, r, a0, a1, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  const S = Math.SQRT1_2;

  // Outline (CCW, curves sampled) and snap points (vertices + edge midpoints,
  // plus unit-spaced points along the 2-wide edges) in local coordinates.
  const RAW_SHAPES = {
    square: {
      count: 5,
      poly: [[0, 0], [1, 0], [1, 1], [0, 1]],
      snap: [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]],
    },
    triangle: {
      count: 3,
      poly: [[0, 0], [1, 0], [0.5, 1]],
      snap: [[0, 0], [0.5, 0], [1, 0], [0.75, 0.5], [0.5, 1], [0.25, 0.5]],
    },
    quarter: {
      count: 4,
      poly: [[0, 0]].concat(arc(0, 0, 1, 0, Math.PI / 2, 18)),
      snap: [[0, 0], [0.5, 0], [1, 0], [S, S], [0, 1], [0, 0.5]],
    },
    trapezoid: {
      count: 1,
      poly: [[0, 0], [2, 0], [1.5, 1], [0.5, 1]],
      snap: [[0, 0], [0.5, 0], [1, 0], [1.5, 0], [2, 0], [1.75, 0.5],
        [1.5, 1], [1, 1], [0.5, 1], [0.25, 0.5]],
    },
    // 2 wide, 1 tall, with a semicircle (radius 0.5) cut out of the bottom.
    arch: {
      count: 2,
      poly: [[0, 0]].concat(arc(1, 0, 0.5, Math.PI, 0, 16), [[2, 0], [2, 1], [0, 1]]),
      snap: [[0, 0], [0.5, 0], [1, 0.5], [1.5, 0], [2, 0], [2, 0.5],
        [2, 1], [1.5, 1], [1, 1], [0.5, 1], [0, 1], [0, 0.5]],
    },
  };

  const SHAPE_ORDER = ['square', 'triangle', 'quarter', 'trapezoid', 'arch'];

  const SHAPES = {};
  for (const key of SHAPE_ORDER) {
    const raw = RAW_SHAPES[key];
    const xs = raw.poly.map((p) => p[0]);
    const ys = raw.poly.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const recenter = (pts) => pts.map((p) => [p[0] - cx, p[1] - cy]);
    SHAPES[key] = {
      key,
      count: raw.count,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      poly: recenter(raw.poly),
      snap: recenter(raw.snap),
    };
  }

  const COLORS = [
    { name: 'gold', hex: '#f6b800' },
    { name: 'purple', hex: '#8e4fd0' },
    { name: 'orange', hex: '#ff7a1a' },
    { name: 'blue', hex: '#2f7bea' },
    { name: 'red', hex: '#e5393b' },
    { name: 'green', hex: '#2fb65a' },
    { name: 'teal', hex: '#17b5b0' },
  ];

  // Builds come in themed packs. Each is drawn as a target layout:
  // [shape, colour, x, y, rot] with (x, y) the piece centre, ground at y = 0.
  // The required counts (`need`) are derived from the layout, and per shape
  // they never exceed the pieces in the box.
  const PACKS = [
    { id: 'toybox', emoji: '🧸', name: 'Toy Box' },       // the 10 builds pictured on the box
    { id: 'halloween', emoji: '🎃', name: 'Halloween' },
  ];
  const BUILDS = [
    { id: 'rocket', pack: 'toybox', emoji: '🚀', name: 'Rocket', layout: [
      ['square', 'blue', 0, 0.5, 0], ['square', 'blue', 0, 1.5, 0], ['triangle', 'red', 0, 2.5, 0],
      ['triangle', 'orange', -1, 0.5, 0], ['triangle', 'orange', 1, 0.5, 0]] },
    { id: 'tower', pack: 'toybox', emoji: '🗼', name: 'Tower', layout: [
      ['square', 'purple', 0, 0.5, 0], ['square', 'purple', 0, 1.5, 0], ['square', 'teal', 0, 2.5, 0],
      ['square', 'teal', 0, 3.5, 0], ['triangle', 'gold', 0, 4.5, 0]] },
    { id: 'castle', pack: 'toybox', emoji: '🏰', name: 'Castle', layout: [
      ['arch', 'red', 0, 0.5, 0],
      ['square', 'gold', -1.5, 0.5, 0], ['square', 'gold', -1.5, 1.5, 0],
      ['square', 'gold', 1.5, 0.5, 0], ['square', 'gold', 1.5, 1.5, 0],
      ['triangle', 'purple', -1.5, 2.5, 0], ['triangle', 'purple', 1.5, 2.5, 0]] },
    { id: 'robot', pack: 'toybox', emoji: '🤖', name: 'Robot', layout: [
      ['square', 'teal', -0.5, 0.5, 0], ['square', 'teal', 0.5, 0.5, 0],     // legs
      ['trapezoid', 'blue', 0, 1.5, 2],                                     // body
      ['square', 'teal', -1.5, 1.5, 0], ['square', 'teal', 1.5, 1.5, 0],     // arms
      ['square', 'gold', 0, 2.5, 0]] },                                     // head
    { id: 'horse', pack: 'toybox', emoji: '🐴', name: 'Horse', layout: [
      ['arch', 'orange', 0, 0.5, 0],                                        // body + legs
      ['square', 'orange', 0.5, 1.5, 0], ['square', 'orange', 0.5, 2.5, 0], // neck + head
      ['quarter', 'orange', 1.5, 2.5, 3],                                   // muzzle
      ['quarter', 'orange', -1.5, 1.5, 1],                                  // tail
      ['triangle', 'red', 0.5, 3.5, 0]] },                                  // ear
    { id: 'dome', pack: 'toybox', emoji: '🏠', name: 'Dome House', layout: [
      ['square', 'gold', -0.5, 0.5, 0], ['square', 'gold', 0.5, 0.5, 0],
      ['quarter', 'red', -0.5, 1.5, 1], ['quarter', 'red', 0.5, 1.5, 0],    // dome
      ['quarter', 'red', -1.5, 0.5, 1], ['quarter', 'red', 1.5, 0.5, 0]] }, // rounded sides
    { id: 'guitar', pack: 'toybox', emoji: '🎸', name: 'Guitar', layout: [
      ['quarter', 'purple', -0.5, 0.5, 2], ['quarter', 'purple', 0.5, 0.5, 3], // round bottom
      ['arch', 'purple', 0, 1.5, 0],                                        // body + sound hole
      ['square', 'green', 0, 2.5, 0], ['square', 'green', 0, 3.5, 0]] },    // neck
    { id: 'boat', pack: 'toybox', emoji: '⛵', name: 'Boat', layout: [
      ['trapezoid', 'blue', 0, 0.5, 2],                                     // hull
      ['square', 'green', -0.5, 1.5, 0],                                    // mast
      ['triangle', 'gold', 0.5, 1.5, 0],                                    // sail
      ['triangle', 'red', -0.5, 2.5, 0]] },                                 // flag
    { id: 'bridge', pack: 'toybox', emoji: '🌉', name: 'Bridge', layout: [
      ['arch', 'green', -1, 0.5, 0], ['arch', 'green', 1, 0.5, 0],
      ['square', 'teal', -1.5, 1.5, 0], ['square', 'teal', 1.5, 1.5, 0]] },
    { id: 'tree', pack: 'toybox', emoji: '🌲', name: 'Tree', layout: [
      ['square', 'orange', 0, 0.5, 0],                                      // trunk
      ['triangle', 'green', -0.5, 1.5, 0], ['triangle', 'green', 0.5, 1.5, 0],
      ['triangle', 'green', 0, 2.5, 0]] },

    { id: 'candycorn', pack: 'halloween', emoji: '🍬', name: 'Candy Corn', layout: [
      ['trapezoid', 'gold', 0, 0.5, 0], ['triangle', 'orange', 0, 1.5, 0]] },
    { id: 'hat', pack: 'halloween', emoji: '🧙', name: 'Witch Hat', layout: [
      ['square', 'purple', -1, 0.5, 0], ['square', 'purple', 0, 0.5, 0],     // brim
      ['square', 'purple', 1, 0.5, 0],
      ['trapezoid', 'gold', 0, 1.5, 0],                                     // band
      ['triangle', 'purple', 0, 2.5, 0]] },                                 // tip
    { id: 'cat', pack: 'halloween', emoji: '🐈‍⬛', name: 'Cat', layout: [
      ['square', 'purple', -0.5, 0.5, 0], ['square', 'purple', 0.5, 0.5, 0], // body
      ['square', 'purple', -0.5, 1.5, 0],                                   // head
      ['triangle', 'purple', -0.5, 2.5, 0],                                 // ear
      ['quarter', 'purple', 1.5, 1.5, 0]] },                                // tail
    { id: 'haunted', pack: 'halloween', emoji: '🏚️', name: 'Haunted House', layout: [
      ['arch', 'purple', 0, 0.5, 0],                                        // spooky door
      ['square', 'gold', -1.5, 0.5, 0], ['square', 'gold', 1.5, 0.5, 0],     // lit windows
      ['trapezoid', 'green', 0, 1.5, 0], ['triangle', 'green', 0, 2.5, 0]] }, // roof + spire
    { id: 'ghost', pack: 'halloween', emoji: '👻', name: 'Ghost', layout: [
      ['arch', 'teal', 0, 0.5, 0],                                          // wavy bottom
      ['square', 'teal', -0.5, 1.5, 0], ['square', 'teal', 0.5, 1.5, 0],
      ['quarter', 'teal', -0.5, 2.5, 1], ['quarter', 'teal', 0.5, 2.5, 0]] }, // round head
    { id: 'bat', pack: 'halloween', emoji: '🦇', name: 'Bat', layout: [
      ['square', 'purple', 0, 0.5, 0], ['square', 'purple', 0, 1.5, 0],      // perch + body
      ['quarter', 'purple', -1, 1.5, 1], ['quarter', 'purple', 1, 1.5, 0],  // wings
      ['triangle', 'purple', -0.5, 2.5, 0], ['triangle', 'purple', 0.5, 2.5, 0]] }, // ears
    { id: 'pumpkin', pack: 'halloween', emoji: '🎃', name: 'Pumpkin', layout: [
      ['quarter', 'orange', -0.5, 0.5, 2], ['quarter', 'orange', 0.5, 0.5, 3],
      ['quarter', 'orange', -0.5, 1.5, 1], ['quarter', 'orange', 0.5, 1.5, 0],
      ['triangle', 'green', 0, 2.5, 0]] },                                  // stem
  ];

  /** Derive the per-(shape, colour) counts from a layout, in first-seen order. */
  function needFromLayout(layout) {
    const need = [];
    for (const [shape, color] of layout) {
      const r = need.find((q) => q.shape === shape && q.color === color);
      if (r) r.n++; else need.push({ shape, color, n: 1 });
    }
    return need;
  }

  /**
   * How hard a layout is: one per piece, two more per turned piece (turning is
   * the trickiest part for little hands) and one per extra kind of shape.
   */
  function complexity(layout) {
    const kinds = new Set(layout.map((r) => r[0])).size;
    return layout.length + 2 * layout.filter((r) => r[4] % 4 !== 0).length + kinds - 1;
  }
  /** 1 easy 🟢, 2 medium 🟡, 3 hard 🔴. */
  function tierOf(layout) {
    const c = complexity(layout);
    return c <= 6 ? 1 : c <= 10 ? 2 : 3;
  }

  // Within each pack the builds run from easiest to hardest: that's the path ➡️ follows.
  const CHALLENGES = [];
  for (const pack of PACKS) {
    BUILDS.filter((b) => b.pack === pack.id)
      .map((b) => Object.assign({}, b, { need: needFromLayout(b.layout), complexity: complexity(b.layout), tier: tierOf(b.layout) }))
      .sort((a, b) => a.complexity - b.complexity || a.layout.length - b.layout.length)
      .forEach((b) => CHALLENGES.push(b));
  }

  const COLOR_HEX = {};
  for (const c of COLORS) COLOR_HEX[c.name] = c.hex;

  // ---------------------------------------------------------------- transforms

  function rotate(x, y, k) {
    switch (((k % 4) + 4) % 4) {
      case 1: return [-y, x];
      case 2: return [-x, -y];
      case 3: return [y, -x];
      default: return [x, y];
    }
  }

  function toWorld(piece, p) {
    const r = rotate(p[0], p[1], piece.rot || 0);
    return { x: piece.x + r[0], y: piece.y + r[1] };
  }

  function worldPolygon(piece) {
    return SHAPES[piece.shape].poly.map((p) => toWorld(piece, p));
  }

  function worldSnapPoints(piece) {
    return SHAPES[piece.shape].snap.map((p, i) => {
      const w = toWorld(piece, p);
      w.i = i;
      return w;
    });
  }

  function pieceBounds(piece) {
    const poly = worldPolygon(piece);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }

  function polygonArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const [px, py] = Array.isArray(p) ? p : [p.x, p.y];
      const [qx, qy] = Array.isArray(q) ? q : [q.x, q.y];
      a += px * qy - qx * py;
    }
    return a / 2;
  }

  // ------------------------------------------------------------------ snapping

  /**
   * Magnet + ground snapping for a dragged piece.
   * Finds the nearest pair of snap points (dragged piece vs. others) within
   * `threshold` and moves the piece so they coincide. A snap that would sink
   * the piece below the ground is skipped; then the piece rests on the ground
   * (y = 0) and may still slide sideways onto a neighbour's snap point.
   * Returns { x, y, kind: 'magnet'|'ground'|'none', contact, key, grounded }.
   * `contact` is the world point where the magnets meet (or null).
   */
  function snapPiece(piece, others, threshold) {
    if (threshold === undefined) threshold = SNAP_THRESHOLD;
    const pts = worldSnapPoints(piece);
    const minY = pieceBounds(piece).minY;
    const otherPts = [];
    for (const o of others) {
      if (o === piece || o.id === piece.id) continue;
      otherPts.push({ id: o.id, pts: worldSnapPoints(o) });
    }

    const cands = [];
    for (const o of otherPts) {
      for (const a of pts) {
        for (const b of o.pts) {
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d <= threshold) cands.push({ dx, dy, d, b, key: o.id + ':' + b.i + ':' + a.i });
        }
      }
    }
    cands.sort((p, q) => p.d - q.d);
    for (const c of cands) {
      if (minY + c.dy >= -EPS) {
        return {
          x: piece.x + c.dx, y: piece.y + c.dy, kind: 'magnet',
          contact: { x: c.b.x, y: c.b.y }, key: c.key,
          grounded: Math.abs(minY + c.dy) < EPS,
        };
      }
    }

    if (minY <= threshold) {
      // Rest on the ground; optionally slide sideways to meet a neighbour.
      const dy = -minY;
      let best = null;
      for (const o of otherPts) {
        for (const a of pts) {
          for (const b of o.pts) {
            const ddx = b.x - a.x;
            if (Math.abs(b.y - (a.y + dy)) <= 0.1 && Math.abs(ddx) <= threshold &&
                (!best || Math.abs(ddx) < Math.abs(best.dx))) {
              best = { dx: ddx, b, key: o.id + ':' + b.i + ':' + a.i };
            }
          }
        }
      }
      if (best) {
        return {
          x: piece.x + best.dx, y: piece.y + dy, kind: 'magnet',
          contact: { x: best.b.x, y: best.b.y }, key: best.key, grounded: true,
        };
      }
      return { x: piece.x, y: piece.y + dy, kind: 'ground', contact: null, key: 'ground', grounded: true };
    }
    return { x: piece.x, y: piece.y, kind: 'none', contact: null, key: null, grounded: false };
  }

  // ------------------------------------------------------------- hit testing

  function pointInPolygon(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function distToPolygon(px, py, poly) {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const vx = b.x - a.x, vy = b.y - a.y;
      const len2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / len2));
      best = Math.min(best, Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy)));
    }
    return best;
  }

  /** Topmost piece (last in array) under the point; forgiving `margin` for fingers. */
  function hitTest(pieces, x, y, margin) {
    for (let i = pieces.length - 1; i >= 0; i--) {
      if (pointInPolygon(x, y, worldPolygon(pieces[i]))) return pieces[i];
    }
    if (margin > 0) {
      let best = null, bestD = margin;
      for (let i = pieces.length - 1; i >= 0; i--) {
        const d = distToPolygon(x, y, worldPolygon(pieces[i]));
        if (d < bestD) { bestD = d; best = pieces[i]; }
      }
      return best;
    }
    return null;
  }

  // ---------------------------------------------------------- target layouts

  /**
   * The challenge's target pieces (slots) as full pieces, centred on x = 0.
   * Colours are hex so slots compare directly with placed pieces.
   */
  function targetSlots(challenge) {
    const pieces = challenge.layout.map(([shape, color, x, y, rot], i) =>
      ({ id: 'slot' + i, shape, color: COLOR_HEX[color], x, y, rot }));
    let minX = Infinity, maxX = -Infinity;
    for (const p of pieces) {
      const b = pieceBounds(p);
      minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
    }
    const shift = -(minX + maxX) / 2;
    for (const p of pieces) p.x += shift;
    return pieces;
  }

  // ------------------------------------------------------------ connectivity

  function touching(a, b) {
    const pa = worldSnapPoints(a), pb = worldSnapPoints(b);
    for (const p of pa) for (const q of pb) if (Math.hypot(p.x - q.x, p.y - q.y) <= CONTACT_EPS) return true;
    return false;
  }

  /** Groups of pieces joined by coincident (snapped) magnet points. */
  function components(pieces) {
    const parent = pieces.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        if (touching(pieces[i], pieces[j])) parent[find(i)] = find(j);
      }
    }
    const groups = new Map();
    pieces.forEach((p, i) => {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(p);
    });
    return Array.from(groups.values());
  }

  function countShapes(pieces) {
    const c = {};
    for (const p of pieces) c[p.shape] = (c[p.shape] || 0) + 1;
    return c;
  }

  function centroid(poly) {
    let x = 0, y = 0;
    for (const p of poly) { x += p.x; y += p.y; }
    return { x: x / poly.length, y: y / poly.length };
  }

  /** Does `piece`, shifted by (dx, dy), cover exactly the same outline as `slot`? */
  function fillsSlot(piece, slot, dx, dy) {
    if (piece.shape !== slot.shape || String(piece.color).toLowerCase() !== slot.color) return false;
    const pa = worldPolygon(piece), pb = worldPolygon(slot);
    return pa.every((p) => pb.some((q) => Math.hypot(p.x + dx - q.x, p.y + dy - q.y) <= CONTACT_EPS));
  }

  /**
   * Progress towards a challenge: pieces only count when they sit in the right
   * place in the build (right shape, colour and turn), wherever on the board
   * the build stands. Tries lining the target up under each placed piece and
   * keeps the best fit.
   * Returns { have, done }: have[i] is how many of challenge.need[i] are in
   * the right place.
   */
  function challengeProgress(pieces, challenge) {
    const slots = challenge.layout.map(([shape, color, x, y, rot]) => ({
      shape, color: COLOR_HEX[color], x, y, rot,
      need: challenge.need.findIndex((r) => r.shape === shape && r.color === color),
    }));
    let best = challenge.need.map(() => 0), bestN = 0;
    for (const anchor of pieces) {
      for (const s of slots) {
        const a = centroid(worldPolygon(anchor)), b = centroid(worldPolygon(s));
        const dx = b.x - a.x, dy = b.y - a.y;
        if (!fillsSlot(anchor, s, dx, dy)) continue;
        const used = new Set(), have = challenge.need.map(() => 0);
        for (const t of slots) {
          const q = pieces.find((p) => !used.has(p) && fillsSlot(p, t, dx, dy));
          if (q) { used.add(q); have[t.need]++; }
        }
        if (used.size > bestN) { bestN = used.size; best = have; }
        if (bestN === slots.length) return { have: best, done: true };
      }
    }
    return { have: best, done: false };
  }

  // Points for finishing a build: 10 per piece, times the tier (easy ×1,
  // medium ×2, hard ×3), plus a bonus the first time that build is ever finished.
  const POINTS_PER_PIECE = 10;
  const FIRST_TIME_BONUS = 50;
  /** Extra points the first time every build in a pack has been finished. */
  const PACK_BONUS = 200;
  function challengeScore(challenge, firstTime) {
    return challenge.layout.length * POINTS_PER_PIECE * challenge.tier + (firstTime ? FIRST_TIME_BONUS : 0);
  }

  /** The build ➡️ goes to: the next unfinished one along the pack's path, else simply the next one. */
  function nextChallenge(idx, doneIds) {
    const pack = CHALLENGES[idx].pack;
    const path = CHALLENGES.map((c, i) => i).filter((i) => CHALLENGES[i].pack === pack);
    const at = path.indexOf(idx);
    const after = path.slice(at + 1).concat(path.slice(0, at));
    return after.find((i) => !doneIds.has(CHALLENGES[i].id)) ?? after[0] ?? idx;
  }

  return {
    EPS, SNAP_THRESHOLD, CONTACT_EPS, SHAPES, SHAPE_ORDER, COLORS, COLOR_HEX, PACKS, CHALLENGES, needFromLayout, complexity, tierOf,
    targetSlots,
    rotate, toWorld, worldPolygon, worldSnapPoints, pieceBounds, polygonArea,
    snapPiece, hitTest, pointInPolygon, touching, components, countShapes, challengeProgress,
    POINTS_PER_PIECE, FIRST_TIME_BONUS, PACK_BONUS, challengeScore, nextChallenge,
  };
});
