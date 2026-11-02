import { defineBiome } from '../contract.js';

// The plateau's pineapple fields: blue-green rows on red earth, each field
// ploughed its own way, some freshly cleared, a rain tree left standing here
// and there for shade.
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
    raintree: 1,
  },
  density: 0.08,
  grass: {
    tint: 'grassCool',
    density: 0.2,
  },
  props: {
    hut: 0.15,
  },
  sites: 0.4,
});
