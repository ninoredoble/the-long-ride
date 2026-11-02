import { defineSpecies } from '../contract.js';

// The rain tree: a short trunk, long spreading limbs and a wide flat umbrella
// of fine leaves, the shade tree of every field and road.
export default defineSpecies({
  id: 'raintree',
  name: 'rain tree',
  trunk: {
    height: 5,
    radius: 0.7,
    lean: 0.6,
    tint: 'barkWarm',
  },
  limbs: {
    count: 6,
    spread: 8,
    rise: 7.6,
    from: 0.55,
  },
  crown: {
    shape: 'dome',
    cards: 30,
    size: 4,
    radius: 6,
    height: 1.3,
  },
  leaf: 'raintree',
  tint: {
    cold: 'canopyCold',
    warm: 'white',
    dry: 'canopyDry',
  },
  scale: [1.1, 2.0],
});
