// The bike kit: the GNEGR motorcycle and its rider, drawn after the logo - two
// big wheels, a domed tank, a short upswept tail, a small fairing and screen
// over the fork, the engine slung under the tank. Surfaces are lofted through
// smooth cross-sections and swept along curves, so the tank, the tail, the
// helmet and the limbs are one continuous skin with painted stripes, not
// boxes. buildBike lays out vertex-colored geometry only, in the colors of a
// paint from library/paints/, and describes it as a tree of hinged nodes (the
// swingarm, the fork, the wheels, the rider's torso, head and arms); the
// engine makes the meshes, lights them with its own soft material and drives
// the hinges with animateBike. Lengths are meters; the bike faces +z, and its
// origin is on the ground between the tyres, so a lean rolls it about the line
// the tyres touch.

export const BIKE = {
  wheel: 0.335, // tyre radius
  front: 0.72, // front axle, ahead of the origin
  rear: -0.72, // rear axle
  base: 1.44, // wheelbase
  triangles: 6000, // what one bike with its rider may cost
};

// Fixed finishes: rubber, metal, the engine, the rider's gear. Only the body
// and the trim change with the paint.
const FIXED = {
  tyre: 0x2f2e2c,
  metal: 0x9a9c98,
  dark: 0x4a4844,
  engine: 0x45433f,
  frame: 0x3a3936,
  seat: 0x34312e,
  lens: 0xf1e7c6,
  tail: 0xb04a3c,
  screen: 0x8fa3a8,
  jacket: 0x3b3e40,
  pants: 0x3e4756,
  boots: 0x33302d,
  visor: 0x2d3440,
  glove: 0x302e2c,
};
const RAKE = 0.376; // the fork's lean from vertical
const HEAD = [0, 1.04, 0.44]; // the steering head
const FORK = 0.763; // head to front axle
const SWING = [0, 0.42, -0.22]; // the swingarm's pivot
const SHOULDER = [0.2, 0.285, 0.363]; // in the rider's frame (pelvis origin)
const ARM = 0.26; // each arm bone

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
  // cradle and subframe
  for (const s of [-1, 1]) {
    push(part(sweep([[s * 0.05, 0.96, 0.4], [s * 0.07, 0.66, 0.34], [s * 0.09, 0.4, 0.16], [s * 0.1, 0.36, -0.08], [s * 0.1, 0.42, -0.2]], 0.026, 0.026, FIXED.frame, { segs: 5 })));
    push(part(sweep([[s * 0.09, 0.78, -0.08], [s * 0.08, 0.88, -0.42], [s * 0.06, 0.95, -0.7]], 0.022, 0.018, FIXED.frame, { segs: 6 })));
    // twin shocks
    push(part(sweep([[s * 0.13, 0.84, -0.42], [s * 0.15, 0.62, -0.34], [s * 0.15, 0.5, -0.3]], 0.022, 0.016, FIXED.metal, { segs: 5, sides: 6 })));
  }
  // engine: crankcase, a finned barrel leaning forward, its head, a gear cover
  push(ball(0, 0.42, 0.05, 0.15, 0.14, 0.21, FIXED.engine));
  push(cyl(0, 0.64, 0.2, 0.07, 0.075, 0.26, FIXED.engine, [0.35, 0, 0]));
  for (let i = 0; i < 4; i++) push(cyl(0, 0.55 + i * 0.065 * 0.94, 0.16 + i * 0.065 * 0.34, 0.1, 0.1, 0.014, FIXED.metal, [0.35, 0, 0], 8));
  push(ball(0, 0.79, 0.265, 0.1, 0.06, 0.09, FIXED.engine, [0.35, 0, 0]));
  push(ball(0.15, 0.42, 0.05, 0.03, 0.1, 0.1, FIXED.metal, [0, 0, 0]));
  // the exhaust: a header out of the barrel, swept back to a tapered silencer
  push(part(sweep([[0.07, 0.74, 0.3], [0.12, 0.5, 0.4], [0.2, 0.34, 0.2], [0.2, 0.34, -0.1], [0.2, 0.4, -0.4]], 0.028, 0.034, FIXED.metal, { segs: 6 })));
  push(part(loft([
    { z: -0.98, x: 0.2, y: 0.5, rx: 0.012, ry: 0.012 },
    { z: -0.94, x: 0.2, y: 0.49, rx: 0.05, ry: 0.05 },
    { z: -0.7, x: 0.2, y: 0.45, rx: 0.062, ry: 0.062 },
    { z: -0.4, x: 0.2, y: 0.4, rx: 0.056, ry: 0.056 },
    { z: -0.36, x: 0.2, y: 0.4, rx: 0.02, ry: 0.02 },
  ], { around: 8, along: 6, paintAt: (q) => (q.u < 0.2 ? FIXED.dark : color(FIXED.metal)) })));
  // the tank, with a stripe of trim down its crown and a darker belly
  push(part(loft([
    { z: -0.2, y: 0.9, rx: 0.02, ry: 0.02 },
    { z: -0.12, y: 0.885, rx: 0.095, ry: 0.07 },
    { z: 0.04, y: 0.89, rx: 0.13, ry: 0.105 },
    { z: 0.22, y: 0.885, rx: 0.14, ry: 0.115 },
    { z: 0.38, y: 0.875, rx: 0.115, ry: 0.1 },
    { z: 0.5, y: 0.865, rx: 0.07, ry: 0.07 },
    { z: 0.55, y: 0.86, rx: 0.02, ry: 0.025 },
  ], { around: 14, along: 10, paintAt: stripe(body, trim, 0.02) })));
  // the seat, the tail cowl rising to a light
  push(part(loft([
    { z: -0.62, y: 0.935, rx: 0.02, ry: 0.015 },
    { z: -0.55, y: 0.935, rx: 0.1, ry: 0.035 },
    { z: -0.3, y: 0.935, rx: 0.14, ry: 0.045 },
    { z: -0.05, y: 0.94, rx: 0.12, ry: 0.04 },
    { z: 0.03, y: 0.94, rx: 0.02, ry: 0.02 },
  ], { around: 8, along: 6, paintAt: (q) => (q.sy < 0 ? FIXED.pants : q.cx > 0.7 || q.cx < -0.7 ? trim : color(FIXED.seat)) })));
  push(part(loft([
    { z: -0.96, y: 1.05, rx: 0.02, ry: 0.02 },
    { z: -0.9, y: 1.03, rx: 0.06, ry: 0.04 },
    { z: -0.74, y: 0.99, rx: 0.1, ry: 0.07 },
    { z: -0.56, y: 0.955, rx: 0.115, ry: 0.075 },
    { z: -0.44, y: 0.93, rx: 0.1, ry: 0.06 },
  ], { around: 10, along: 6, paintAt: stripe(body, trim, 0.016) })));
  push(ball(0, 1.045, -0.965, 0.045, 0.022, 0.02, FIXED.tail));
  // the rider's legs: thighs clamped on the tank, shins to the pegs, boots
  for (const s of [-1, 1]) {
    push(part(sweep([[s * 0.12, 0.94, -0.3], [s * 0.17, 0.86, -0.1], [s * 0.2, 0.8, 0.1]], 0.075, 0.055, FIXED.pants, { segs: 6, sides: 6 })));
    push(part(sweep([[s * 0.2, 0.8, 0.1], [s * 0.225, 0.62, 0.0], [s * 0.2, 0.48, -0.12]], 0.052, 0.04, FIXED.pants, { segs: 6, sides: 6 })));
    push(ball(s * 0.2, 0.8, 0.1, 0.058, 0.058, 0.058, FIXED.pants));
    push(ball(s * 0.2, 0.44, -0.07, 0.05, 0.045, 0.125, FIXED.boots));
    push(part(sweep([[s * 0.17, 0.42, -0.14], [s * 0.26, 0.42, -0.14]], 0.014, 0.014, FIXED.metal, { segs: 2, sides: 6 })));
  }
  const bodyGeometry = build(fixed);

  // ---- a wheel about its own axle: tyre, rim in trim, spokes, hub, disc
  const wheel = (disc) => {
    const p = [];
    const R = BIKE.wheel;
    const tyre = new THREE.TorusGeometry(R - 0.065, 0.065, 5, 22);
    tyre.rotateY(Math.PI / 2);
    tyre.scale(1.15, 1, 1);
    p.push({ geometry: tyre, color: color(FIXED.tyre) });
    const rim = new THREE.TorusGeometry(R - 0.115, 0.018, 4, 24);
    rim.rotateY(Math.PI / 2);
    p.push({ geometry: rim, color: trim });
    for (let i = 0; i < 6; i++) {
      const g = new THREE.CylinderGeometry(0.007, 0.007, R - 0.14, 3, 1);
      g.translate(0, (R - 0.14) / 2 + 0.03, 0);
      p.push({ geometry: g, matrix: M(0, 0, 0, 1, 1, 1, (i / 6) * Math.PI * 2, 0, 0), color: color(FIXED.metal) });
    }
    p.push(cyl(0, 0, 0, 0.052, 0.052, 0.13, FIXED.metal, [0, 0, Math.PI / 2], 10));
    p.push(cyl(0.065, 0, 0, 0.026, 0.026, 0.03, FIXED.dark, [0, 0, Math.PI / 2], 8));
    if (disc) p.push(cyl(0.06, 0, 0, 0.15, 0.15, 0.01, FIXED.metal, [0, 0, Math.PI / 2], 20));
    else p.push(cyl(-0.06, 0, 0, 0.085, 0.085, 0.012, FIXED.metal, [0, 0, Math.PI / 2], 14));
    return build(p);
  };

  // ---- the swingarm
  const swingParts = [];
  for (const s of [-1, 1]) swingParts.push(part(sweep([[s * 0.1, 0, 0], [s * 0.11, -0.04, -0.28], [s * 0.1, -0.07, -0.52]], 0.034, 0.024, FIXED.frame, { segs: 6, sides: 6 })));
  swingParts.push(part(sweep([[-0.1, -0.02, -0.1], [0, -0.02, -0.1], [0.1, -0.02, -0.1]], 0.03, 0.03, FIXED.frame, { segs: 3, sides: 6 })));
  swingParts.push(part(sweep([[0.13, -0.05, -0.45], [0.13, -0.06, -0.12], [0.13, 0.0, 0.0]], 0.012, 0.012, FIXED.dark, { segs: 4, sides: 4 })));
  const swingGeometry = build(swingParts);

  // ---- the fork, in a frame whose +y runs up the steering axis
  const stanch = [];
  for (const s of [-1, 1]) stanch.push(part(sweep([[s * 0.095, -0.01, 0], [s * 0.095, -0.4, 0]], 0.02, 0.02, FIXED.metal, { segs: 2, sides: 6 })));
  stanch.push(part(sweep([[-0.095, -0.02, 0], [0.095, -0.02, 0]], 0.03, 0.03, FIXED.dark, { segs: 3, sides: 6 })));
  stanch.push(part(sweep([[0, 0.08, 0], [0, -0.02, 0]], 0.028, 0.028, FIXED.dark, { segs: 2, sides: 6 })));
  // handlebar: swept back to the grips, rubber ends
  const bars = [];
  for (const s of [-1, 1]) {
    bars.push(part(sweep([[s * 0.01, 0.07, 0.01], [s * 0.18, 0.07, -0.01], [s * 0.3, 0.075, -0.07], [s * 0.35, 0.07, -0.11]], 0.012, 0.012, FIXED.metal, { segs: 8, sides: 6 })));
    bars.push(part(sweep([[s * 0.31, 0.075, -0.075], [s * 0.37, 0.07, -0.115]], 0.019, 0.019, FIXED.glove, { segs: 2, sides: 6 })));
    bars.push(part(sweep([[s * 0.24, 0.08, 0.0], [s * 0.3, 0.17, 0.04]], 0.007, 0.007, FIXED.metal, { segs: 3, sides: 5 })));
    bars.push(ball(s * 0.3, 0.18, 0.05, 0.05, 0.03, 0.012, FIXED.dark, [0.4, s * 0.3, 0]));
  }
  // bikini fairing about the lamp, its screen, the lamp itself
  const fairing = loft([
    { z: -0.03, x: 0, y: -0.05, rx: 0.02, ry: 0.02 },
    { z: 0.02, y: -0.06, rx: 0.13, ry: 0.12 },
    { z: 0.14, y: -0.08, rx: 0.14, ry: 0.13 },
    { z: 0.24, y: -0.1, rx: 0.105, ry: 0.1 },
    { z: 0.285, y: -0.1, rx: 0.03, ry: 0.03 },
  ], { around: 12, along: 6, paintAt: stripe(body, trim, 0.016) });
  stanch.push(part(fairing));
  stanch.push(ball(0, -0.1, 0.268, 0.082, 0.082, 0.045, FIXED.lens));
  stanch.push(ball(0, 0.13, 0.08, 0.1, 0.1, 0.012, FIXED.screen, [-0.62, 0, 0]));
  const steerGeometry = build([...stanch, ...bars]);
  // lower legs, the axle, a caliper and the fender that rides with them
  const lowers = [];
  for (const s of [-1, 1]) {
    lowers.push(part(sweep([[s * 0.095, -0.36, 0], [s * 0.095, -FORK, 0]], 0.028, 0.024, FIXED.dark, { segs: 3, sides: 6 })));
    lowers.push(cyl(s * 0.1, -FORK, 0, 0.03, 0.03, 0.03, FIXED.metal, [0, 0, Math.PI / 2], 8));
  }
  lowers.push(cyl(0.085, -FORK + 0.12, 0.05, 0.026, 0.026, 0.07, body, [Math.PI / 2, 0, 0], 8));
  const arc = [];
  for (let i = 0; i <= 8; i++) {
    const a = 0.45 + (i / 8) * 2.4;
    arc.push([0, -FORK + Math.sin(a) * (BIKE.wheel + 0.05), -Math.cos(a) * (BIKE.wheel + 0.05)]);
  }
  lowers.push(part(sweep(arc, 0.014, 0.014, body, { segs: 10, sides: 6, wide: 4.2 })));
  const lowerGeometry = build(lowers);

  // ---- the rider: torso and head and arms in the rider's frame, origin at the pelvis
  const lean = 38 * (Math.PI / 180);
  const torso = loft([
    { z: -0.04, y: 0, rx: 0.14, ry: 0.1 },
    { z: 0.08, y: 0, rx: 0.15, ry: 0.115 },
    { z: 0.26, y: 0.005, rx: 0.145, ry: 0.12 },
    { z: 0.4, y: 0.005, rx: 0.19, ry: 0.13 },
    { z: 0.5, y: 0.0, rx: 0.17, ry: 0.11 },
    { z: 0.55, y: 0.0, rx: 0.06, ry: 0.06 },
  ], { around: 12, along: 8, paintAt: (q) => (q.u > 0.55 && q.u < 0.7 && q.sy > 0.3 ? trim : color(FIXED.jacket)) });
  torso.rotateX(-lean);
  const riderParts = [part(torso), ball(0, -0.01, -0.02, 0.15, 0.1, 0.12, FIXED.pants)];
  for (const s of [-1, 1]) riderParts.push(ball(s * SHOULDER[0], SHOULDER[1], SHOULDER[2], 0.062, 0.062, 0.062, FIXED.jacket));
  riderParts.push(part(sweep([[0, 0.31, 0.4], [0, 0.35, 0.44]], 0.05, 0.045, FIXED.glove, { segs: 2, sides: 6 })));
  const riderGeometry = build(riderParts);

  const helmet = loft([
    { z: -0.17, y: 0.0, rx: 0.02, ry: 0.02 },
    { z: -0.13, y: 0.01, rx: 0.1, ry: 0.11 },
    { z: -0.02, y: 0.02, rx: 0.135, ry: 0.15 },
    { z: 0.1, y: 0.0, rx: 0.13, ry: 0.14 },
    { z: 0.18, y: -0.03, rx: 0.095, ry: 0.1 },
    { z: 0.215, y: -0.05, rx: 0.03, ry: 0.04 },
  ], {
    around: 12,
    along: 8,
    paintAt: (q) => {
      if (q.z > 0.04 && q.sy > -0.35 && q.sy < 0.42 && Math.abs(q.cx) < 0.88) return color(FIXED.visor);
      if (q.sy > 0.6 && Math.abs(q.x) < 0.02) return trim;
      return body;
    },
  });
  const headGeometry = build([part(helmet)]);

  // an arm bone along +y: a sleeve tapering toward the wrist, a glove on the forearm
  const upperArm = build([part(sweep([[0, 0, 0], [0, ARM, 0]], 0.052, 0.042, FIXED.jacket, { segs: 2, sides: 6 })), ball(0, ARM, 0, 0.046, 0.046, 0.046, FIXED.jacket)]);
  const foreArm = build([part(sweep([[0, 0, 0], [0, ARM, 0]], 0.042, 0.032, FIXED.jacket, { segs: 2, sides: 6 })), ball(0, ARM + 0.02, 0, 0.04, 0.05, 0.04, FIXED.glove)]);

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
      { id: 'rider', parent: null, at: [0, 0.98, -0.28], geometry: riderGeometry },
      { id: 'head', parent: 'rider', at: [0, 0.37 + 0.09, 0.47 - 0.02], geometry: headGeometry },
      { id: 'armL', parent: 'rider', at: [SHOULDER[0], SHOULDER[1], SHOULDER[2]], geometry: upperArm },
      { id: 'foreL', parent: 'armL', at: [0, ARM, 0], geometry: foreArm },
      { id: 'armR', parent: 'rider', at: [-SHOULDER[0], SHOULDER[1], SHOULDER[2]], geometry: upperArm },
      { id: 'foreR', parent: 'armR', at: [0, ARM, 0], geometry: foreArm },
    ],
  };
}

// Where each hand takes the bar, in the steering frame.
const GRIP = [0.355, 0.07, -0.1];
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
  rig.rider.rotation.set(Math.sin(t * 1.3) * 0.012 + bump * 1.2, yawRate * 0.12, -lean * 0.3);
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

// The corner control's tile: the logo's silhouette in a paint.
export function bikeTile(paint) {
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');
  const body = hex(paint.body),
    trim = hex(paint.trim);
  return `<svg viewBox="0 0 120 64" aria-hidden="true">
<g fill="none" stroke="#2f2e2c" stroke-width="6"><circle cx="26" cy="45" r="13"/><circle cx="94" cy="45" r="13"/></g>
<g fill="${trim}"><circle cx="26" cy="45" r="4"/><circle cx="94" cy="45" r="4"/></g>
<g stroke="#3a3936" stroke-width="3.2" stroke-linecap="round"><path d="M26 45 L50 37"/><path d="M94 45 L84 20"/><path d="M80 15 L86 9"/></g>
<rect x="45" y="33" width="27" height="12" rx="3" fill="#45433f"/>
<path d="M8 17 L36 23 L44 31 L22 29 Z" fill="${body}"/>
<path d="M22 22.5 L44 25.5" stroke="#34312e" stroke-width="4" stroke-linecap="round"/>
<path d="M40 27 Q58 9 78 20 L85 31 L44 32 Z" fill="${body}"/>
<path d="M44 29 Q60 27 84 29" stroke="${trim}" stroke-width="2.2" fill="none"/>
<path d="M80 13 Q93 15 95 30 L84 30 Z" fill="${body}"/>
</svg>`;
}
