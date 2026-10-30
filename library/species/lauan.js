import { defineSpecies } from '../contract.js';

// The lauan: a tall straight pale trunk that branches only near the top, a
// high broad crown over the forest roof.
export default defineSpecies({
  id: 'lauan',
  name: 'lauan',
  trunk: {
    height: 17,
    radius: 0.85,
    lean: 0.25,
    tint: 'barkPale',
  },
  limbs: {
    count: 5,
    spread: 5.5,
    rise: 20,
    from: 0.82,
  },
  crown: {
    shape: 'dome',
    cards: 32,
    size: 4.2,
    radius: 5.2,
    height: 2.6,
  },
  leaf: 'broad',
  tint: {
    cold: 'canopyDusk',
    warm: 'white',
    dry: 'canopyDry',
  },
  scale: [1.2, 2.0],
});
