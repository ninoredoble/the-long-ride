// The scenery contract. Everything a contributed file may say, and the rules
// that keep the world one world. Entries are plain objects returned by the
// define* helpers below; the engine bakes and places them, and owns light,
// sky, fog, streaming, the crown morph, shadows and budgets. Contributions
// never make materials, lights or shaders: kits build geometry, colors go
// through the swatch book, and validateLibrary refuses anything outside the
// contract by entry name when the page loads.

import { Color, SRGBColorSpace, LinearSRGBColorSpace } from 'three';

// ---------------------------------------------------------------------------
// The swatch book. Every color in the world is one of these, or a hex value
// inside their envelope: no neon, no pitch black, no pure white ground.
// ---------------------------------------------------------------------------
export const SWATCH = {
  // ground
  meadow: 0x7caa48,
  forest: 0x618a43,
  mossDeep: 0x4f7a3e,
  steppe: 0x9aa658,
  gold: 0xb9a95a,
  ochre: 0xb4aa6b,
  sandPale: 0xd2c99a,
  terracotta: 0xb07a5c,
  clay: 0xc19a72,
  moor: 0x7f8a6a,
  heather: 0x8f7d86,
  tundra: 0x90997a,
  frost: 0xbcc6bf,
  snow: 0xf6f4ee,
  jungle: 0x5e8d49,
  jungleDeep: 0x4c7d44,
  amber: 0xb8a457,
  leafLitter: 0xa58f55,
  paleGreen: 0x9db668,
  coastGrass: 0x95b25c,
  sandGrass: 0xb8b67c,
  paddy: 0x8cbb4c,
  paddyGold: 0xc0b25a,
  paddyWater: 0x86aea6,
  pineapple: 0x7f9c7c,
  pineappleDeep: 0x6c8d70,
  soilRed: 0xa06a4e,
  cogon: 0xb2ad66,
  highland: 0x6f9a52,
  // rock and stone
  rock: 0x8a9179,
  rockCold: 0x7b8a88,
  rockRed: 0x9a6f5a,
  rockPale: 0xa8a48e,
  rockVolcanic: 0x77746a,
  stoneWarm: 0xa59c86,
  stoneCool: 0x8f948c,
  stoneDark: 0x6f6e64,
  moss: 0x6c8a4a,
  // bark and canopy tints (multiplied over the painted textures)
  white: 0xffffff,
  canopyCold: 0xd0dfce,
  canopyDry: 0xe7dbac,
  canopyDusk: 0xb9c6b0,
  barkPale: 0xd8d3c4,
  barkDark: 0x8a7a68,
  barkWarm: 0xb39a74,
  barkBanana: 0xb8c08a,
  bamboo: 0xc2a76f,
  thatch: 0x947a52,
  grassCool: 0xd6e2cc,
  grassGold: 0xe3d9a6,
};

// Painted leaves: three dark, three mid and one light tone per palette, and
// the form the card is painted in: broad leaves, needle bundles, palm
// fronds, banana blades or blossom petals.
export const LEAVES = {
  broad: { form: 'broad', dark: ['#477335', '#527c32', '#65853d'], mid: ['#7ca343', '#8aae51', '#719943'], light: '#acc76b' },
  elder: { form: 'broad', dark: ['#2f5a33', '#3a6539', '#345f38'], mid: ['#4f7d42', '#5a8a4b', '#4a7a44'], light: '#7fa564' },
  needle: { form: 'needle', dark: ['#2f5a45', '#35624a', '#3d6b4e'], mid: ['#4d7d5e', '#5a8a68', '#527f5c'], light: '#7fa889' },
  mango: { form: 'broad', dark: ['#2c5530', '#335d35', '#2f5832'], mid: ['#467542', '#4f7f48', '#447240'], light: '#76a05c' },
  raintree: { form: 'broad', dark: ['#4f7436', '#587d3a', '#4b6f35'], mid: ['#7c9c46', '#88a84e', '#7f9f48'], light: '#aec46a' },
  frond: { form: 'frond', dark: ['#3f7a3f', '#467f44', '#3c7440'], mid: ['#5c9a4c', '#6aa653', '#609e4e'], light: '#9cc66a' },
  banana: { form: 'blade', dark: ['#4b8a3c', '#559343', '#4a843b'], mid: ['#6fac4f', '#7bb657', '#73ae52'], light: '#a6cf72' },
};

// The envelope of the soft illustrated family, in HSL.
export const ENVELOPE = { maxSaturation: 0.62, minLightness: 0.18, maxLightness: 0.93 };

// Budgets the engine enforces, per entry.
export const BUDGET = {
  crownCards: 200, // painted cards per tree
  propTriangles: 6000, // one baked prop or site type
  propInstances: 2000, // instances of one prop kind in the streamed ring
  siteInstances: 8, // instances of one site type in the ring
  speciesScale: 3, // largest tree scale
  birdTriangles: 4000, // one baked bird kind, body and wings together
  birdSpan: 12, // widest wingspan, meters, after the kind's scale
  birdBeat: 15, // fastest wingbeat, radians per second
};

/** A swatch name resolved to a hex color; a hex value passes through. */
export const swatchColor = (value) => (typeof value === 'string' ? SWATCH[value] : value);

const hsl = {};
/** Why a color is refused, or null when it is inside the envelope. */
export function colorProblem(value) {
  if (typeof value === 'string') return value in SWATCH ? null : `unknown swatch "${value}"`;
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) return 'not a color';
  // measured as a person sees it, in sRGB, whatever the working color space
  new Color(value).getHSL(hsl, SRGBColorSpace);
  if (hsl.s > ENVELOPE.maxSaturation || hsl.l < ENVELOPE.minLightness || hsl.l > ENVELOPE.maxLightness)
    return `#${value.toString(16).padStart(6, '0')} is outside the palette envelope`;
  return null;
}

// ---------------------------------------------------------------------------
// What an entry is. The define* helpers only tag the object; they exist so a
// file reads as what it is, and so editors can show these shapes.
// ---------------------------------------------------------------------------

/**
 * @typedef {string | number} SceneryColor A swatch name, or a hex color inside the envelope.
 *
 * @typedef {object} Biome
 * @property {string} id
 * @property {string} name
 * @property {[number, number, number]} climate Where it lives: temperature, moisture, region, each 0..1.
 * @property {{ base: SceneryColor, alt: SceneryColor, rock: SceneryColor, pattern?: 'terraces' | 'rows', field?: SceneryColor }} ground
 *   `pattern` lays farmland over the ground: `terraces` are paddies along the contours, `rows` are planted rows,
 *   each field its own way; `field` is the second color the pattern shows (standing water, bare earth).
 * @property {Record<string, number>} species Relative weights of species ids.
 * @property {number} density Tree cover, 0..1.5.
 * @property {{ tint: SceneryColor, density: number }} grass
 * @property {Record<string, number>} [props] Relative density of prop kinds here, by id, 0..1.
 * @property {number} sites How welcome the old builders were, 0..2; 0 for none.
 *
 * @typedef {object} Species One baked tree. Give `crown` for the built-in tree kit,
 * or `bake(kit)` returning `{ parts, cards }` for any generator of your own.
 * @property {string} id
 * @property {string} name
 * @property {{ height: number, radius: number, lean: number, tint: SceneryColor }} trunk
 * @property {{ count: number, spread?: number, rise?: number, from?: number }} limbs
 * @property {{ shape: 'dome' | 'cone' | 'fan' | 'bare', cards?: number, size?: number, radius?: number, height?: number, from?: number }} [crown]
 * @property {keyof typeof LEAVES | null} leaf
 * @property {{ cold: SceneryColor, warm: SceneryColor, dry: SceneryColor }} tint Instance tint by climate.
 * @property {[number, number]} scale Smallest and largest tree.
 * @property {(kit: object) => { parts: object[], cards: object[] }} [bake] Your own generator.
 *
 * @typedef {object} Site One kind of old stone landmark, found rarely beside the road.
 * @property {string} id
 * @property {string} name
 * @property {number} odds Its share among sites found.
 * @property {number} slope Steepest ground it stands on, 0..1.
 * @property {boolean} hill Needs a local top (true) or level ground (false).
 * @property {number} footprint Radius in meters, for clearance.
 * @property {boolean} [sunward] Faces the sunrise.
 * @property {(kit: object) => void} build Composes the site from the masonry kit around the origin; sun-facing sites face +z.
 *
 * @typedef {object} Prop Any other object that stands in the world, instanced.
 * @property {string} id
 * @property {string} name
 * @property {{ instances?: number, triangles?: number }} [budget] Caps, up to BUDGET.
 * @property {(kit: object) => import('three').BufferGeometry} bake Builds the geometry once, vertex-colored.
 * @property {(cell: object, kit: object) => Array<{ x: number, z: number, yaw?: number, scale?: number, sink?: number, tint?: import('three').Color }>} place
 *   Called for each 96 m cell in the streamed ring with the climate and the road there; returns where instances stand.
 * @property {{ radius: number, height: number }} [obstacle] When set, the bike keeps clear of each instance.
 *
 * @typedef {object} Bird One kind of bird, data over the engine's bird kit; a loose flock of it crosses the road now and then.
 * @property {string} id
 * @property {string} name
 * @property {Record<string, SceneryColor>} colors Named colors the parts refer to; `body`, `tip` and `beak` are the fallbacks.
 * @property {{ r: number, at: [number, number, number], scale: [number, number, number], color?: string }} body An ellipsoid.
 * @property {{ r: number, at: [number, number, number], scale: [number, number, number], color?: string }} head
 * @property {{ r: number, len: number, at: [number, number, number], sides?: number, tilt?: number, color?: string }} beak A cone pointing +z, tilted down by `tilt`.
 * @property {{ from: [number, number, number], to: [number, number, number], r0: number, r1: number, arch?: number, color?: string }} [neck] A tapered tube on an arched curve.
 * @property {Array<{ r: number, at: [number, number, number], scale: [number, number, number], color?: string }>} [marks] Ellipsoids painted over the body: a belly, a face, an eye.
 * @property {Array<object>} tail Sets of blades: with `count` a fan spread by `x`, `yaw` and `taper` from the middle; without, one blade.
 * @property {{ from: [number, number, number], to: [number, number, number], r: number, foot: [number, number, number], color?: string }} [legs] Two trailing struts, mirrored in x.
 * @property {number} [below] How far the lowest part hangs under the body center, meters; joins the bird's floor over the ground.
 * @property {{ rise: number, ahead: number }} [look] Where the camera looks, relative to the body center; the bird stays the orbit's pivot.
 * @property {number} [scale] Whole-bird scale, 0.5..1.5.
 * @property {{ root: [number, number, number], colors: [string, string, string], under?: string, segments: object[] }} wings
 *   Three hinged segments per side, each `{ len, lead, leadTip, trail, trailTip, tip?, round?, bands?, primaries?, fingers?, color? }`.
 * @property {{ amp: number, glideAmp: number, rate: number, glideRate: number, rest: number[], seg: number[], lag: number[], ease?: number, warp?: number, sweep?: number, bob?: number }} flight
 *   The wingbeat: amplitude and rate flapping and gliding, the rest pose, per-segment weight and lag of the traveling wave.
 * @property {{ scale: number, spread?: number, wobble?: number }} flock How the flock's birds are sized and spaced.
 *
 * @typedef {object} Paint One finish for the bike; the viewer picks one in the corner.
 * @property {string} id
 * @property {string} name What the corner control shows.
 * @property {SceneryColor} body The tank, the fairing and the tail.
 * @property {SceneryColor} trim The stripe, the wheels' rims and the seat's edge.
 */

export const defineBiome = (biome) => ({ kind: 'biome', ...biome });
export const defineSpecies = (species) => ({ kind: 'species', ...species });
export const defineSite = (site) => ({ kind: 'site', ...site });
export const defineProp = (prop) => ({ kind: 'prop', ...prop });
export const defineBird = (bird) => ({ kind: 'bird', ...bird });
export const definePaint = (paint) => ({ kind: 'paint', ...paint });

// ---------------------------------------------------------------------------
// Validation. Static shape here; baked geometry is measured by the engine
// with validateBaked as each entry is built. Both name the entry.
// ---------------------------------------------------------------------------
export function validateLibrary({ biomes, species, sites, props, birds = [], paints = [] }) {
  const errors = [];
  const color = (where, value) => {
    const problem = colorProblem(value);
    if (problem) errors.push(`${where}: ${problem}`);
  };
  const unit = (where, value, max = 1) => {
    if (typeof value !== 'number' || !(value >= 0) || value > max) errors.push(`${where}: expected 0..${max}`);
  };
  const idsOf = (list, what) => {
    const seen = new Set();
    for (const entry of list) {
      if (typeof entry?.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(entry.id)) errors.push(`${what}: id must be lowercase letters, digits and dashes`);
      else if (seen.has(entry.id)) errors.push(`${what} ${entry.id}: duplicate id`);
      seen.add(entry.id);
    }
    return seen;
  };
  const speciesIds = idsOf(species, 'species'),
    propIds = idsOf(props, 'prop');
  idsOf(biomes, 'biome');
  idsOf(sites, 'site');
  idsOf(birds, 'bird');
  idsOf(paints, 'paint');
  for (const entry of species) {
    const where = `species ${entry.id}`;
    color(`${where}.trunk.tint`, entry.trunk?.tint);
    for (const key of ['cold', 'warm', 'dry']) color(`${where}.tint.${key}`, entry.tint?.[key]);
    const shape = entry.crown?.shape ?? (entry.bake ? 'custom' : undefined);
    if (!shape) errors.push(`${where}: needs a crown for the tree kit, or a bake of its own`);
    if (shape !== 'bare' && shape !== 'custom') {
      if (!LEAVES[entry.leaf]) errors.push(`${where}: unknown leaf "${entry.leaf}"`);
      const cards = (entry.crown.cards ?? 0) * (shape === 'dome' ? entry.limbs?.count ?? 0 : 1);
      if (!(cards > 0) || cards > BUDGET.crownCards) errors.push(`${where}: ${cards} cards, the crown budget is ${BUDGET.crownCards}`);
    }
    if (shape === 'custom' && entry.leaf && !LEAVES[entry.leaf]) errors.push(`${where}: unknown leaf "${entry.leaf}"`);
    if ((entry.limbs?.count ?? 0) > 8) errors.push(`${where}: at most eight limbs`);
    const [low, high] = entry.scale ?? [];
    if (!(low > 0) || !(high >= low) || high > BUDGET.speciesScale) errors.push(`${where}: scale must be an ascending range up to ${BUDGET.speciesScale}`);
  }
  for (const biome of biomes) {
    const where = `biome ${biome.id}`;
    if (!Array.isArray(biome.climate) || biome.climate.length !== 3) errors.push(`${where}: climate needs three axes`);
    else biome.climate.forEach((v, i) => unit(`${where}.climate[${i}]`, v));
    for (const key of ['base', 'alt', 'rock']) color(`${where}.ground.${key}`, biome.ground?.[key]);
    const pattern = biome.ground?.pattern;
    if (pattern !== undefined && pattern !== 'terraces' && pattern !== 'rows') errors.push(`${where}.ground.pattern: expected "terraces" or "rows"`);
    if (pattern !== undefined) color(`${where}.ground.field`, biome.ground.field);
    for (const [id, weight] of Object.entries(biome.species ?? {})) {
      if (!speciesIds.has(id)) errors.push(`${where}: unknown species "${id}"`);
      unit(`${where}.species.${id}`, weight, 4);
    }
    unit(`${where}.density`, biome.density, 1.5);
    color(`${where}.grass.tint`, biome.grass?.tint);
    unit(`${where}.grass.density`, biome.grass?.density);
    for (const [id, weight] of Object.entries(biome.props ?? {})) {
      if (!propIds.has(id)) errors.push(`${where}: unknown prop "${id}"`);
      unit(`${where}.props.${id}`, weight);
    }
    unit(`${where}.sites`, biome.sites, 2);
  }
  for (const site of sites) {
    const where = `site ${site.id}`;
    unit(`${where}.odds`, site.odds, 4);
    unit(`${where}.slope`, site.slope);
    if (!(site.footprint > 0) || site.footprint > 60) errors.push(`${where}: footprint must be 1..60 m`);
    if (typeof site.build !== 'function') errors.push(`${where}: needs a build(kit) function`);
  }
  for (const prop of props) {
    const where = `prop ${prop.id}`;
    if (typeof prop.bake !== 'function') errors.push(`${where}: needs a bake(kit) function`);
    if (typeof prop.place !== 'function') errors.push(`${where}: needs a place(cell, kit) function`);
    if ((prop.budget?.instances ?? 0) > BUDGET.propInstances) errors.push(`${where}: at most ${BUDGET.propInstances} instances`);
    if ((prop.budget?.triangles ?? 0) > BUDGET.propTriangles) errors.push(`${where}: at most ${BUDGET.propTriangles} triangles`);
    if (prop.obstacle && !(prop.obstacle.radius > 0 && prop.obstacle.height >= 0)) errors.push(`${where}: obstacle needs a radius and a height`);
  }
  for (const bird of birds) {
    const where = `bird ${bird.id}`;
    if (typeof bird.name !== 'string' || !bird.name) errors.push(`${where}: needs a name`);
    for (const [key, value] of Object.entries(bird.colors ?? {})) color(`${where}.colors.${key}`, value);
    for (const key of ['body', 'tip', 'beak']) if (!(key in (bird.colors ?? {}))) errors.push(`${where}.colors: needs ${key}`);
    if (!(bird.body?.r > 0) || !(bird.head?.r > 0) || !(bird.beak?.len > 0)) errors.push(`${where}: needs a body, a head and a beak`);
    if (!Array.isArray(bird.tail)) errors.push(`${where}: tail must be a list of blade sets`);
    const scale = bird.scale ?? 1;
    if (!(scale >= 0.5) || scale > 1.5) errors.push(`${where}.scale: expected 0.5..1.5`);
    const segments = bird.wings?.segments;
    if (!Array.isArray(segments) || segments.length !== 3 || !Array.isArray(bird.wings.root) || bird.wings.colors?.length !== 3)
      errors.push(`${where}: wings need a root, three segments and three colors`);
    else {
      const span = 2 * (bird.wings.root[0] + segments.reduce((a, s) => a + (s.len > 0 ? s.len : 0), 0)) * scale;
      if (!(span >= 2) || span > BUDGET.birdSpan) errors.push(`${where}: ${span.toFixed(1)} m across, birds are 2..${BUDGET.birdSpan} m`);
      segments.forEach((s, i) => {
        if (!(s.len > 0) || !(s.lead > s.trail) || !(s.leadTip >= s.trailTip))
          errors.push(`${where}.wings.segments[${i}]: needs a length and a leading edge ahead of the trailing edge`);
      });
    }
    const f = bird.flight ?? {};
    for (const key of ['amp', 'glideAmp']) if (!(f[key] >= 0) || f[key] > 1.2) errors.push(`${where}.flight.${key}: expected 0..1.2 radians`);
    for (const key of ['rate', 'glideRate']) if (!(f[key] > 0) || f[key] > BUDGET.birdBeat) errors.push(`${where}.flight.${key}: expected 0..${BUDGET.birdBeat} radians per second`);
    for (const key of ['rest', 'seg', 'lag'])
      if (!Array.isArray(f[key]) || f[key].length !== 3 || !f[key].every(Number.isFinite)) errors.push(`${where}.flight.${key}: needs one number per segment`);
    if (!(bird.flock?.scale >= 0.3) || bird.flock.scale > 1.2) errors.push(`${where}.flock.scale: expected 0.3..1.2`);
    if (bird.below !== undefined) unit(`${where}.below`, bird.below, 2);
    if (bird.look && !(Number.isFinite(bird.look.rise) && Number.isFinite(bird.look.ahead) && Math.abs(bird.look.ahead) <= 3))
      errors.push(`${where}.look: needs a finite rise and an ahead within 3 m`);
  }
  if (!paints.length) errors.push('paints: the registry needs at least one paint');
  for (const paint of paints) {
    const where = `paint ${paint.id}`;
    if (typeof paint.name !== 'string' || !paint.name) errors.push(`${where}: needs a name for the corner control`);
    for (const key of ['body', 'trim']) color(`${where}.${key}`, paint[key]);
  }
  return errors;
}

/** Problems with a baked geometry against its entry's budget and the color envelope; empty when clean. */
export function validateBaked(entry, geometry) {
  const errors = [];
  const where = `${entry.kind ?? 'entry'} ${entry.id}`;
  const triangles = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
  const cap = entry.budget?.triangles ?? (entry.kind === 'bird' ? BUDGET.birdTriangles : BUDGET.propTriangles);
  if (triangles > cap) errors.push(`${where}: ${triangles} triangles, the budget is ${cap}`);
  const colors = geometry.attributes.color;
  if (colors) {
    const stride = Math.max(1, Math.floor(colors.count / 200)),
      c = new Color();
    for (let i = 0; i < colors.count; i += stride) {
      // vertex colors are stored linear; judge them in sRGB like every other color
      c.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i), LinearSRGBColorSpace).getHSL(hsl, SRGBColorSpace);
      // a neutral near-white is a tint carrier for per-instance color, not a choice
      const carrier = hsl.s < 0.05 && hsl.l > 0.9;
      if (!carrier && (hsl.s > ENVELOPE.maxSaturation + 0.05 || hsl.l < ENVELOPE.minLightness - 0.05 || hsl.l > ENVELOPE.maxLightness + 0.05)) {
        errors.push(`${where}: a vertex color is outside the palette envelope`);
        break;
      }
    }
  }
  return errors;
}
