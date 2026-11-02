import { defineBiome } from '../contract.js';

// The hot coast: coconut groves over pale grass, banana by the houses, the
// sea a shore's width off the road. Where the road starts most mornings.
// climate is temperature, moisture, region, each 0..1; colors are swatch
// names or hex values inside the swatch envelope; species and props are
// relative weights by id; sites is how welcome the old builders were here.
export default defineBiome({
  id: 'coast',
  name: 'Coconut coast',
  climate: [0.78, 0.5, 0.5],
  ground: {
    base: 'coastGrass',
    alt: 'sandGrass',
    rock: 'rockVolcanic',
  },
  species: {
    coconut: 1,
    banana: 0.25,
    mango: 0.12,
  },
  density: 0.9,
  grass: {
    tint: 'grassGold',
    density: 0.7,
  },
  props: {
    hut: 0.5,
    boulders: 0.05,
  },
  sites: 1.2,
});
