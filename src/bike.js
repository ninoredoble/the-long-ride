// The bike kit: the GNEGR motorcycle and its rider, drawn after the logo - two
// big wheels with thick tyres, a domed tank, a short upswept tail, a small
// fairing and screen over the fork, the engine block slung under the tank.
// buildBike lays out vertex-colored geometry only, in the colors of a paint
// from library/paints/; the engine makes the meshes, lights them with its own
// soft material and drives them with animateBike. Lengths are meters; the bike
// faces +z, and its origin is on the ground between the tyres, so a lean
// rolls it about the line the tyres touch.

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
  metal: 0x8d8f8c,
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
  skin: 0x9c7458,
};

export function buildBike(paint, kit) {
  const { THREE, merge, M } = kit;
  const parts = [],
    color = (c) => new THREE.Color(c);
  const body = color(paint.body),
    trim = color(paint.trim);
  const add = (geometry, c, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
    parts.push({ geometry, matrix: M(x, y, z, sx, sy, sz, rx, ry, rz), color: c instanceof THREE.Color ? c : color(c) });
  // a round tube between two points
  const tube = (a, b, r, c, sides = 8) => {
    const from = new THREE.Vector3(...a),
      to = new THREE.Vector3(...b),
      len = from.distanceTo(to);
    const g = new THREE.CylinderGeometry(r, r, len, sides, 1);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
    g.translate(from.x, from.y, from.z);
    parts.push({ geometry: g, color: color(c) });
  };
  const sym = (fn) => [-1, 1].forEach(fn);

  // the frame, the swingarm and the fork
  tube([0, 0.97, 0.47], [0, 0.55, -0.12], 0.045, FIXED.frame);
  tube([0, 0.86, 0.36], [0, 0.88, -0.48], 0.035, FIXED.frame);
  sym((s) => tube([s * 0.1, 0.48, -0.1], [s * 0.1, BIKE.wheel, BIKE.rear], 0.035, FIXED.frame));
  sym((s) => tube([s * 0.095, BIKE.wheel, BIKE.front], [s * 0.095, 1.0, 0.47], 0.03, FIXED.metal));
  // the engine under the tank, with cooling fins and the exhaust along the right
  add(new THREE.BoxGeometry(0.34, 0.34, 0.5), FIXED.engine, 0, 0.5, 0.1);
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.38, 0.025, 0.3), FIXED.metal, 0, 0.62 + i * 0.045, 0.2, 1, 1, 1, -0.35, 0, 0);
  add(new THREE.CylinderGeometry(0.16, 0.16, 0.36, 12), FIXED.engine, 0, 0.36, 0.0, 1, 1, 1, 0, 0, Math.PI / 2);
  tube([0.12, 0.34, 0.25], [0.18, 0.36, -0.2], 0.035, FIXED.metal);
  tube([0.18, 0.36, -0.2], [0.2, 0.55, -0.72], 0.055, FIXED.metal, 10);
  // the domed tank with a stripe of trim, the side panel under it
  add(new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), body, 0, 0.84, 0.17, 0.24, 0.24, 0.33);
  add(new THREE.SphereGeometry(1, 18, 4, 0, Math.PI * 2, Math.PI * 0.6, Math.PI * 0.05), trim, 0, 0.84, 0.17, 0.245, 0.24, 0.335);
  add(new THREE.BoxGeometry(0.3, 0.17, 0.52), body, 0, 0.74, 0.0);
  // the seat and the short upswept tail with its light
  add(new THREE.BoxGeometry(0.27, 0.08, 0.5), FIXED.seat, 0, 0.93, -0.3, 1, 1, 1, -0.06, 0, 0);
  add(new THREE.BoxGeometry(0.26, 0.04, 0.52), trim, 0, 0.885, -0.3, 1, 1, 1, -0.06, 0, 0);
  add(new THREE.BoxGeometry(0.24, 0.13, 0.5), body, 0, 0.95, -0.64, 1, 1, 1, -0.28, 0, 0);
  add(new THREE.BoxGeometry(0.14, 0.05, 0.05), FIXED.tail, 0, 1.03, -0.9, 1, 1, 1, -0.28, 0, 0);
  // the fairing, its screen and the lamp; the bars and the mirrors
  add(new THREE.BoxGeometry(0.34, 0.3, 0.22), body, 0, 1.0, 0.58, 1, 1, 1, -0.45, 0, 0);
  add(new THREE.BoxGeometry(0.28, 0.24, 0.015), FIXED.screen, 0, 1.2, 0.56, 1, 1, 1, -0.75, 0, 0);
  add(new THREE.CylinderGeometry(0.07, 0.08, 0.06, 12), FIXED.lens, 0, 0.98, 0.7, 1, 1, 1, Math.PI / 2 - 0.45, 0, 0);
  tube([-0.33, 1.08, 0.4], [0.33, 1.08, 0.4], 0.016, FIXED.frame);
  sym((s) => tube([s * 0.25, 1.08, 0.42], [s * 0.3, 1.24, 0.47], 0.01, FIXED.frame));
  sym((s) => add(new THREE.BoxGeometry(0.1, 0.06, 0.02), FIXED.frame, s * 0.31, 1.26, 0.47));
  // the front fender, and the pegs
  add(new THREE.TorusGeometry(BIKE.wheel + 0.05, 0.05, 4, 10, Math.PI * 0.45), body, 0, BIKE.wheel, BIKE.front, 1, 1, 1.4, 0, Math.PI / 2, Math.PI * 0.32);
  sym((s) => tube([s * 0.12, 0.38, -0.12], [s * 0.24, 0.38, -0.12], 0.018, FIXED.metal));

  // the rider, tucked in a little, helmet in the bike's own paint
  add(new THREE.BoxGeometry(0.33, 0.17, 0.26), FIXED.pants, 0, 1.0, -0.24);
  add(new THREE.BoxGeometry(0.36, 0.5, 0.24), FIXED.jacket, 0, 1.25, -0.1, 1, 1, 1, 0.55, 0, 0);
  add(new THREE.BoxGeometry(0.2, 0.06, 0.18), FIXED.jacket, 0, 1.44, 0.04, 1, 1, 1, 0.55, 0, 0);
  add(new THREE.SphereGeometry(0.15, 14, 10), body, 0, 1.57, 0.11, 1, 1.05, 1.12);
  add(new THREE.SphereGeometry(0.152, 12, 6, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.32, Math.PI * 0.28), FIXED.visor, 0, 1.57, 0.11, 1, 1.05, 1.12);
  add(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 8), FIXED.skin, 0, 1.43, 0.06);
  sym((s) => {
    tube([s * 0.19, 1.43, 0.02], [s * 0.25, 1.24, 0.22], 0.05, FIXED.jacket);
    tube([s * 0.25, 1.24, 0.22], [s * 0.28, 1.09, 0.4], 0.042, FIXED.jacket);
    tube([s * 0.13, 1.0, -0.22], [s * 0.2, 0.86, 0.12], 0.07, FIXED.pants);
    tube([s * 0.2, 0.86, 0.12], [s * 0.18, 0.45, -0.1], 0.055, FIXED.pants);
    add(new THREE.BoxGeometry(0.09, 0.09, 0.22), FIXED.boots, s * 0.18, 0.42, -0.06);
  });
  const bodyGeometry = merge(parts);
  for (const part of parts) part.geometry.dispose();

  // a wheel: the tyre, the rim and its three split spokes in trim, the hub
  // and, in front, the brake disc; built about its own axle, spun by the engine
  const wheel = (disc) => {
    const p = [];
    const put = (geometry, c, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) =>
      p.push({ geometry, matrix: M(x, y, z, 1, 1, 1, rx, ry, rz), color: c instanceof THREE.Color ? c : color(c) });
    put(new THREE.TorusGeometry(BIKE.wheel - 0.07, 0.07, 8, 28), FIXED.tyre, 0, 0, 0, 0, Math.PI / 2, 0);
    put(new THREE.TorusGeometry(BIKE.wheel - 0.13, 0.018, 5, 28), trim, 0, 0, 0, 0, Math.PI / 2, 0);
    put(new THREE.CylinderGeometry(0.055, 0.055, 0.14, 10), FIXED.metal, 0, 0, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 3; i++)
      for (const split of [-0.12, 0.12]) {
        const a = (i / 3) * Math.PI * 2 + split;
        const g = new THREE.BoxGeometry(0.02, BIKE.wheel - 0.16, 0.025);
        g.translate(0, (BIKE.wheel - 0.16) / 2 + 0.03, 0);
        put(g, trim, 0, 0, 0, a, 0, 0);
      }
    if (disc) put(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 18), FIXED.metal, 0.07, 0, 0, 0, 0, Math.PI / 2);
    const g = merge(p);
    for (const part of p) part.geometry.dispose();
    return g;
  };
  return {
    body: bodyGeometry,
    wheels: [
      { geometry: wheel(true), at: [0, BIKE.wheel, BIKE.front] },
      { geometry: wheel(false), at: [0, BIKE.wheel, BIKE.rear] },
    ],
  };
}

// Spin the wheels by the distance ridden.
export function animateBike(group, distance) {
  for (const wheel of group.userData.wheels ?? []) wheel.rotation.x = (distance / BIKE.wheel) % (Math.PI * 2);
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
