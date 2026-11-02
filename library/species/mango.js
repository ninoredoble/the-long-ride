import { defineSpecies } from '../contract.js';

// The mango: a short stout trunk under a dense, dark, rounded crown.
// This entry is data for the built-in tree kit: a trunk, limbs, and a crown
// shape (dome, cone, fan or bare) of painted cards.
export default defineSpecies({
  id: 'mango',
  name: 'mango',
  trunk: {
    height: 4.6,
    radius: 0.75,
    lean: 0.3,
    tint: 'barkDark',
  },
  limbs: {
    count: 6,
    spread: 4.6,
    rise: 8,
    from: 0.55,
  },
  crown: {
    shape: 'dome',
    cards: 30,
    size: 3.6,
    radius: 4.4,
    height: 3.4,
  },
  leaf: 'mango',
  tint: {
    cold: 'canopyDusk',
    warm: 'white',
    dry: 'canopyDusk',
  },
  scale: [1.1, 1.8],
});
