import { defineBiome } from '../contract.js';

// Rice terraces: paddies stepped along the contours, some flooded and holding
// the sky, some green, some gold, with groves of coconut, mango, rain tree
// and banana between them.
// On gentle ground the paddies are wide; on slopes they crowd into terraces.
export default defineBiome({
  id: 'paddies',
  name: 'Rice terraces',
  climate: [0.6, 0.78, 0.35],
  ground: {
    base: 'paddy',
    alt: 'paddyGold',
    rock: 'rock',
    pattern: 'terraces',
    field: 'paddyWater',
  },
  species: {
    coconut: 0.6,
    banana: 0.35,
    mango: 0.5,
    raintree: 0.3,
  },
  density: 0.6,
  grass: {
    tint: 'grassCool',
    density: 0.3,
  },
  props: {
    hut: 0.35,
  },
  sites: 0.6,
});
