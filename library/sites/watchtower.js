import { defineSite } from '../contract.js';

// A baluarte: one of the old coral-stone watchtowers raised along the coast
// against raiders, six-sided and tapering, its parapet half fallen, a doorway
// at the foot. It stands on a rise and faces the sunrise, toward the sea.
export default defineSite({
  id: 'watchtower',
  name: 'watchtower',
  odds: 1.2,
  slope: 0.18,
  hill: true,
  footprint: 9,
  sunward: true,
  build(kit) {
    const { THREE } = kit;
    const tower = new THREE.CylinderGeometry(2.9, 3.6, 8.5, 6, 2);
    tower.translate(0, 4.0, 0);
    kit.raw(tower, 0, 0, 0, Math.PI / 6);
    kit.block(0, 1.2, 3.25, 1.3, 2.2, 0.5, 0, 0.02);
    // the parapet: merlons on every other face, some gone
    for (let i = 0; i < 12; i++) {
      if (kit.random() < 0.3) continue;
      const a = (i / 12) * Math.PI * 2;
      kit.block(Math.sin(a) * 2.7, 8.7, Math.cos(a) * 2.7, 1.0, 1.1, 0.55, a, 0.04);
    }
    kit.block(0, 8.2, 0, 5.6, 0.4, 5.6, 0, 0.02);
    kit.fallen(4.6, -2.2, 1.6, 0.45);
    kit.fallen(-3.8, 3.4, 1.2, 0.4);
  },
});
