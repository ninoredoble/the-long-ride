import { defineSite } from '../contract.js';

// The shell of an old stone church: the facade with its arched door and
// a stepped gable still standing, the nave walls broken to shoulder height,
// the belfry a stump. Grass grows where the floor was.
export default defineSite({
  id: 'church',
  name: 'church ruin',
  odds: 0.8,
  slope: 0.1,
  hill: false,
  footprint: 24,
  build(kit) {
    // the facade, +z, around a doorway
    kit.block(-3.6, 4.2, 9, 4.2, 8.4, 1.3, 0, 0.02);
    kit.block(3.6, 4.2, 9, 4.2, 8.4, 1.3, 0, 0.02);
    kit.block(0, 7.4, 9, 3.2, 2.0, 1.3, 0, 0.02);
    kit.block(0, 9.3, 9, 8.0, 1.8, 1.2, 0, 0.03);
    kit.block(0, 10.9, 9, 4.6, 1.5, 1.1, 0, 0.03);
    kit.block(0, 12.2, 9, 1.6, 1.2, 1.0, 0, 0.03);
    // the nave: two long walls, broken
    for (const side of [-1, 1])
      for (let i = 0; i < 4; i++) {
        const height = 2 + kit.random() * 4.5;
        if (kit.random() < 0.15) continue;
        kit.block(side * 5.2, height / 2 - 0.3, 5.5 - i * 4.6, 1.1, height, 4.3, 0, 0.05);
      }
    // the apse wall and the belfry's stump at the back
    kit.block(0, 1.6, -11, 9, 3.4, 1.1, 0, 0.05);
    kit.block(7.6, 2.6, -8.5, 3.4, 5.6, 3.4, 0, 0.04);
    kit.fallen(2.5, 2, 2.2, 0.5);
    kit.fallen(-2.8, -4.5, 1.8, 0.45);
  },
});
