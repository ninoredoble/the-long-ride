// The world on the CPU: the land, its climate and the road through it, all
// from one seed. The heightfield, every placement, the bike and the sound
// read these; the GPU only reads what the CPU wrote. Nothing here depends on
// the page, so the same functions run in Node for the checks.
//
// The road is a graph over z: its centre line is x = road.x(z), a meander of
// three scales, and its surface height is the land under it smoothed along
// its length, so its grade stays gentle while it follows the country. Both
// are cached per 16 m row, which is also what the GPU reads, so the painted
// road, the carved corridor and the bike agree to the centimetre. The land
// near the road is calmer: the range stands back from it and the sea keeps a
// shore's width off it, the way a highway follows the valleys and the coast.
import { hash2, fbm, ridgedMulti, pyramidPeaks, sstep } from './noise.js';

export const CELL = 16; // terrain sample spacing, meters
// The range: a warped ridged massif with a lattice of steep volcanic summits.
// They stand back from the road and reach 600 to 800 m, the cloud deck's
// height, so their tops wear the clouds.
export const PEAKS = { cell: 2600, radius: 950, power: 1.45, lift: 520, massif: 420 };
export const ROAD = {
  lane: 1.85, // the bike rides this far right of the centre line
  half: 3.6, // the asphalt, either side of the centre
  shoulder: 5.2, // gravel to here
  flat: 15, // the carved bench is level to here
  bank: 85, // and blends back into the land by here
  smooth: 16, // rows either side the grade is averaged over, two rows apart
  floor: 3.5, // the lowest the road runs, over the sea it skirts
  calm: [260, 1500], // the range rises back to full height over this distance
  shore: [160, 700], // and the sea keeps at least this far off
};
// Temperature is mostly height: the coast is hot, the plateau warm, the
// highlands cool, with a slow field on top so two places at one height can
// differ. Moisture and region are slow fields a dozen kilometres wide.
export const CLIMATE_SCALE = 12000;
export const LAPSE = 1 / 900; // temperature lost per meter of height

export function createWorld(seed) {
  // Three field seeds, hashed rather than sliced from the bits, so small
  // seeds do not share a climate.
  const S1 = hash2(seed, 1, 0x1a2b) & 0xffff,
    S2 = hash2(seed, 2, 0x3c4d) & 0xffff,
    S3 = hash2(seed, 3, 0x5e6f) & 0xffff,
    S4 = hash2(seed, 4, 0x7a8b) & 0xffff;

  // The meander: kilometre sweeps, a few hundred meters of bend, and tight
  // turns where the land is rough. Tangents stay under about sixty degrees.
  function roadX(z) {
    return (
      1700 * fbm(z / 5200 + 3.7, 0.31, S4, 2) +
      150 * fbm(z / 620 - 1.9, 4.2, S4 + 9, 2) +
      22 * fbm(z / 170 + 7.3, 9.1, S4 + 17, 1)
    );
  }

  // Distance from the road's centre line, signed: positive to the +x side.
  // Exact enough while the bends are much wider than the corridor.
  const rows = new Map(); // iz -> { x, slope, base, y }
  function row(iz) {
    let r = rows.get(iz);
    if (r) return r;
    if (rows.size > 20000) rows.clear();
    const z = iz * CELL,
      x = roadX(z);
    r = { x, slope: (roadX(z + CELL) - roadX(z - CELL)) / (2 * CELL), base: baseHeight(x, z), y: NaN };
    rows.set(iz, r);
    return r;
  }
  // The road's own height at a row: the land under its centre line averaged
  // over a few hundred meters with Gaussian weights, never under the floor.
  function rowY(iz) {
    const r = row(iz);
    if (!Number.isNaN(r.y)) return r.y;
    let sum = 0,
      weight = 0;
    for (let k = -ROAD.smooth; k <= ROAD.smooth; k++) {
      const w = Math.exp(-((k / (ROAD.smooth * 0.5)) ** 2));
      sum += w * row(iz + k * 2).base;
      weight += w;
    }
    r.y = Math.max(ROAD.floor, sum / weight);
    return r.y;
  }
  // The road at any z, interpolated between rows exactly as the GPU reads it.
  const road = {
    x(z) {
      const f = z / CELL,
        i = Math.floor(f),
        t = f - i;
      return row(i).x + (row(i + 1).x - row(i).x) * t;
    },
    slope(z) {
      const i = Math.floor(z / CELL);
      return (row(i + 1).x - row(i).x) / CELL;
    },
    y(z) {
      const f = z / CELL,
        i = Math.floor(f),
        t = f - i;
      return rowY(i) + (rowY(i + 1) - rowY(i)) * t;
    },
    // heading of the road toward +z, in the engine's convention (0 is +z,
    // positive turns toward +x)
    heading(z) {
      return Math.atan2(road.slope(z), 1);
    },
    distance(x, z) {
      const s = road.slope(z);
      return (x - road.x(z)) / Math.sqrt(1 + s * s);
    },
    row,
    rowY,
  };

  // The land before the road is cut into it.
  const probe = [0, 0, 0, 0];
  function baseHeight(x, z) {
    return land(x, z, probe, false);
  }
  function land(x, z, out, climate) {
    const d = Math.abs(x - roadX(z));
    const wx = x + 700 * fbm(x / 2200 + 31.7, z / 2200 - 12.3, S3, 3);
    const wz = z + 700 * fbm(x / 2200 - 54.1, z / 2200 + 77.9, S3 + 7, 3);
    let cont = fbm(wx / 3400, wz / 3400, S1, 4) * 0.5 + 0.5; // continentalness
    // the sea keeps a shore's width off the road
    cont = Math.max(cont, 0.6 - 0.25 * sstep(ROAD.shore[0], ROAD.shore[1], d));
    const landMask = sstep(0.4, 0.6, cont);
    // the plateau: broad uplands a few hundred meters high, the pineapple
    // country and the pine highlands
    const plateau = sstep(0.42, 0.72, fbm(x / 9000 - 4.4, z / 9000 + 2.6, S3 + 53, 2) * 0.5 + 0.5) * 300 * landMask;
    const calm = sstep(ROAD.calm[0], ROAD.calm[1], d);
    const hills = fbm(wx / 520, wz / 520, S1 + 11, 4) * (0.55 + 0.45 * sstep(60, ROAD.calm[0], d));
    const mountainMask = sstep(0.56, 0.82, cont) * calm;
    let h = -70 + 150 * landMask + plateau + hills * (10 + 38 * landMask);
    if (mountainMask > 0) {
      const rx = wx + 260 * fbm(wx / 900 + 3.3, wz / 900 - 1.1, S1 + 29, 2),
        rz = wz + 260 * fbm(wx / 900 - 2.2, wz / 900 + 4.4, S1 + 31, 2);
      const ridge = ridgedMulti(rx / 1600, rz / 1600, S1 + 23, 4);
      const px = x + 90 * fbm(x / 700 + 1.3, z / 700 + 2.1, S1 + 61, 2),
        pz = z + 90 * fbm(x / 700 - 3.7, z / 700 + 0.4, S1 + 63, 2);
      const peak = pyramidPeaks(px, pz, S1 + 47, PEAKS.cell, PEAKS.radius, PEAKS.power);
      h += (ridge * PEAKS.massif * (1 - 0.45 * sstep(0.05, 0.5, peak)) + peak * PEAKS.lift) * mountainMask;
    }
    // a gentle shelf so beaches are wide and the shoreline never zigzags
    const shelf = sstep(-30, 30, h);
    h = h * (0.55 + 0.45 * shelf) + (1 - shelf) * -6;
    if (climate) {
      const kx = x + 900 * fbm(x / 3000 + 4.1, z / 3000 - 2.2, S3 + 41, 2),
        kz = z + 900 * fbm(x / 3000 - 7.7, z / 3000 + 5.5, S3 + 43, 2);
      out[1] = 0.62 + 0.3 * fbm(kx / CLIMATE_SCALE + 9.1, kz / CLIMATE_SCALE + 3.3, S2, 2);
      out[2] = fbm(kx / (CLIMATE_SCALE * 0.6) - 8.4, kz / (CLIMATE_SCALE * 0.6) + 15.2, S2 + 3, 2) * 0.5 + 0.5;
      out[3] = fbm(kx / (CLIMATE_SCALE * 0.5) + 21.3, kz / (CLIMATE_SCALE * 0.5) - 8.8, S3 + 19, 2) * 0.5 + 0.5;
    }
    return h;
  }

  // One sample of the finished world: height with the road's bench carved in,
  // then temperature (cooled by height), moisture and region.
  function sample(x, z, out) {
    let h = land(x, z, out, true);
    const d = Math.abs(road.distance(x, z));
    if (d < ROAD.bank) {
      const w = 1 - sstep(ROAD.flat, ROAD.bank, d);
      h += (road.y(z) - 0.05 - h) * w;
    }
    out[0] = h;
    out[1] -= Math.max(0, h) * LAPSE;
    return out;
  }

  return { seed, sample, baseHeight, road, S1, S2, S3, S4 };
}

// How much of each biome a climate is. The same rule runs on the GPU for
// terrain color, so a place is the same biome for its ground, its trees,
// its grass, its rocks and its sites. Each biome is a soft cell in climate
// space; sharpening keeps most ground inside one biome with bands of a few
// hundred meters between them, so borders never seam and never smear.
export const CLIMATE_STRETCH = 2.2;
export const CLIMATE_RADIUS = 0.12;
export const CLIMATE_SHARPNESS = 2.2;
export const climateAxis = (v) => Math.min(1, Math.max(0, (v - 0.5) * CLIMATE_STRETCH + 0.5));
export function biomeWeights(biomes, temp, moist, region, out = new Float32Array(biomes.length)) {
  const t = climateAxis(temp),
    m = climateAxis(moist),
    r = climateAxis(region);
  let nearest = Infinity;
  for (let i = 0; i < biomes.length; i++) {
    const [ct, cm, cr] = biomes[i].climate;
    out[i] = ((t - ct) ** 2 + (m - cm) ** 2 + (r - cr) ** 2) / (CLIMATE_RADIUS * CLIMATE_RADIUS);
    nearest = Math.min(nearest, out[i]);
  }
  // Measured from the nearest cell, so the largest weight is one and the
  // GPU's single-precision copy of this rule never underflows.
  let sum = 0;
  for (let i = 0; i < biomes.length; i++) sum += out[i] = Math.exp(-CLIMATE_SHARPNESS * (out[i] - nearest));
  for (let i = 0; i < biomes.length; i++) out[i] /= sum;
  return out;
}
