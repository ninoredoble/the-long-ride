import { defineProp } from '../contract.js';

// The bahay kubo: a bamboo house on stilts under a steep thatched roof, a
// short ladder to its door. Found beside the road, door turned toward it, in
// the farm and coast country; never on steep ground.
export default defineProp({
  id: 'hut',
  name: 'bahay kubo',
  budget: { instances: 120, triangles: 900 },
  obstacle: { radius: 3, height: 5 },
  bake(kit) {
    const { THREE } = kit,
      parts = [];
    const add = (geometry, color, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
      parts.push({ geometry, matrix: kit.matrix(x, y, z, sx, sy, sz, rx, ry, rz), color: kit.color(color) });
    for (const [x, z] of [[-1.4, -1.1], [1.4, -1.1], [-1.4, 1.1], [1.4, 1.1]])
      add(new THREE.CylinderGeometry(0.09, 0.11, 1.5, 6), 'barkDark', x, 0.6, z);
    add(new THREE.BoxGeometry(3.3, 0.16, 2.7), 'barkWarm', 0, 1.32, 0);
    add(new THREE.BoxGeometry(3.0, 1.7, 2.4), 'bamboo', 0, 2.25, 0);
    // the door and a window, dark openings in the woven walls
    add(new THREE.BoxGeometry(0.8, 1.25, 0.06), 'stoneDark', 0.55, 2.05, 1.21);
    add(new THREE.BoxGeometry(0.75, 0.55, 0.06), 'stoneDark', -0.8, 2.45, 1.21);
    add(new THREE.BoxGeometry(0.06, 0.55, 0.75), 'stoneDark', 1.51, 2.45, 0);
    // a ladder to the door
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.9, 0.06, 0.22), 'barkWarm', 0.55, 0.35 + i * 0.36, 1.75 - i * 0.18);
    // the roof: a steep hip of nipa thatch with a low eave all round
    const roof = new THREE.ConeGeometry(2.55, 2.1, 4, 1);
    add(roof, 'thatch', 0, 4.12, 0, 1.3, 1, 1.12, 0, Math.PI / 4, 0);
    add(new THREE.BoxGeometry(0.12, 0.2, 2.9), 'thatch', 0, 5.2, 0);
    return kit.merge(parts);
  },
  place(cell, kit) {
    // only along the road, a little back from it, door toward it
    if (cell.road(cell.x, cell.z) > 140) return [];
    if (cell.roll() > cell.mix('hut') * 0.55) return [];
    const x = cell.corner.x + cell.roll() * cell.size,
      z = cell.corner.z + cell.roll() * cell.size;
    const d = cell.roadSide(x, z);
    if (Math.abs(d) < 16 || Math.abs(d) > 46 || !cell.land(x, z) || cell.slope(x, z) > 0.22) return [];
    const h = cell.roadHeading(z),
      yaw = d > 0 ? Math.atan2(-Math.cos(h), Math.sin(h)) : Math.atan2(Math.cos(h), -Math.sin(h));
    return [{ x, z, yaw: yaw + (cell.roll() - 0.5) * 0.3, scale: 0.9 + cell.roll() * 0.25, sink: 0.15 }];
  },
});
