import { defineSpecies } from '../contract.js';

// The banana: a short soft stem and a loose fan of broad paddle leaves.
export default defineSpecies({
  id: 'banana',
  name: 'banana',
  trunk: {
    height: 3.2,
    radius: 0.22,
    lean: 0.25,
    tint: 'barkBanana',
  },
  limbs: {
    count: 0,
  },
  crown: {
    shape: 'fan',
    cards: 9,
    size: 3.6,
    radius: 2,
    height: 1.2,
  },
  leaf: 'banana',
  tint: {
    cold: 'canopyCold',
    warm: 'white',
    dry: 'canopyDry',
  },
  scale: [0.9, 1.4],
});
