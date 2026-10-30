import { defineBiome } from '../contract.js';

// The cool highlands: tall pines over short green grass, mist in the
// mornings, the clouds close overhead.
export default defineBiome({
  id: 'pines',
  name: 'Highland pines',
  climate: [0.08, 0.5, 0.5],
  ground: {
    base: 'highland',
    alt: 'forest',
    rock: 'rockCold',
  },
  species: {
    pine: 1,
  },
  density: 0.9,
  grass: {
    tint: 'grassCool',
    density: 0.9,
  },
  props: {
    boulders: 0.15,
  },
  sites: 0.7,
});
