// The bike kit: a Mindanao trail bike and its rider - the dual-sport you meet on
// every provincial road there: tall on knobby tyres and spoked rims, a high
// front fender, a slim tank between side shrouds, an upright single over a
// skid plate, an upswept pipe, a long flat seat and a small rack on the tail.
// The rider sits up in a loose rain jacket and a plain helmet. Surfaces are
// lofted through smooth cross-sections and swept along curves, so the tank,
// the shrouds, the helmet and the limbs are one continuous skin, not boxes.
// buildBike lays out vertex-colored geometry only, in the colors of a paint
// from library/paints/, and describes it as a tree of hinged nodes (the
// swingarm, the fork, the wheels, the rider's torso, head and arms); the
// engine makes the meshes, lights them with its own soft material and drives
// the hinges with animateBike. Lengths are meters; the bike faces +z, and its
// origin is on the ground between the tyres, so a lean rolls it about the line
// the tyres touch.

export const BIKE = {
  wheel: 0.34, // tyre radius, knobs included
  front: 0.72, // front axle, ahead of the origin
  rear: -0.72, // rear axle
  base: 1.44, // wheelbase
  // what one bike with its rider may cost: knobby tyres and spoked wheels are
  // most of it, and the whole bike is well under 1% of a frame's triangles
  triangles: 9000,
};

// Fixed finishes: rubber, metal, the engine, the rider's gear. Only the body
// (tank, shrouds, panels, fenders, helmet) and the trim change with the paint.
const FIXED = {
  tyre: 0x2f2e2c,
  knob: 0x353431,
  metal: 0xa7aaa6,
  chrome: 0xc4c6c1,
  dark: 0x46443f,
  engine: 0x55534d,
  frame: 0x3b3a37,
  seat: 0x33302d,
  lens: 0xf1e7c6,
  tail: 0xb04a3c,
  plate: 0xd9d4c4,
  jacket: 0x40596a, // a slate-blue rain jacket
  jacketDark: 0x34495a,
  pants: 0x3b4048,
  boots: 0x312e2b,
  visor: 0x2d3440,
  glove: 0x302e2c,
};
const RAKE = 0.44; // the fork's lean from vertical
const FORK = 0.8; // steering head to front axle, along the fork
// the steering head, placed so the front axle sits at BIKE.front at tyre height
const HEAD = [0, BIKE.wheel + FORK * Math.cos(RAKE), BIKE.front - FORK * Math.sin(RAKE)];
const SWING = [0, 0.42, -0.22]; // the swingarm's pivot
const SEAT = [0, 0.93, -0.22]; // the rider's pelvis on the seat
const UPRIGHT = 66 * (Math.PI / 180); // the torso's rise from horizontal: sitting up, trail style
const SHOULDER = [0.2, 0.47 * Math.sin(UPRIGHT), 0.47 * Math.cos(UPRIGHT)]; // in the rider's frame (pelvis origin)
const ARM = 0.27; // each arm bone

const smooth = (a, b, c, d, t) => {
  const t2 = t * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t2 * t);
};

export function buildBike(paint, kit) {
  const { THREE, merge, M } = kit;
  const color = (c) => (c instanceof THREE.Color ? c : new THREE.Color(c));
  const body = color(paint.body),
    trim = color(paint.trim),
    dark = body.clone().multiplyScalar(0.62);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // A loft along +z through stations {z, x, y, rx, ry, p}: superellipse
  // sections eased with a spline, one welded skin, painted by `paintAt`.
  const loft = (stations, { around = 14, along = 12, paintAt } = {}) => {
    const n = stations.length,
      rows = along + 1,
      pos = [],
      col = [],
      idx = [];
    const at = (i) => stations[Math.max(0, Math.min(n - 1, i))];
    for (let i = 0; i < rows; i++) {
      const f = (i / along) * (n - 1),
        k = Math.min(n - 2, Math.floor(f)),
        t = f - k;
      const s = {};
      for (const key of ['z', 'x', 'y', 'rx', 'ry', 'p']) {
        const g = (j) => at(j)[key] ?? (key === 'p' ? 2.3 : 0);
        s[key] = smooth(g(k - 1), g(k), g(k + 1), g(k + 2), t);
      }
      for (let j = 0; j < around; j++) {
        const a = (j / around) * Math.PI * 2,
          cx = Math.cos(a),
          sy = Math.sin(a),
          e = 2 / Math.max(1.2, s.p);
        const x = s.x + s.rx * Math.sign(cx) * Math.abs(cx) ** e,
          y = s.y + s.ry * Math.sign(sy) * Math.abs(sy) ** e;
        pos.push(x, y, s.z);
        const c = color(paintAt ? paintAt({ x, y, z: s.z, cx, sy, u: i / along, s }) : body);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < rows - 1; i++)
      for (let j = 0; j < around; j++) {
        const a = i * around + j,
          b = i * around + ((j + 1) % around),
          c = (i + 1) * around + j,
          d = (i + 1) * around + ((j + 1) % around);
        idx.push(a, b, c, b, d, c);
      }
    return finish(pos, col, idx);
  };
  const finish = (pos, col, idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // A sweep along a curve through points, radius easing from r0 to r1 (or by
  // a function of t), capped; `wide` stretches the section across the curve's
  // plane, which turns a tube into a fender or a sleeve.
  const sweep = (points, r0, r1, c, { sides = 6, segs = 6, wide = 1 } = {}) => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => V(...p)));
    const frames = curve.computeFrenetFrames(segs, false),
      pos = [],
      col = [],
      idx = [],
      cc = color(c);
    const rad = typeof r0 === 'function' ? r0 : (t) => r0 + (r1 - r0) * t;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs,
        p = curve.getPointAt(t),
        r = rad(t);
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        const o = frames.normals[i].clone().multiplyScalar(Math.cos(a) * r).addScaledVector(frames.binormals[i], Math.sin(a) * r * wide);
        pos.push(p.x + o.x, p.y + o.y, p.z + o.z);
        col.push(cc.r, cc.g, cc.b);
      }
    }
    for (let i = 0; i < segs; i++)
      for (let j = 0; j < sides; j++) {
        const a = i * sides + j,
          b = i * sides + ((j + 1) % sides),
          d = (i + 1) * sides + j,
          e = (i + 1) * sides + ((j + 1) % sides);
        idx.push(a, d, b, b, d, e);
      }
    for (const [end, row, flip] of [[curve.getPointAt(0), 0, true], [curve.getPointAt(1), segs, false]]) {
      const base = pos.length / 3;
      pos.push(end.x, end.y, end.z);
      col.push(cc.r, cc.g, cc.b);
      for (let j = 0; j < sides; j++) {
        const a = row * sides + j,
          b = row * sides + ((j + 1) % sides);
        flip ? idx.push(base, b, a) : idx.push(base, a, b);
      }
    }
    return finish(pos, col, idx);
  };
  const ball = (x, y, z, rx, ry, rz, c, rot = [0, 0, 0]) => {
    const g = new THREE.SphereGeometry(1, 8, 5);
    return { geometry: g, matrix: M(x, y, z, rx, ry, rz, ...rot), color: color(c) };
  };
  const cyl = (x, y, z, r0, r1, len, c, rot = [0, 0, 0], sides = 10) => ({
    geometry: new THREE.CylinderGeometry(r0, r1, len, sides, 1),
    matrix: M(x, y, z, 1, 1, 1, ...rot),
    color: color(c),
  });
  const part = (geometry) => ({ geometry });
  const sym = (fn) => [-1, 1].map(fn);
  const dispose = (list) => list.forEach((p) => p.geometry.dispose());
  const build = (list) => {
    const g = merge(list);
    dispose(list);
    return g;
  };
  const stripe = (base, line, half) => (q) => (q.sy > 0.55 && Math.abs(q.x - q.s.x) < half ? line : q.sy < -0.5 ? dark : base);

  // ---- the frame, the engine, the tank, the seat and tail: the fixed body
  const fixed = [];
  const push = (...ps) => fixed.push(...ps);
  const [, hy, hz] = HEAD;
  // single downtube splitting into a cradle under the engine, the backbone, and
  // the subframe that carries the seat and the rack
  push(part(sweep([[0, hy - 0.04, hz - 0.02], [0, 0.74, 0.34], [0, 0.4, 0.27], [0, 0.29, 0.14]], 0.028, 0.026, FIXED.frame, { segs: 6 })));
  for (const s of [-1, 1]) {
    push(part(sweep([[0, 0.29, 0.14], [s * 0.07, 0.27, 0.02], [s * 0.08, 0.3, -0.14], [s * 0.07, 0.42, -0.22]], 0.022, 0.022, FIXED.frame, { segs: 5 })));
    push(part(sweep([[s * 0.06, 0.82, -0.12], [s * 0.08, 0.86, -0.45], [s * 0.07, 0.88, -0.8]], 0.019, 0.016, FIXED.frame, { segs: 5 })));
    push(part(sweep([[s * 0.07, 0.42, -0.22], [s * 0.08, 0.64, -0.42], [s * 0.07, 0.86, -0.62]], 0.017, 0.015, FIXED.frame, { segs: 4 })));
    // twin shocks
    push(part(sweep([[s * 0.12, 0.85, -0.5], [s * 0.13, 0.64, -0.55], [s * 0.13, 0.5, -0.58]], 0.022, 0.017, FIXED.chrome, { segs: 4, sides: 6 })));
  }
  push(part(sweep([[0, hy - 0.02, hz - 0.04], [0, 0.95, 0.16], [0, 0.86, -0.12]], 0.026, 0.024, FIXED.frame, { segs: 5 })));
  // engine: crankcase, an upright finned barrel leaning a little forward, its head, covers
  push(ball(0, 0.42, 0.05, 0.13, 0.13, 0.19, FIXED.engine));
  push(cyl(0, 0.6, 0.15, 0.068, 0.072, 0.24, FIXED.engine, [0.2, 0, 0]));
  for (let i = 0; i < 5; i++) push(cyl(0, 0.52 + i * 0.05 * 0.98, 0.135 + i * 0.05 * 0.2, 0.092, 0.092, 0.012, FIXED.metal, [0.2, 0, 0], 8));
  push(ball(0, 0.75, 0.18, 0.085, 0.055, 0.08, FIXED.engine, [0.2, 0, 0]));
  push(ball(0.13, 0.42, 0.05, 0.03, 0.095, 0.11, FIXED.metal));
  push(ball(-0.13, 0.43, 0.02, 0.03, 0.08, 0.09, FIXED.dark));
  // a skid plate under it all
  push(ball(0, 0.27, 0.08, 0.12, 0.028, 0.24, FIXED.metal));
  // the exhaust: a header out of the barrel, down and round, swept up the right
  // side to a silencer under the tail, with a heat shield over its bend
  push(part(sweep([[0.05, 0.64, 0.25], [0.12, 0.45, 0.3], [0.16, 0.34, 0.12], [0.17, 0.48, -0.16], [0.17, 0.64, -0.4]], 0.024, 0.028, FIXED.metal, { segs: 8 })));
  push(part(loft([
    { z: -0.95, x: 0.17, y: 0.83, rx: 0.014, ry: 0.014 },
    { z: -0.91, x: 0.17, y: 0.82, rx: 0.045, ry: 0.045 },
    { z: -0.68, x: 0.17, y: 0.75, rx: 0.052, ry: 0.052 },
    { z: -0.42, x: 0.17, y: 0.66, rx: 0.044, ry: 0.044 },
    { z: -0.38, x: 0.17, y: 0.65, rx: 0.022, ry: 0.022 },
  ], { around: 8, along: 6, paintAt: (q) => (q.u < 0.15 ? FIXED.dark : color(FIXED.chrome)) })));
  push(ball(0.2, 0.68, -0.6, 0.012, 0.045, 0.16, FIXED.dark, [-0.32, 0, 0]));
  // the tank: slim, high at the front, with a stripe of trim along its crown
  push(part(loft([
    { z: -0.08, y: 0.9, rx: 0.02, ry: 0.02 },
    { z: -0.02, y: 0.9, rx: 0.085, ry: 0.06 },
    { z: 0.12, y: 0.925, rx: 0.115, ry: 0.085 },
    { z: 0.26, y: 0.95, rx: 0.11, ry: 0.08 },
    { z: 0.34, y: 0.955, rx: 0.07, ry: 0.06 },
    { z: 0.37, y: 0.955, rx: 0.02, ry: 0.02 },
  ], { around: 12, along: 8, paintAt: stripe(body, trim, 0.018) })));
  // side shrouds sweeping down off the tank, and number panels under the seat
  for (const s of [-1, 1]) {
    push(ball(s * 0.12, 0.84, 0.25, 0.028, 0.11, 0.15, body, [0.45, 0, s * 0.12]));
    push(ball(s * 0.135, 0.86, 0.27, 0.01, 0.045, 0.08, trim, [0.45, 0, s * 0.12]));
    push(ball(s * 0.105, 0.72, -0.38, 0.026, 0.085, 0.16, body, [0.15, 0, 0]));
  }
  // the long flat seat, and the rear fender running out under a small rack
  push(part(loft([
    { z: -0.86, y: 0.9, rx: 0.02, ry: 0.012 },
    { z: -0.8, y: 0.9, rx: 0.085, ry: 0.032 },
    { z: -0.4, y: 0.895, rx: 0.12, ry: 0.042 },
    { z: -0.05, y: 0.905, rx: 0.12, ry: 0.042 },
    { z: 0.06, y: 0.93, rx: 0.08, ry: 0.035 },
    { z: 0.1, y: 0.94, rx: 0.02, ry: 0.015 },
  ], { around: 8, along: 7, paintAt: (q) => (q.sy < -0.2 ? FIXED.pants : color(FIXED.seat)) })));
  push(part(loft([
    { z: -0.6, y: 0.86, rx: 0.02, ry: 0.012 },
    { z: -0.66, y: 0.86, rx: 0.075, ry: 0.02 },
    { z: -0.95, y: 0.88, rx: 0.07, ry: 0.02 },
    { z: -1.08, y: 0.86, rx: 0.045, ry: 0.016 },
    { z: -1.12, y: 0.845, rx: 0.015, ry: 0.01 },
  ], { around: 8, along: 6, paintAt: () => body })));
  push(ball(0, 0.875, -1.07, 0.04, 0.02, 0.016, FIXED.tail));
  push(ball(0, 0.79, -1.06, 0.07, 0.045, 0.006, FIXED.plate, [0.3, 0, 0]));
  for (const s of [-1, 1]) push(part(sweep([[s * 0.1, 0.94, -0.58], [s * 0.1, 0.95, -0.8], [s * 0.08, 0.95, -0.98]], 0.011, 0.011, FIXED.dark, { segs: 4, sides: 5 })));
  for (const z of [-0.7, -0.84, -0.97]) push(part(sweep([[-0.1, 0.95, z], [0.1, 0.95, z]], 0.009, 0.009, FIXED.dark, { segs: 2, sides: 5 })));
  // the rider's legs: thighs along the seat and the tank, shins to the pegs, boots
  for (const s of [-1, 1]) {
    push(part(sweep([[s * 0.11, 0.93, -0.24], [s * 0.16, 0.9, -0.04], [s * 0.18, 0.86, 0.14]], 0.078, 0.06, FIXED.pants, { segs: 6, sides: 7 })));
    push(part(sweep([[s * 0.18, 0.86, 0.14], [s * 0.2, 0.66, 0.08], [s * 0.19, 0.45, -0.02]], 0.055, 0.043, FIXED.pants, { segs: 6, sides: 7 })));
    push(ball(s * 0.18, 0.86, 0.14, 0.062, 0.062, 0.062, FIXED.pants));
    push(ball(s * 0.19, 0.42, 0.02, 0.055, 0.05, 0.13, FIXED.boots));
    push(part(sweep([[s * 0.14, 0.4, -0.04], [s * 0.25, 0.4, -0.04]], 0.015, 0.015, FIXED.metal, { segs: 2, sides: 6 })));
  }
  const bodyGeometry = build(fixed);

  // ---- a wheel about its own axle: a knobby tyre, a silver rim, spokes, hub, brake
  const wheel = (disc) => {
    const p = [];
    const R = BIKE.wheel - 0.018;
    const tyre = new THREE.TorusGeometry(R - 0.06, 0.06, 6, 24);
    tyre.rotateY(Math.PI / 2);
    tyre.scale(1.25, 1, 1);
    p.push({ geometry: tyre, color: color(FIXED.tyre) });
    // the knobs: staggered blocks round the tread
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2,
        off = i % 2 ? 0.032 : -0.032;
      p.push({ geometry: new THREE.BoxGeometry(0.05, 0.026, 0.04), matrix: M(off, Math.cos(a) * (R + 0.002), Math.sin(a) * (R + 0.002), 1, 1, 1, a, 0, 0), color: color(FIXED.knob) });
    }
    const rim = new THREE.TorusGeometry(R - 0.115, 0.014, 4, 26);
    rim.rotateY(Math.PI / 2);
    p.push({ geometry: rim, color: color(FIXED.chrome) });
    for (let i = 0; i < 12; i++) {
      const g = new THREE.CylinderGeometry(0.004, 0.004, R - 0.15, 3, 1);
      g.translate(0, (R - 0.15) / 2 + 0.035, 0);
      p.push({ geometry: g, matrix: M(i % 2 ? 0.02 : -0.02, 0, 0, 1, 1, 1, (i / 12) * Math.PI * 2, 0, 0), color: color(FIXED.metal) });
    }
    p.push(cyl(0, 0, 0, 0.045, 0.045, 0.12, FIXED.metal, [0, 0, Math.PI / 2], 10));
    p.push(cyl(0.062, 0, 0, 0.022, 0.022, 0.03, trim, [0, 0, Math.PI / 2], 8));
    if (disc) p.push(cyl(0.058, 0, 0, 0.12, 0.12, 0.008, FIXED.metal, [0, 0, Math.PI / 2], 18));
    else p.push(cyl(-0.058, 0, 0, 0.08, 0.08, 0.03, FIXED.metal, [0, 0, Math.PI / 2], 14));
    return build(p);
  };

  // ---- the swingarm, with the chain and its guard
  const swingParts = [];
  for (const s of [-1, 1]) swingParts.push(part(sweep([[s * 0.09, 0, 0], [s * 0.1, -0.03, -0.26], [s * 0.095, -0.08, -0.5]], 0.03, 0.022, FIXED.frame, { segs: 6, sides: 6 })));
  swingParts.push(part(sweep([[-0.09, -0.02, -0.1], [0, -0.02, -0.1], [0.09, -0.02, -0.1]], 0.025, 0.025, FIXED.frame, { segs: 3, sides: 6 })));
  swingParts.push(part(sweep([[-0.12, -0.04, -0.46], [-0.12, -0.05, -0.12], [-0.12, 0.0, 0.0]], 0.011, 0.011, FIXED.dark, { segs: 4, sides: 4 })));
  swingParts.push(ball(-0.125, 0.01, -0.22, 0.008, 0.035, 0.17, FIXED.dark));
  const swingGeometry = build(swingParts);

  // ---- the fork, in a frame whose +y runs up the steering axis and +z ahead of it
  const stanch = [];
  for (const s of [-1, 1]) stanch.push(part(sweep([[s * 0.085, 0.02, 0], [s * 0.085, -0.44, 0]], 0.02, 0.02, FIXED.chrome, { segs: 2, sides: 7 })));
  stanch.push(part(sweep([[-0.1, -0.13, 0], [0.1, -0.13, 0]], 0.03, 0.03, FIXED.dark, { segs: 3, sides: 6 })));
  stanch.push(part(sweep([[-0.1, 0.01, 0], [0.1, 0.01, 0]], 0.026, 0.026, FIXED.dark, { segs: 3, sides: 6 })));
  // the high front fender off the lower clamp, well clear of the tyre
  stanch.push(part(loft([
    { z: -0.2, y: -0.2, rx: 0.02, ry: 0.008 },
    { z: -0.14, y: -0.2, rx: 0.06, ry: 0.014 },
    { z: 0.08, y: -0.19, rx: 0.075, ry: 0.016 },
    { z: 0.3, y: -0.2, rx: 0.065, ry: 0.014 },
    { z: 0.42, y: -0.24, rx: 0.04, ry: 0.01 },
    { z: 0.45, y: -0.255, rx: 0.015, ry: 0.006 },
  ], { around: 8, along: 7, paintAt: (q) => (q.sy > 0.5 && Math.abs(q.x) < 0.012 ? trim : body) })));
  // a square lamp in a small number-plate cowl
  stanch.push(ball(0, -0.02, 0.1, 0.105, 0.13, 0.03, body, [0.1, 0, 0]));
  stanch.push(ball(0, -0.03, 0.125, 0.06, 0.05, 0.03, FIXED.lens));
  stanch.push(ball(0, 0.06, 0.11, 0.09, 0.018, 0.035, trim, [0.1, 0, 0]));
  // the bar: wide and nearly straight, grips, levers, and round mirrors on stalks
  const bars = [];
  for (const s of [-1, 1]) {
    bars.push(part(sweep([[s * 0.01, 0.1, -0.01], [s * 0.15, 0.12, -0.03], [s * 0.3, 0.14, -0.07], [s * 0.38, 0.14, -0.09]], 0.012, 0.012, FIXED.metal, { segs: 8, sides: 6 })));
    bars.push(part(sweep([[s * 0.32, 0.14, -0.077], [s * 0.41, 0.14, -0.097]], 0.019, 0.019, FIXED.glove, { segs: 2, sides: 6 })));
    bars.push(part(sweep([[s * 0.28, 0.135, -0.04], [s * 0.36, 0.13, -0.02]], 0.006, 0.006, FIXED.metal, { segs: 2, sides: 4 })));
    bars.push(part(sweep([[s * 0.24, 0.14, -0.05], [s * 0.28, 0.27, -0.06], [s * 0.3, 0.36, -0.06]], 0.006, 0.006, FIXED.metal, { segs: 3, sides: 5 })));
    bars.push(ball(s * 0.31, 0.38, -0.06, 0.045, 0.04, 0.012, FIXED.dark, [0.2, s * 0.2, 0]));
  }
  const steerGeometry = build([...stanch, ...bars]);
  // lower legs, the axle, a caliper and a fork guard that ride with them
  const lowers = [];
  for (const s of [-1, 1]) {
    lowers.push(part(sweep([[s * 0.085, -0.4, 0], [s * 0.085, -FORK, 0]], 0.03, 0.026, FIXED.dark, { segs: 3, sides: 7 })));
    lowers.push(cyl(s * 0.09, -FORK, 0, 0.03, 0.03, 0.03, FIXED.metal, [0, 0, Math.PI / 2], 8));
    lowers.push(ball(s * 0.085, -0.6, 0.03, 0.012, 0.12, 0.03, body));
  }
  lowers.push(cyl(0.08, -FORK + 0.1, 0.05, 0.024, 0.024, 0.07, FIXED.dark, [Math.PI / 2, 0, 0], 8));
  const lowerGeometry = build(lowers);

  // ---- the rider: torso and head and arms in the rider's frame, origin at the pelvis.
  // The rain jacket hangs loose: wide at the hem over the seat, a hood rolled at the neck.
  const torso = loft([
    { z: -0.06, y: -0.01, rx: 0.175, ry: 0.13 },
    { z: 0.06, y: 0.0, rx: 0.17, ry: 0.13 },
    { z: 0.22, y: 0.005, rx: 0.155, ry: 0.12 },
    { z: 0.38, y: 0.01, rx: 0.19, ry: 0.13 },
    { z: 0.48, y: 0.0, rx: 0.18, ry: 0.115 },
    { z: 0.54, y: 0.0, rx: 0.07, ry: 0.065 },
  ], { around: 12, along: 8, paintAt: (q) => (q.u < 0.12 ? FIXED.jacketDark : color(FIXED.jacket)) });
  torso.rotateX(-UPRIGHT);
  const riderParts = [part(torso), ball(0, -0.01, -0.02, 0.15, 0.1, 0.13, FIXED.pants)];
  for (const s of [-1, 1]) riderParts.push(ball(s * SHOULDER[0], SHOULDER[1], SHOULDER[2], 0.066, 0.066, 0.066, FIXED.jacket));
  // the rolled hood behind the neck, and the neck itself
  riderParts.push(ball(0, 0.5, 0.1, 0.11, 0.055, 0.075, FIXED.jacketDark));
  riderParts.push(part(sweep([[0, 0.5, 0.18], [0, 0.56, 0.2]], 0.048, 0.045, FIXED.glove, { segs: 2, sides: 6 })));
  const riderGeometry = build(riderParts);

  // a plain full-face helmet in the trim color, a dark visor, nothing else
  const helmet = loft([
    { z: -0.16, y: 0.0, rx: 0.02, ry: 0.02 },
    { z: -0.12, y: 0.01, rx: 0.105, ry: 0.115 },
    { z: -0.02, y: 0.02, rx: 0.135, ry: 0.15 },
    { z: 0.09, y: 0.0, rx: 0.13, ry: 0.14 },
    { z: 0.17, y: -0.03, rx: 0.1, ry: 0.105 },
    { z: 0.205, y: -0.05, rx: 0.035, ry: 0.045 },
  ], {
    around: 12,
    along: 8,
    paintAt: (q) => (q.z > 0.04 && q.sy > -0.3 && q.sy < 0.45 && Math.abs(q.cx) < 0.86 ? color(FIXED.visor) : trim),
  });
  const headGeometry = build([part(helmet)]);

  // an arm bone along +y: a loose sleeve tapering toward the wrist, a glove on the forearm
  const upperArm = build([part(sweep([[0, 0, 0], [0, ARM, 0]], 0.058, 0.048, FIXED.jacket, { segs: 2, sides: 7 })), ball(0, ARM, 0, 0.05, 0.05, 0.05, FIXED.jacket)]);
  const foreArm = build([part(sweep([[0, 0, 0], [0, ARM - 0.02, 0]], 0.048, 0.04, FIXED.jacket, { segs: 2, sides: 7 })), ball(0, ARM + 0.01, 0, 0.038, 0.05, 0.04, FIXED.glove)]);

  const neck = [0, 0.56 * Math.sin(UPRIGHT) + 0.07, 0.56 * Math.cos(UPRIGHT) + 0.02];
  return {
    body: bodyGeometry,
    // the hinged tree: parents come first
    nodes: [
      { id: 'swing', parent: null, at: SWING, geometry: swingGeometry },
      { id: 'rearWheel', parent: 'swing', at: [0, BIKE.wheel - SWING[1], BIKE.rear - SWING[2]], geometry: wheel(false) },
      { id: 'fork', parent: null, at: HEAD, rotation: [-RAKE, 0, 0], geometry: null },
      { id: 'steer', parent: 'fork', at: [0, 0, 0], geometry: steerGeometry },
      { id: 'lower', parent: 'steer', at: [0, 0, 0], geometry: lowerGeometry },
      { id: 'frontWheel', parent: 'lower', at: [0, -FORK, 0], geometry: wheel(true) },
      { id: 'rider', parent: null, at: SEAT, geometry: riderGeometry },
      { id: 'head', parent: 'rider', at: neck, geometry: headGeometry },
      { id: 'armL', parent: 'rider', at: [SHOULDER[0], SHOULDER[1], SHOULDER[2]], geometry: upperArm },
      { id: 'foreL', parent: 'armL', at: [0, ARM, 0], geometry: foreArm },
      { id: 'armR', parent: 'rider', at: [-SHOULDER[0], SHOULDER[1], SHOULDER[2]], geometry: upperArm },
      { id: 'foreR', parent: 'armR', at: [0, ARM, 0], geometry: foreArm },
    ],
  };
}

// Where each hand takes the bar, in the steering frame.
const GRIP = [0.365, 0.14, -0.088];
let tmp = null;

// Drive the hinges: spin the wheels by the distance ridden, steer the bars,
// work the suspension, lean the rider into the turn and turn his head toward
// it, and reach each arm from the shoulder to the grip it holds.
export function animateBike(group, distance, motion = {}) {
  const rig = group.userData.rig;
  if (!rig) return;
  const { lean = 0, yawRate = 0, t = 0, rough = 0 } = motion;
  const THREE = group.userData.THREE;
  const spin = (distance / BIKE.wheel) % (Math.PI * 2);
  rig.frontWheel.rotation.x = rig.rearWheel.rotation.x = spin;
  const bump = (0.006 + 0.02 * rough) * (Math.sin(t * 17.3) * 0.6 + Math.sin(t * 9.1 + 1.3) * 0.4);
  const load = Math.min(0.03, Math.abs(lean) * 0.05);
  rig.lower.position.y = 0.012 + load + bump;
  rig.swing.rotation.x = (0.012 + load * 0.6 - bump * 0.8) / 0.52;
  rig.steer.rotation.y = Math.max(-0.3, Math.min(0.3, yawRate * 0.35)) + Math.sin(t * 1.7) * 0.004;
  rig.rider.rotation.set(Math.sin(t * 1.3) * 0.012 + bump * 1.2, Math.max(-0.3, Math.min(0.3, yawRate * 0.35)) * 0.34, -lean * 0.3);
  rig.head.rotation.set(-0.12 - rig.rider.rotation.x, Math.max(-0.5, Math.min(0.5, yawRate * 0.9)), lean * 0.2);
  // arms: two bones to the grip, elbows out and down
  if (!tmp) {
    tmp = {
      s: new THREE.Vector3(),
      g: new THREE.Vector3(),
      e: new THREE.Vector3(),
      u: new THREE.Vector3(),
      p: new THREE.Vector3(),
      d: new THREE.Vector3(),
      y: new THREE.Vector3(0, 1, 0),
      q: new THREE.Quaternion(),
    };
  }
  rig.rider.updateWorldMatrix(true, false);
  rig.steer.updateWorldMatrix(true, false);
  for (const [arm, fore, side] of [[rig.armL, rig.foreL, 1], [rig.armR, rig.foreR, -1]]) {
    tmp.g.set(GRIP[0] * side, GRIP[1], GRIP[2]);
    rig.steer.localToWorld(tmp.g);
    rig.rider.worldToLocal(tmp.g);
    tmp.s.copy(arm.position);
    tmp.d.subVectors(tmp.g, tmp.s);
    const dist = Math.min(tmp.d.length(), ARM * 2 - 0.005);
    tmp.u.copy(tmp.d).normalize();
    const h = Math.sqrt(Math.max(0, ARM * ARM - (dist / 2) * (dist / 2)));
    tmp.p.set(side * 0.7, -0.6, -0.3);
    tmp.p.addScaledVector(tmp.u, -tmp.p.dot(tmp.u)).normalize();
    tmp.e.copy(tmp.s).addScaledVector(tmp.u, dist / 2).addScaledVector(tmp.p, h);
    tmp.d.subVectors(tmp.e, tmp.s).normalize();
    arm.quaternion.setFromUnitVectors(tmp.y, tmp.d);
    tmp.d.subVectors(tmp.g, tmp.e).normalize().applyQuaternion(tmp.q.copy(arm.quaternion).invert());
    fore.quaternion.setFromUnitVectors(tmp.y, tmp.d);
  }
}

// The corner control's tile: the trail bike's silhouette in a paint.
export function bikeTile(paint) {
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');
  const body = hex(paint.body),
    trim = hex(paint.trim);
  return `<svg viewBox="0 0 120 64" aria-hidden="true">
<g fill="none" stroke="#2f2e2c" stroke-width="6.5" stroke-dasharray="3 1.6"><circle cx="24" cy="46" r="13"/><circle cx="96" cy="46" r="13"/></g>
<g fill="#c4c6c1"><circle cx="24" cy="46" r="3.5"/><circle cx="96" cy="46" r="3.5"/></g>
<g stroke="#3b3a37" stroke-width="3" stroke-linecap="round"><path d="M24 46 L50 38"/><path d="M96 46 L82 14"/><path d="M76 11 L90 13"/></g>
<rect x="48" y="30" width="20" height="13" rx="3" fill="#55534d"/>
<path d="M14 25 L60 24 L62 28 L16 29 Z" fill="#33302d"/>
<path d="M4 25 L22 23 L22 27 L6 28 Z" fill="${body}"/>
<path d="M58 26 Q66 15 80 18 L84 29 L60 29 Z" fill="${body}"/>
<path d="M62 22 Q70 17 79 19" stroke="${trim}" stroke-width="2" fill="none"/>
<path d="M86 22 Q98 20 108 26 L106 28 Q96 25 86 26 Z" fill="${body}"/>
<path d="M30 42 Q40 22 46 28" stroke="#c4c6c1" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`;
}
