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

  // The 10 builds from the box. Counts never exceed the pieces in the box.
  const CHALLENGES = [
    { id: 'rocket', emoji: '🚀', name: 'Rocket', need: { triangle: 3, square: 2 } },
    { id: 'tower', emoji: '🗼', name: 'Tower', need: { square: 4, triangle: 1 } },
    { id: 'castle', emoji: '🏰', name: 'Castle', need: { square: 4, arch: 1, triangle: 2 } },
    { id: 'robot', emoji: '🤖', name: 'Robot', need: { square: 5, trapezoid: 1 } },
    { id: 'horse', emoji: '🐴', name: 'Horse', need: { arch: 1, square: 2, quarter: 2, triangle: 1 } },
    { id: 'dome', emoji: '🏠', name: 'Dome House', need: { quarter: 4, square: 2 } },
    { id: 'guitar', emoji: '🎸', name: 'Guitar', need: { arch: 1, quarter: 2, square: 2 } },
    { id: 'boat', emoji: '⛵', name: 'Boat', need: { trapezoid: 1, triangle: 2, square: 1 } },
    { id: 'bridge', emoji: '🌉', name: 'Bridge', need: { arch: 2, square: 2 } },
    { id: 'tree', emoji: '🌲', name: 'Tree', need: { triangle: 3, square: 1 } },
  ];

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

  /**
   * Progress towards a challenge: the best snapped structure on the board.
   * Returns { have, need, done } where `have` is that structure's counts.
   */
  function challengeProgress(pieces, challenge) {
    let best = {}, bestScore = -1, done = false;
    for (const comp of components(pieces)) {
      const have = countShapes(comp);
      let score = 0, ok = true;
      for (const k of Object.keys(challenge.need)) {
        score += Math.min(have[k] || 0, challenge.need[k]);
        if ((have[k] || 0) < challenge.need[k]) ok = false;
      }
      if (score > bestScore) { bestScore = score; best = have; }
      if (ok) { done = true; best = have; break; }
    }
    return { have: best, need: challenge.need, done };
  }

  return {
    EPS, SNAP_THRESHOLD, CONTACT_EPS, SHAPES, SHAPE_ORDER, COLORS, CHALLENGES,
    rotate, toWorld, worldPolygon, worldSnapPoints, pieceBounds, polygonArea,
    snapPiece, hitTest, pointInPolygon, touching, components, countShapes, challengeProgress,
  };
});
