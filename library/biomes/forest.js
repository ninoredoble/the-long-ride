import { defineBiome } from '../contract.js';

// The wet forest of the foothills: tall lauan over rain trees and mango,
// banana in the clearings, the deepest greens, thick undergrowth.
export default defineBiome({
  id: 'forest',
  name: 'Lowland forest',
  climate: [0.5, 0.85, 0.72],
  ground: {
    base: 'jungleDeep',
    alt: 'jungle',
    rock: 'rockVolcanic',
  },
  species: {
    lauan: 1,
    raintree: 0.4,
    mango: 0.4,
    banana: 0.3,
  },
  density: 1.35,
  grass: {
    tint: 'white',
    density: 0.85,
  },
  props: {
    boulders: 0.2,
  },
  sites: 0.8,
});
