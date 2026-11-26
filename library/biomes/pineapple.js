import { defineBiome } from '../contract.js';

// The plateau's pineapple fields: deep green rows on red earth, each field
// ploughed its own way, some freshly cleared, rain trees and mango left
// standing for shade.
export default defineBiome({
  id: 'pineapple',
  name: 'Pineapple plateau',
  climate: [0.32, 0.3, 0.42],
  ground: {
    base: 'pineapple',
    alt: 'pineappleDeep',
    rock: 'soilRed',
    pattern: 'rows',
    field: 'soilRed',
  },
  species: {
    raintree: 0.7,
    mango: 0.4,
  },
  density: 0.4,
  grass: {
    tint: 'grassCool',
    density: 0.2,
  },
  props: {
    hut: 0.15,
  },
  sites: 0.4,
});
