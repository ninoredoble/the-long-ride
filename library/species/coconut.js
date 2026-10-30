import { defineSpecies } from '../contract.js';

// The coconut palm: a tall, leaning, slender trunk and a fan of long fronds.
// This entry is data for the built-in tree kit: a trunk, limbs, and a crown
// shape (dome, cone, fan or bare) of painted cards. A species may instead
// give bake(kit) and grow its wood parts and cards any way it likes; see
// CONTRIBUTING.md.
export default defineSpecies({
  id: 'coconut',
  name: 'coconut palm',
  trunk: {
    height: 14,
    radius: 0.42,
    lean: 2.2,
    tint: 'barkPale',
  },
  limbs: {
    count: 0,
  },
  crown: {
    shape: 'fan',
    cards: 14,
    size: 7.8,
    radius: 4.2,
    height: 1.5,
  },
  leaf: 'frond',
  tint: {
    cold: 'canopyCold',
    warm: 'white',
    dry: 'canopyDry',
  },
  scale: [1.0, 1.7],
});
