import { defineBiome } from '../contract.js';

// Open cogon hills: rolling grassland gone gold in patches, a few rain trees
// and mango on the ridges, stones in the grass.
export default defineBiome({
  id: 'pasture',
  name: 'Cogon hills',
  climate: [0.3, 0.35, 0.85],
  ground: {
    base: 'cogon',
    alt: 'meadow',
    rock: 'rock',
  },
  species: {
    raintree: 0.7,
    mango: 0.4,
    pine: 0.2,
  },
  density: 0.25,
  grass: {
    tint: 'grassGold',
    density: 1,
  },
  props: {
    boulders: 0.3,
    hut: 0.1,
  },
  sites: 1,
});
