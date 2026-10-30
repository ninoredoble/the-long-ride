// The Long Ride: the engine. One CPU heightfield with one road through it, one
// horizon, one climate rule, the soft illustrated light, streamed rings of
// whatever the scenery library says stands here, a motorcycle, a camera and a
// day. The page (index.html) holds the markup and the import map; the library
// (library/) holds every place; src/world.js makes the land and the road.
import * as THREE from 'three';
import { buildBird, animateBird } from './birds.js';
import { buildBike, animateBike, bikeTile, BIKE } from './bike.js';
import {
  WebGPURenderer,
  MeshStandardNodeMaterial,
  MeshBasicNodeMaterial,
  RenderPipeline,
} from 'three/webgpu';
import {
  Fn,
  If,
  uniform,
  textureLoad,
  positionLocal,
  positionWorld,
  normalLocal,
  cameraPosition,
  vec2,
  vec3,
  vec4,
  float,
  ivec2,
  mix,
  smoothstep,
  max,
  abs,
  sin,
  pow,
  dot,
  acos,
  normalize,
  hash,
  fog,
  densityFogFactor,
  exponentialHeightFogFactor,
  varying,
  mx_noise_float,
  select,
  clamp,
  attribute,
  instanceIndex,
  fract,
  length,
  step,
  screenUV,
  saturation,
  pass,
  normalView,
  normalWorld,
  diffuseColor,
  texture,
  transformNormalToView,
  renderOutput,
  convertToTexture,
  viewportSize,
  exp,
  cross,
  sign,
  sqrt,
  cos,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { hash2, perlin2, sstep, mulberry32 } from './noise.js';
import { createWorld, biomeWeights as climateWeights, CELL, ROAD, LAPSE, CLIMATE_STRETCH, CLIMATE_RADIUS, CLIMATE_SHARPNESS } from './world.js';
import { createWaterMaterial } from './water.js';
import { createMilkyWay } from './milky-way.js';
import { LOOK, applyLook } from './color-grade.js';
import { SWATCH, LEAVES, swatchColor, colorProblem, validateLibrary, validateBaked, BUDGET } from '../library/contract.js';
import * as registry from '../library/index.js';
// Shader motion follows simulation time, including pause and hidden tabs.
const time = uniform(0);

// ---------------------------------------------------------------------------
// World constants. Everything is in meters and seconds.
// ---------------------------------------------------------------------------
const N = 560; // heightfield window, N x N cells (9 km)
const TERRAIN_CELLS = 528; // rendered terrain, ±4.2 km
const WATER_CELLS = 132;
const WATER_CELL = CELL * 4;
const SEA_LEVEL = 0;
const DECK_Y = 520; // cloud deck altitude: the summits wear it, the highland road rides under it
// The ride: a calm cruise on the road, slower in the bends and off it.
const RIDE = {
  cruise: 21, // m/s on a straight road, about 75 km/h
  grip: 3.2, // m/s² of sideways pull the bends are taken at
  rough: 11, // m/s off the road
  turn: 0.9, // fastest yaw rate, radians per second
  look: 1.1, // seconds of road the bike looks ahead to steer by
  hold: 2.6, // seconds after a steer before the bike heads back to the road
  wade: 0.4, // meters above the sea the bike will ride down to
};
const DAY_SECONDS = 600; // one full turn of the day clock
const wrapAngle = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
// Night is a quarter of the cycle. The sun keeps its own clock, `solar`: one
// pace while it is up and a faster one while it is down, the change blended
// over the twilights so nothing jumps at the crossing. The palette, the sky
// bodies and the sky events all read solar phase, so the sky stays the one it
// was tuned as and only the night passes sooner. Midnight is 0, noon is 0.5,
// in both clocks.
const NIGHT_SHARE = 0.25; // of the day clock, sunset to sunrise
const NIGHT_CORE = 0.18; // of the day clock at the night pace, around midnight
const solar = (() => {
  const half = NIGHT_SHARE / 2,
    core = NIGHT_CORE / 2,
    ramp = half - core;
  const dayPace = 0.5 / (1 - NIGHT_SHARE); // half the sun's arc over the day
  // the night's half of the arc: the core at the night pace, each ramp at the mean of both
  const nightPace = (0.25 - (dayPace * ramp) / 2) / (core + ramp / 2);
  const rise = (nightPace - dayPace) / 2;
  const fold = (q) => {
    // 0..0.5 from midnight; the pace along a ramp is dayPace + rise * (1 + cos)
    if (q <= core) return nightPace * q;
    if (q <= half) {
      const u = (q - core) / ramp;
      return nightPace * core + ramp * ((dayPace + rise) * u + (rise * Math.sin(Math.PI * u)) / Math.PI);
    }
    return 0.25 + dayPace * (q - half);
  };
  return (phase) => {
    const whole = Math.floor(phase),
      q = phase - whole;
    return whole + (q <= 0.5 ? fold(q) : 1 - fold(1 - q));
  };
})();

// ---------------------------------------------------------------------------
// Memory. The page remembers the viewer's settings, and per world where the
// ride was, so reopening the tab resumes instead of restarting. Storage can
// be missing, full or damaged; any of those makes this a fresh visit.
// ---------------------------------------------------------------------------
const SETTINGS_KEY = 'the-long-ride-settings',
  RESUME_KEY = 'the-long-ride-resume';
const remember = {
  read(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // nothing to remember with; the page still works
    }
  },
};
const finite = (v, min = -Infinity, max = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
const storedSettings = remember.read(SETTINGS_KEY) ?? {};
const storedRide = remember.read(RESUME_KEY);

// ---------------------------------------------------------------------------
// Seed. ?seed=<number> reproduces a world and always wins; without one the
// remembered world continues, and with nothing remembered every visit is new.
// The address always carries the resolved seed so a copied URL is that world.
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
// `?profile=1` arms the renderer's timestamp queries and the raw frame trace
// that `tools/bench.js` reads. Off, the loop costs one boolean per frame.
const profiling = params.has('profile');
// The phone budget: a small touch screen, or `?lite=1`, renders fewer pixels,
// a smaller shadow map, a shorter ring of trees and less grass, and skips the
// bloom and the soft reconstruction. The same ride and the same world; a
// budget, not a second look. `?lite=0` turns it off.
const LITE =
  params.get('lite') === '1' ||
  (params.get('lite') !== '0' &&
    matchMedia('(pointer: coarse)').matches &&
    Math.min(screen.width, screen.height) < 820);
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionPreference.matches;
motionPreference.addEventListener('change', (e) => {
  reducedMotion = e.matches;
  if (reducedMotion && running && !paused) togglePause();
});
let seed = parseInt(params.get('seed'), 10);
if (!Number.isFinite(seed))
  seed = finite(storedRide?.seed, 0, 0xffffffff) ?? (Math.random() * 0xffffffff) >>> 0;
seed = seed >>> 0;
const addressUrl = new URL(location.href);
addressUrl.searchParams.set('seed', String(seed));
history.replaceState(null, '', addressUrl);
const shareUrl = new URL(addressUrl);
shareUrl.search = '';
shareUrl.searchParams.set('seed', String(seed));
document.getElementById('shareLink').href = shareUrl.toString();

// ---------------------------------------------------------------------------
// The look: palette anchors through the whole day, keyed in solar phase (0.25
// sunrise, 0.5 noon, 0.75 sunset). Dawn and dusk carry the most keys because
// that is where the sky changes fastest. Night is dark.
// ---------------------------------------------------------------------------
const C = (hex) => new THREE.Color(hex);
const P = (
  zenith,
  upper,
  horizon,
  below,
  sun,
  sunI,
  hemiSky,
  hemiGround,
  hemiI,
  horizonWarm = horizon,
  upperWarm = upper,
  glow = horizonWarm,
) => ({
  zenith: C(zenith),
  upper: C(upper),
  horizon: C(horizon),
  horizonWarm: C(horizonWarm),
  upperWarm: C(upperWarm),
  glow: C(glow),
  below: C(below),
  sun: C(sun),
  sunI,
  hemiSky: C(hemiSky),
  hemiGround: C(hemiGround),
  hemiI,
});
const nightPalette = () => P(0x071222, 0x10192e, 0x2e2831, 0x10121b, 0xffb070, 2.4, 0x213258, 0x0e1116, 0.6);
const L = {
  sat: 1,
  fogDensity: 0.00018,
  moon: { color: 0xa8bce8, intensity: 0.7 },
  keys: [
    { t: 0.0, ...nightPalette() },
    // astronomical dawn: the first hint of warmth low on the sun's side
    {
      t: 0.17,
      ...P(0x03071a, 0x0a1430, 0x1a2a4c, 0x0b1224, 0xffb070, 2.4, 0x22335a, 0x101318, 0.55, 0x2b3454, 0x0a1430, 0x3a3450),
    },
    // civil dawn: a deep orange band under a mauve sky, the land still blue
    {
      t: 0.215,
      ...P(0x11254e, 0x2c4878, 0x6b7d9c, 0x2a3448, 0xffa860, 2.5, 0x4c5f88, 0x2a2b2a, 0.9, 0xe28a52, 0x8a6a8e, 0xf07038),
    },
    // sunrise: gold on the horizon, peach above it, long cool shadows
    {
      t: 0.25,
      ...P(0x2d5c92, 0x6d95bc, 0x9eafbc, 0x5f7480, 0xffb070, 2.9, 0xa8c2d6, 0x4a5a44, 1.5, 0xffb066, 0xe8a88a, 0xff9a4a),
    },
    // morning
    {
      t: 0.3,
      ...P(0x3a80b4, 0x74a8cc, 0x9dbdcb, 0x83a3a8, 0xffe0b0, 3.0, 0xbcd8e8, 0x6a8850, 1.8, 0xf3d6a2, 0xb9ccd6, 0xf8d29c),
    },
    // noon: the approved day
    {
      t: 0.5,
      ...P(0x3e8dbb, 0x76acd0, 0x96bdcd, 0x8dacae, 0xfff1cb, 3, 0xc2deeb, 0x739054, 1.8, 0xe2e4c3, 0xabcfda),
    },
    // late afternoon: the light turns gold
    {
      t: 0.7,
      ...P(0x3f7fae, 0x7ca4c2, 0xa4b4ba, 0x8a9a94, 0xffd9a0, 2.9, 0xc4d4d8, 0x6a7a50, 1.7, 0xf4c584, 0xc4b8a0, 0xf8b468),
    },
    // sunset: orange fire low, salmon above, the far side already rose and blue
    {
      t: 0.75,
      ...P(0x2f4a82, 0x6c7aa0, 0x9aa0b0, 0x5a5c6a, 0xff9a40, 2.7, 0xa898b0, 0x5a4a40, 1.35, 0xffa040, 0xe09a78, 0xff6a2a),
    },
    // civil dusk: afterglow, purple upper sky, the first stars
    {
      t: 0.785,
      ...P(0x172850, 0x394272, 0x6c6480, 0x2e3448, 0xff9048, 2.4, 0x4a4a76, 0x2a2828, 0.9, 0xf07a3a, 0xa06a82, 0xf25a2a),
    },
    // nautical dusk: the last warmth drains into blue
    {
      t: 0.83,
      ...P(0x060c22, 0x0e1838, 0x243050, 0x0e1424, 0xffb070, 2.4, 0x263658, 0x121418, 0.55, 0x3d3452, 0x101838, 0x50384a),
    },
    { t: 1.0, ...nightPalette() },
  ],
  terrain: {
    sand: 0xc5bc85,
    seaFloor: 0x6d9988,
    waterDeep: 0x286e7b,
    waterShallow: 0x74b9a9,
  },
  cloud: { white: 0xe1e4cb },
};
applyLook(L);
const FOG_DENSITY = L.fogDensity;

// ---------------------------------------------------------------------------
// The scenery library lives in library/: a contract (swatches, envelope,
// budgets, validation) and one file per biome, species, ruin type and prop.
// The engine below owns light, sky, fog, streaming, the crown morph, shadows
// and budgets; the library only says what stands where and what color it is.
// It is validated once here, and every baked entry is measured as it is built,
// so a broken contribution cannot ship quietly.
// ---------------------------------------------------------------------------
const BIOMES = registry.biomes,
  SPECIES = Object.fromEntries(registry.species.map((entry) => [entry.id, entry])),
  SITES = registry.sites,
  PROPS = registry.props,
  BIRDS = registry.birds,
  PAINTS = registry.paints,
  PAINT = Object.fromEntries(PAINTS.map((entry) => [entry.id, entry]));
{
  const errors = validateLibrary(registry);
  if (errors.length) throw new Error('scenery library: ' + errors.join('; '));
}
// How rare the sites are: one site cell in this many carries a site, before
// the biome's welcome. Cells are SITE_CELL meters wide.
const SITE_CELL = 1200,
  SITE_ODDS = 0.3;
// A color from the library, refused by name when it leaves the envelope.
function libraryColor(where, value) {
  const problem = colorProblem(value);
  if (problem) throw new Error(`scenery library: ${where}: ${problem}`);
  return C(swatchColor(value));
}

// ---------------------------------------------------------------------------
// The world on the CPU (src/world.js) is the single source of truth for the
// terrain and the road; the GPU only displaces a static grid by what the CPU
// wrote, and paints the road from the rows the CPU wrote.
// ---------------------------------------------------------------------------
const world = createWorld(seed),
  road = world.road,
  S1 = world.S1,
  S2 = world.S2,
  S3 = world.S3;
const biomeWeights = (temp, moist, region, out) => climateWeights(BIOMES, temp, moist, region, out);
function biomeAt(x, z, out) {
  return biomeWeights(fieldAt(x, z, 1), fieldAt(x, z, 2), fieldAt(x, z, 3), out);
}

// ---------------------------------------------------------------------------
// The heightfield: a toroidal N x N window of world cells kept fresh around the
// bike. Texel (ix mod N, iz mod N) always holds world cell (ix, iz).
// ---------------------------------------------------------------------------
const hfData = new Float32Array(N * N * 4);
const hfTex = new THREE.DataTexture(hfData, N, N, THREE.RGBAFormat, THREE.FloatType);
hfTex.magFilter = hfTex.minFilter = THREE.NearestFilter;
hfTex.generateMipmaps = false;
let hfCx = 0,
  hfCz = 0; // world cell the window is centered on
const tmp4 = [0, 0, 0, 0];
function wrap(i) {
  return ((i % N) + N) % N;
}
function fillCell(ix, iz) {
  world.sample(ix * CELL, iz * CELL, tmp4);
  const o = (wrap(iz) * N + wrap(ix)) * 4;
  hfData[o] = tmp4[0];
  hfData[o + 1] = tmp4[1];
  hfData[o + 2] = tmp4[2];
  hfData[o + 3] = tmp4[3];
}
// The road's rows, toroidal like the heightfield's: texel (iz mod N) holds
// world row iz's centre line x, its slope and its surface height, which is
// everything the terrain shader needs to paint the road where the bike is.
const roadData = new Float32Array(N * 4);
const roadTex = new THREE.DataTexture(roadData, N, 1, THREE.RGBAFormat, THREE.FloatType);
roadTex.magFilter = roadTex.minFilter = THREE.NearestFilter;
roadTex.generateMipmaps = false;
function fillRoadRow(iz) {
  const r = road.row(iz),
    o = wrap(iz) * 4;
  roadData[o] = r.x;
  roadData[o + 1] = road.row(iz + 1).x - r.x;
  roadData[o + 2] = road.rowY(iz);
  roadData[o + 3] = iz;
}
function fillAll(cx, cz) {
  hfCx = cx;
  hfCz = cz;
  for (let iz = cz - N / 2; iz < cz + N / 2; iz++) {
    fillRoadRow(iz);
    for (let ix = cx - N / 2; ix < cx + N / 2; ix++) fillCell(ix, iz);
  }
  hfTex.needsUpdate = roadTex.needsUpdate = true;
}
function updateHeightfield(x, z) {
  const cx = Math.round(x / CELL),
    cz = Math.round(z / CELL);
  let changed = false;
  if (Math.abs(cx - hfCx) > N / 4 || Math.abs(cz - hfCz) > N / 4) {
    fillAll(cx, cz);
    return;
  }
  while (hfCx < cx) {
    hfCx++;
    const ix = hfCx + N / 2 - 1;
    for (let iz = hfCz - N / 2; iz < hfCz + N / 2; iz++) fillCell(ix, iz);
    changed = true;
  }
  while (hfCx > cx) {
    hfCx--;
    const ix = hfCx - N / 2;
    for (let iz = hfCz - N / 2; iz < hfCz + N / 2; iz++) fillCell(ix, iz);
    changed = true;
  }
  while (hfCz < cz) {
    hfCz++;
    const iz = hfCz + N / 2 - 1;
    fillRoadRow(iz);
    roadTex.needsUpdate = true;
    for (let ix = hfCx - N / 2; ix < hfCx + N / 2; ix++) fillCell(ix, iz);
    changed = true;
  }
  while (hfCz > cz) {
    hfCz--;
    const iz = hfCz - N / 2;
    fillRoadRow(iz);
    roadTex.needsUpdate = true;
    for (let ix = hfCx - N / 2; ix < hfCx + N / 2; ix++) fillCell(ix, iz);
    changed = true;
  }
  if (changed) hfTex.needsUpdate = true;
}
function texel(ix, iz, c) {
  return hfData[(wrap(iz) * N + wrap(ix)) * 4 + c];
}
// Barycentric interpolation on the exact triangles drawn by buildGrid.
function heightAt(x, z) {
  const fx = x / CELL,
    fz = z / CELL;
  const ix = Math.floor(fx),
    iz = Math.floor(fz);
  const tx = fx - ix,
    tz = fz - iz;
  const h00 = texel(ix, iz, 0),
    h10 = texel(ix + 1, iz, 0),
    h01 = texel(ix, iz + 1, 0),
    h11 = texel(ix + 1, iz + 1, 0);
  return tx + tz <= 1
    ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
    : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
}
function fieldAt(x, z, c) {
  return texel(Math.round(x / CELL), Math.round(z / CELL), c);
}
function slopeAt(x, z) {
  const ix = Math.round(x / CELL),
    iz = Math.round(z / CELL);
  const dx = texel(ix + 1, iz, 0) - texel(ix - 1, iz, 0),
    dz = texel(ix, iz + 1, 0) - texel(ix, iz - 1, 0);
  return Math.hypot(dx, dz) / (2 * CELL);
}

// ---------------------------------------------------------------------------
// Renderer, scene, lights
// ---------------------------------------------------------------------------
const canvas = document.getElementById('c');
// Multisampling belongs to the scene pass and nowhere else. `antialias` here
// would also multisample the canvas, where the only thing ever drawn is one
// full-screen quad: every sample of it takes the same shaded value and the
// resolve averages copies of that value, so four samples of the finished
// picture cost four times the raster and a resolve to produce it unchanged.
// The scene pass asks for its own four samples below, which is what the
// approved look and the foliage's alpha-to-coverage actually need.
const renderer = new WebGPURenderer({
  canvas,
  antialias: false,
  trackTimestamp: params.has('profile'),
  forceWebGL: params.get('webgl') === '1',
});
const renderScale = () =>
  Math.min(
    window.devicePixelRatio || 1,
    LITE ? 1.25 : 1.5,
    Math.sqrt((LITE ? 1100000 : 2000000) / (Math.max(1, window.innerWidth) * Math.max(1, window.innerHeight))),
  );
renderer.setPixelRatio(renderScale());
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.NoToneMapping;
await renderer.init();
document.getElementById('backendLabel').textContent = renderer.backend.isWebGPUBackend
  ? 'webgpu'
  : 'webgl2';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 14000);
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
const hemi = new THREE.HemisphereLight(0xa9c8e6, 0x8a8f78, 1.0);
scene.add(sun, sun.target, hemi);
renderer.shadowMap.enabled = true;
sun.castShadow = true;
const SHADOW_MAP = LITE ? 1024 : 2048,
  SHADOW_HALF = 360;
sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
Object.assign(sun.shadow.camera, {
  left: -SHADOW_HALF,
  right: SHADOW_HALF,
  top: SHADOW_HALF,
  bottom: -SHADOW_HALF,
  near: 1,
  far: 2200,
});
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.5;
sun.shadow.radius = 3;
sun.shadow.intensity = 0.55 * LOOK.shadowI;
const shadowMatrix = uniform(sun.shadow.matrix);
const receiveSoftShadow = Fn(([shadow]) => {
  const projected = shadowMatrix.mul(vec4(positionWorld, 1));
  const edge = max(
    abs(projected.x.div(projected.w).sub(0.5)),
    abs(projected.y.div(projected.w).sub(0.5)),
  ).mul(2);
  return mix(float(1), shadow, float(1).sub(smoothstep(0.72, 0.98, edge)));
});

// ---------------------------------------------------------------------------
// Day cycle palette. The rule that keeps the world infinite: fog color equals
// the horizon color, always.
// ---------------------------------------------------------------------------
const KEYS = L.keys;
const pal = {
  zenith: C(0),
  upper: C(0),
  horizon: C(0),
  horizonWarm: C(0),
  upperWarm: C(0),
  glow: C(0),
  below: C(0),
  sun: C(0),
  sunI: 1,
  hemiSky: C(0),
  hemiGround: C(0),
  hemiI: 1,
};
function evalPalette(p) {
  p = p - Math.floor(p);
  let i = 0;
  while (KEYS[i + 1].t < p) i++;
  const a = KEYS[i],
    b = KEYS[i + 1];
  const t = sstep(0, 1, (p - a.t) / (b.t - a.t));
  for (const k of [
    'zenith',
    'upper',
    'horizon',
    'horizonWarm',
    'upperWarm',
    'glow',
    'below',
    'sun',
    'hemiSky',
    'hemiGround',
  ])
    pal[k].copy(a[k]).lerp(b[k], t);
  pal.sunI = a.sunI + (b.sunI - a.sunI) * t;
  pal.hemiI = a.hemiI + (b.hemiI - a.hemiI) * t;
}

// uniforms shared by sky, fog, materials
const uZenith = uniform(C(0)),
  uUpper = uniform(C(0)),
  uHorizon = uniform(C(0)),
  uHorizonWarm = uniform(C(0)),
  uUpperWarm = uniform(C(0)),
  uBelow = uniform(C(0)),
  uSunColor = uniform(C(0));
const uSunDir = uniform(new THREE.Vector3(0, 1, 0)); // the true sun, even below the horizon
const uMoonDir = uniform(new THREE.Vector3(0, 1, 0));
const uMoonUp = uniform(0); // the moon is above the horizon
const uMoonLight = uniform(0); // moonlight strength: night, moon up
const uNight = uniform(0);
const uLowSun = uniform(0); // the sun sits on the horizon
const uGlow = uniform(C(0)); // the sun-side horizon band
const uGlowI = uniform(0);
const uVenusI = uniform(0); // the rose belt opposite a low sun
const MOON_COLOR = C(L.moon.color);
const uFogDensity = uniform(FOG_DENSITY);
const uAbove = uniform(0); // 1 when the camera is above the cloud deck
const uWhiteout = uniform(0); // 1 while crossing the deck
const uDeck = uniform(DECK_Y);
const cloudWhite = C(L.cloud.white);
const uCloudWhite = uniform(cloudWhite.clone()),
  uCloudBodies = uniform(0);

// One directional horizon owns both the sky boundary and every fogged surface.
const azimuthAlign = Fn(([dir, ref]) =>
  max(dot(dir.xz, ref.xz).div(max(length(dir.xz).mul(length(ref.xz)), 0.0001)), 0),
);
// Above the deck the far cloud sea meets a bright haze rather than a flat
// white: the horizon keeps the day's hue and its warmth toward the sun, so
// the sun stands out against it and the sea's far edge still meets the sky.
const horizonTint = Fn(([dir]) => {
  const align = pow(azimuthAlign(dir, uSunDir), 5);
  const base = mix(uHorizon, uHorizonWarm, align);
  const haze = mix(mix(uHorizon, uCloudWhite, 0.4), mix(uHorizonWarm, uGlow, uLowSun.mul(0.7)), align);
  return mix(mix(base, haze, uAbove), uCloudWhite, uWhiteout);
});

// fog: distance fog in the horizon color, plus a height fog below the cloud deck
// that becomes the cloud sea when the camera is above it, plus the whiteout.
{
  const distance = length(positionWorld.sub(cameraPosition));
  const distF = densityFogFactor(uFogDensity).mul(mix(1, 0.55, smoothstep(100, 1000, positionWorld.y)));
  const lowAir = distance
    .div(120)
    .clamp(0, 1)
    .mul(0.055)
    .mul(float(1).sub(smoothstep(200, 800, positionWorld.y)));
  // Preserve the study's gentle local air; only the far streamed edge needs cover.
  const farCover = smoothstep(2600, 4100, distance);
  const air = float(1).sub(float(1).sub(distF).mul(float(1).sub(lowAir)).mul(float(1).sub(farCover)));
  const seaF = exponentialHeightFogFactor(float(0.0000085), uDeck.sub(30)).mul(uAbove);
  const factor = max(max(air, seaF), uWhiteout);
  scene.fogNode = fog(horizonTint(normalize(positionWorld.sub(cameraPosition))), factor);
}

// ---------------------------------------------------------------------------
// Sky: a painted gradient keyed by time of day, dawn and dusk bands, a sun,
// a moon with its own face, stars and the Milky Way, then painted clouds.
// ---------------------------------------------------------------------------
const VENUS = vec3(0.86, 0.46, 0.52);
const SPARSE_STAR_AXIS = normalize(vec3(0.36, 0.5, -0.79));
// Shared by the dome and the star catalog: clouds occlude all
// celestial detail once, with the same shape. No galaxy is painted over them.
const paintedClouds = Fn(([dir]) => {
  const p = dir.xz.div(dir.y.max(0.025).add(0.19)).mul(vec2(2.8, 6)).add(vec2(time.mul(0.001), 0));
  const mass = mx_noise_float(p.mul(0.3).add(vec2(3, 12))).mul(0.28)
    .add(mx_noise_float(p).mul(0.6))
    .add(mx_noise_float(p.mul(2.1).add(8)).mul(0.3))
    .add(mx_noise_float(p.mul(5.8)).mul(0.16))
    .add(mx_noise_float(p.mul(15)).mul(0.06));
  // The night ceiling opens into clear windows, while the low cloud banks
  // and all near-deck cloud bodies keep their opacity.
  const opening = smoothstep(0.045, 0.22, dir.y).mul(uNight).mul(0.35);
  const mask = smoothstep(uNight.mul(0.14).sub(0.14).add(opening), uNight.mul(0.08).add(0.34).add(opening), mass)
    .mul(smoothstep(0.014, 0.15, dir.y));
  return vec2(mass, mask);
});
const celestialVisibility = Fn(([dir]) => uNight.mul(float(1).sub(uMoonLight.mul(0.45)))
  .mul(smoothstep(0.0, 0.15, dir.y)).mul(float(1).sub(uWhiteout)));
const galaxy = createMilkyWay(Fn(([dir]) => celestialVisibility(dir)
  .mul(float(1).sub(paintedClouds(dir).y.mul(mix(0.6, 0.94, uNight))))));
scene.add(galaxy.stars);
// Sparse hashed stars: one cell grid per layer, brightness and tint per star.
const starField = Fn(([dir, scale, threshold]) => {
  const sc = dir.mul(scale);
  const cellId = sc.floor(),
    cf = fract(sc);
  const seedA = dot(cellId, vec3(1.0, 57.0, 113.0));
  const center = vec3(hash(seedA), hash(seedA.add(11.0)), hash(seedA.add(29.0)));
  const dd = length(cf.sub(center));
  const isStar = step(threshold, hash(seedA.add(3.0)));
  const bright = hash(seedA.add(17.0));
  const dotv = smoothstep(0.2, 0.02, dd).mul(isStar).mul(mix(0.45, 1.7, bright.mul(bright)));
  const twinkle = sin(time.mul(1.3).add(hash(seedA.add(5.0)).mul(40.0)))
    .mul(0.3)
    .add(0.7);
  const tint = mix(vec3(0.76, 0.83, 1.0), vec3(1.0, 0.9, 0.78), hash(seedA.add(41.0)));
  return tint.mul(dotv).mul(twinkle);
});
const skyColor = Fn(([dir]) => {
  const y = dir.y;
  const sunUp = smoothstep(-0.14, 0.02, uSunDir.y);
  const s = max(dot(dir, uSunDir), 0.0).mul(sunUp);
  const align = azimuthAlign(dir, uSunDir);
  const anti = azimuthAlign(dir, uSunDir.negate());
  const horizon = horizonTint(dir);
  // sun-side warmth climbs higher the closer to the sun's azimuth
  const warmUpper = mix(uUpper, uUpperWarm, pow(align, 3.5).mul(0.8).add(pow(s, 5).mul(0.2)));
  const skyUp = mix(warmUpper, uZenith, smoothstep(0.1, 0.85, y));
  const aboveH = mix(horizon, skyUp, smoothstep(0.0, 0.4, y));
  const belowH = mix(horizon, uBelow, smoothstep(0.0, -0.25, y));
  const col = select(y.greaterThan(0.0), aboveH, belowH).toVar();
  // dawn and dusk: a thin saturated band along the sun-side horizon
  const band = pow(align, 3).mul(exp(abs(y).div(0.07).negate())).mul(uGlowI);
  col.assign(mix(col, uGlow, band.mul(0.8)));
  // the belt of Venus: a rose band opposite a low sun, over the earth's blue shadow
  const venusShape = exp(y.sub(0.07).div(0.06).pow(2).negate());
  const venus = pow(anti, 2).mul(venusShape).mul(uVenusI);
  col.assign(mix(col, VENUS, venus.mul(0.35)));
  const earthShadow = pow(anti, 2).mul(smoothstep(0.06, 0.0, y)).mul(smoothstep(-0.05, 0.01, y)).mul(uVenusI);
  col.assign(mix(col, col.mul(vec3(0.78, 0.84, 1.0)), earthShadow.mul(0.5)));
  // the sun: a disc, a tight glow, and a broad warm halo when it sits low
  const ang = acos(clamp(s, 0.0, 1.0));
  const disc = smoothstep(0.03, 0.024, ang);
  const sunCol = mix(uSunColor, uGlow, uLowSun.mul(0.6));
  const glow = pow(s, 30)
    .mul(0.12)
    .add(pow(s, 500).mul(0.6))
    .add(pow(s, 4).mul(uLowSun).mul(0.35));
  col.addAssign(sunCol.mul(glow.add(disc.mul(mix(1.2, 0.8, uLowSun)))).mul(smoothstep(-0.02, 0.0, y)));
  // the moon: a lit gibbous face with maria and limb darkening, a soft halo
  const m = max(dot(dir, uMoonDir), 0.0);
  const moonRight = normalize(cross(uMoonDir, vec3(0, 1, 0)));
  const moonUpV = cross(moonRight, uMoonDir);
  const MOON_R = 0.025;
  const u = dot(dir, moonRight).div(MOON_R),
    v = dot(dir, moonUpV).div(MOON_R);
  const rr = length(vec2(u, v));
  const discM = smoothstep(1.0, 0.9, rr).mul(step(0.0, m));
  const maria = mx_noise_float(vec2(u, v).mul(2.2).add(vec2(5.3, 1.7)))
    .mul(0.5)
    .add(mx_noise_float(vec2(u, v).mul(5.5).add(vec2(9.0, 3.0))).mul(0.3));
  const albedo = float(1).sub(smoothstep(0.05, 0.45, maria).mul(0.32));
  const limb = float(1).sub(rr.mul(rr).mul(0.25));
  const chord = sqrt(max(float(1).sub(v.mul(v)), 0.0001));
  const litSide = sign(dot(uSunDir, moonRight).add(0.0001));
  const lit = smoothstep(-0.8, -0.55, u.mul(litSide).div(chord));
  const moonSurface = albedo.mul(limb).mul(mix(0.06, 1.0, lit));
  const moonNight = vec3(0.98, 0.97, 0.92).mul(moonSurface).mul(1.35);
  const moonDay = col.mul(1.12).add(vec3(0.05)).mul(mix(0.55, 1.0, moonSurface));
  col.assign(mix(col, mix(moonDay, moonNight, uNight), discM.mul(uMoonUp)));
  const halo = pow(m, 250).mul(0.35).add(pow(m, 30).mul(0.06));
  col.addAssign(vec3(0.75, 0.8, 0.95).mul(halo).mul(uNight).mul(uMoonUp).mul(float(1).sub(discM)));
  // painted clouds: their mass and mask come first so stars can hide behind them
  const cloud = paintedClouds(dir), mass = cloud.x, mask = cloud.y;
  // stars and the Milky Way, only at night, fading into the horizon haze
  const sparseBand = exp(dot(dir, SPARSE_STAR_AXIS).div(0.15).pow(2).negate());
  const stars = starField(dir, 90.0, 0.955)
    .add(starField(dir, 200.0, float(0.975).sub(sparseBand.mul(0.05))).mul(0.5))
    .add(galaxy.radiance(dir));
  col.addAssign(stars.mul(celestialVisibility(dir)));
  // clouds: lit toward the sun, on fire at sunset, blushing opposite it, moonlit at night
  const shade = mix(uUpper.mul(0.85), horizon, 0.28);
  const light = mix(uCloudWhite, sunCol, pow(s, 4).mul(0.75))
    .toVar();
  light.assign(mix(light, uGlow, uLowSun.mul(pow(align, 1.5)).mul(0.7)));
  light.assign(mix(light, mix(light, VENUS, 0.5), uVenusI.mul(pow(anti, 1.5)).mul(0.6)));
  light.addAssign(vec3(0.5, 0.55, 0.7).mul(pow(m, 6)).mul(uMoonLight).mul(0.35));
  col.assign(mix(col, mix(light, shade, smoothstep(0.02, 0.36, mass)),
    mask.mul(mix(0.6, 0.94, uNight))));
  const edge = smoothstep(-0.18, 0.08, mass).mul(float(1).sub(smoothstep(0.08, 0.24, mass)));
  col.addAssign(
    sunCol
      .mul(edge)
      .mul(pow(s, 15))
      .mul(0.7)
      .mul(smoothstep(0.025, 0.12, y)),
  );
  return col;
});
// The dome only ever reads a direction, so its radius is free; it sits beyond
// the far corner of the streamed terrain (a little under six kilometres) so
// that nothing opaque is ever behind it. That lets it draw last among the
// opaque objects instead of first: the depth test then throws away every
// fragment the ground, the trees and the water already cover, and this shader
// (bands, sun, moon, painted cloud, two star fields and the galaxy) runs only
// on the sky a viewer can actually see. It writes no depth, so the stars and
// the clouds that follow it are unaffected.
const sky = new THREE.Mesh(new THREE.SphereGeometry(12000, 48, 24), new MeshBasicNodeMaterial());
{
  const m = sky.material;
  m.side = THREE.BackSide;
  m.depthWrite = false;
  m.fog = false;
  m.colorNode = skyColor(normalize(positionWorld.sub(cameraPosition)));
}
sky.renderOrder = 1;
scene.add(sky);

// ---------------------------------------------------------------------------
// The approved illustrated response: broad diffuse groups, no specular lobe.
// ---------------------------------------------------------------------------
class SoftIllustratedLighting extends THREE.LightingModel {
  direct({ lightDirection, lightColor, reflectedLight }) {
    const nl = dot(normalView, lightDirection);
    const bands = mix(0.18, 0.72, smoothstep(-0.18, 0.15, nl)).add(smoothstep(0.5, 0.85, nl).mul(0.15));
    reflectedLight.directDiffuse.addAssign(
      lightColor
        .mul(mix(max(nl, 0), bands, 0.65))
        .mul(diffuseColor.rgb)
        .mul(1 / Math.PI),
    );
  }
  indirect(builder) {
    const { irradiance, ambientOcclusion, reflectedLight } = builder.context;
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(diffuseColor.rgb).mul(1 / Math.PI));
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
  }
}
function litMaterial(colorNode, opts = {}) {
  const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0, ...(opts.basic || {}) });
  const base = vec4(colorNode);
  const compressed = pow(max(base.rgb, vec3(0.0001)), vec3(LOOK.materialPow)).mul(0.94);
  const value = dot(compressed, vec3(0.2126, 0.7152, 0.0722));
  m.colorNode = vec4(mix(compressed, vec3(value), LOOK.materialGray), base.a);
  m.setupLightingModel = () => new SoftIllustratedLighting();
  m.receivedShadowNode = receiveSoftShadow;
  if (opts.emissiveNode) m.emissiveNode = opts.emissiveNode.mul(0.25);
  return m;
}
function paintedSample(map) {
  const image = map.image,
    bytes = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
  const linear = Array.from(
    { length: 256 },
    (_, i) => C(0).setRGB(i / 255, 0, 0, THREE.SRGBColorSpace).r,
  );
  const mean = C(0);
  let weight = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const a = bytes[i + 3] / 255;
    mean.r += linear[bytes[i]] * a;
    mean.g += linear[bytes[i + 1]] * a;
    mean.b += linear[bytes[i + 2]] * a;
    weight += a;
  }
  mean.multiplyScalar(1 / Math.max(1, weight));
  const sharp = texture(map);
  return vec4(mix(sharp.bias(0.8).rgb, uniform(mean), 0.38), sharp.a);
}
const satU = float(L.sat);
const stylize = (c) => saturation(c, satU);

// ---------------------------------------------------------------------------
// Indexed terrain reads CPU heights and smooth normals. Biomes belong to
// each triangle, not a colored corner; shore masks use actual fragment height.
// ---------------------------------------------------------------------------
const uOrigin = uniform(new THREE.Vector2(0, 0));
const uWaterOrigin = uniform(new THREE.Vector2(0, 0));
const palette = {};
for (const k of Object.keys(L.terrain)) palette[k] = uniform(C(L.terrain[k]));
const K = (hex) => {
  const c = C(hex);
  return vec3(c.r, c.g, c.b);
};
// The road's paint and the headlight's pool. The asphalt is a warm grey, a
// little patched; the lines are a worn paper white and fade with distance
// before they could shimmer.
const ROAD_PAINT = {
  asphalt: K(0x5f5d58),
  patch: K(0x4f4e4b),
  gravel: K(0xa39883),
  line: K(0xe6e0d0),
  dash: 9, // meters of dash and gap along z
  lamp: K(0xffe2a8),
};
// The headlight: the bike's place, heading and how strongly it shines (night only).
const uLamp = uniform(new THREE.Vector4(0, 0, 0, 0));
const biomeColors = BIOMES.map((biome) => ({
  base: libraryColor(`biome ${biome.id}.ground.base`, biome.ground.base),
  alt: libraryColor(`biome ${biome.id}.ground.alt`, biome.ground.alt),
  rock: libraryColor(`biome ${biome.id}.ground.rock`, biome.ground.rock),
  field: biome.ground.pattern ? libraryColor(`biome ${biome.id}.ground.field`, biome.ground.field) : null,
}));
const biomeUniforms = biomeColors.map((colors) => ({
  base: uniform(colors.base.clone()),
  alt: uniform(colors.alt.clone()),
  rock: uniform(colors.rock.clone()),
  field: colors.field ? uniform(colors.field.clone()) : null,
}));
const loadCell = (ix, iz) => textureLoad(hfTex, ivec2(ix.mod(N).toInt(), iz.mod(N).toInt()));
const loadRoad = (iz) => textureLoad(roadTex, ivec2(iz.mod(N).toInt(), 0));
function buildGrid(cells, cell) {
  const side = cells + 1,
    count = side * side;
  const positions = new Float32Array(count * 3),
    normals = new Float32Array(count * 3);
  const indices =
    count > 65535 ? new Uint32Array(cells * cells * 6) : new Uint16Array(cells * cells * 6);
  let index = 0;
  for (let z = 0; z <= cells; z++)
    for (let x = 0; x <= cells; x++) {
      const vertex = z * side + x;
      positions[vertex * 3] = (x - cells / 2) * cell;
      positions[vertex * 3 + 2] = (z - cells / 2) * cell;
      normals[vertex * 3 + 1] = 1;
      if (x < cells && z < cells) {
        // Same diagonal as heightAt, including at negative world coordinates.
        indices.set(
          [vertex, vertex + side, vertex + 1, vertex + side + 1, vertex + 1, vertex + side],
          index,
        );
        index += 6;
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

let terrainMat;
{
  const wx = positionLocal.x.add(uOrigin.x),
    wz = positionLocal.z.add(uOrigin.y);
  const ix = wx.div(CELL).add(0.5).floor(),
    iz = wz.div(CELL).add(0.5).floor();
  const sample = loadCell(ix, iz),
    hv = sample.x;
  const surfaceNormal = normalize(
    vec3(
      loadCell(ix.sub(1), iz).x.sub(loadCell(ix.add(1), iz).x),
      CELL * 2,
      loadCell(ix, iz.sub(1)).x.sub(loadCell(ix, iz.add(1)).x),
    ),
  );
  // Reconstruct the facet centroid's three samples in the fragment stage.
  // This keeps triangle-owned biome color without duplicating indexed vertices.
  const cell = positionWorld.xz.div(CELL),
    base = cell.floor();
  const upper = step(1, fract(cell.x).add(fract(cell.y)));
  const a = loadCell(base.x.add(upper), base.y.add(upper));
  const b = loadCell(base.x.add(1), base.y),
    c = loadCell(base.x, base.y.add(1));
  const h = positionWorld.y,
    temp = a.y.add(b.y).add(c.y).div(3),
    moist = a.z.add(b.z).add(c.z).div(3),
    region = a.w.add(b.w).add(c.w).div(3);
  const slope = float(1).sub(varying(surfaceNormal).normalize().y);
  const xz = positionWorld.xz,
    distance = length(positionWorld.sub(cameraPosition));

  // The GPU side of biomeWeights: the same cells, the same sharpening, on
  // the triangle's own climate, so ground color and placement agree.
  const climateAxisNode = (v) => v.sub(0.5).mul(CLIMATE_STRETCH).add(0.5).clamp(0, 1);
  const ct = climateAxisNode(temp),
    cm = climateAxisNode(moist),
    cr = climateAxisNode(region);
  // Farmland. Paddies follow the contours, so on gentle ground they are wide
  // and on a slope they crowd into terraces, each with its bund; a slow grid
  // splits the flats, and each paddy is flooded, green or gold of its own.
  // Planted rows run their own way in each field, on red earth, some fields
  // cleared. Fine lines fade with distance before they could shimmer, leaving
  // the patchwork.
  const near = float(1).sub(smoothstep(140, 700, distance));
  const terraces = (() => {
    const wobble = mx_noise_float(xz.mul(0.012)).mul(0.7);
    const band = h.div(1.7).add(wobble),
      ring = fract(band);
    const plot = xz.add(vec2(mx_noise_float(xz.mul(0.02)).mul(6), mx_noise_float(xz.mul(0.02).add(9)).mul(6))).div(38),
      edge = max(abs(fract(plot.x).sub(0.5)), abs(fract(plot.y).sub(0.5)));
    const id = hash(band.floor().mul(17.3).add(plot.x.floor().mul(3.1)).add(plot.y.floor().mul(7.9)));
    const bund = max(smoothstep(0.86, 0.95, ring), smoothstep(0.46, 0.49, edge)).mul(near);
    return { flooded: step(id, 0.38), gold: step(0.82, id), bund };
  })();
  const rows = (() => {
    const plot = xz.div(120),
      id = plot.floor(),
      r = hash(id.x.mul(12.9).add(id.y.mul(78.2))),
      angle = r.mul(Math.PI);
    const dir = vec2(cos(angle), sin(angle));
    const stripe = sin(dot(xz, dir).mul(Math.PI * 2 / 1.7));
    const plants = mix(float(0.62), smoothstep(-0.35, 0.35, stripe), float(1).sub(smoothstep(40, 160, distance)));
    const lane = smoothstep(0.47, 0.495, max(abs(fract(plot.x).sub(0.5)), abs(fract(plot.y).sub(0.5))));
    const cleared = step(0.86, hash(id.x.mul(4.1).add(id.y.mul(9.7)).add(3)));
    const young = step(0.62, r);
    return float(1).sub(plants.mul(mix(1, 0.55, young))).max(cleared).max(lane).clamp(0, 1);
  })();
  const colorNode = Fn(() => {
    const macro = smoothstep(0.18, 0.48, mx_noise_float(xz.mul(0.012)));
    const distances = BIOMES.map(({ climate: [t0, m0, r0] }) =>
      ct.sub(t0).pow(2).add(cm.sub(m0).pow(2)).add(cr.sub(r0).pow(2)).div(CLIMATE_RADIUS * CLIMATE_RADIUS).toVar(),
    );
    let nearest = distances[0];
    for (const d of distances.slice(1)) nearest = nearest.min(d);
    let ground = vec3(0).toVar(),
      rock = vec3(0).toVar(),
      total = float(0).toVar();
    distances.forEach((d, i) => {
      const w = exp(d.sub(nearest).mul(-CLIMATE_SHARPNESS)),
        u = biomeUniforms[i],
        pattern = BIOMES[i].ground.pattern;
      let own = mix(u.base, u.alt, macro);
      if (pattern === 'terraces') {
        const water = mix(u.field, uHorizon, 0.3);
        own = mix(mix(u.base, u.alt, terraces.gold), water, terraces.flooded);
        own = mix(own, u.base.mul(0.78), terraces.bund);
      } else if (pattern === 'rows') own = mix(own, u.field, rows);
      ground.addAssign(own.mul(w));
      rock.addAssign(u.rock.mul(w));
      total.addAssign(w);
    });
    ground.divAssign(total);
    rock.divAssign(total);
    ground.assign(mix(palette.seaFloor, ground, smoothstep(-10.0, 0.5, h)));
    ground.assign(mix(ground, rock, smoothstep(0.3, 0.52, slope)));
    return stylize(ground);
  })();
  const brush = mx_noise_float(xz.mul(0.018))
    .mul(0.04)
    .add(mx_noise_float(xz.mul(0.13)).mul(0.015))
    .add(1);
  // The road, painted from the CPU's own rows: the centre line interpolated
  // between them exactly as road.x does, the distance across it measured
  // square to the road, asphalt, gravel shoulders, edge lines and a dashed
  // centre line. The ground under it is the carved bench, so it lies flat.
  const fz = wz.div(CELL),
    rz = fz.floor(),
    r0 = loadRoad(rz),
    r1 = loadRoad(rz.add(1));
  const centre = mix(r0.x, r1.x, fract(fz)),
    tangent = r0.y.div(CELL);
  const across = positionWorld.x.sub(centre).div(sqrt(tangent.mul(tangent).add(1))),
    side = abs(across);
  const aa = max(float(0.06), distance.mul(0.0016));
  const asphalt = float(1).sub(smoothstep(ROAD.half - aa, ROAD.half + aa, side));
  const shoulder = float(1).sub(smoothstep(ROAD.shoulder - 0.6, ROAD.shoulder + 0.8, side));
  const lineFade = float(1).sub(smoothstep(90, 320, distance));
  const edgeLine = smoothstep(ROAD.half - 0.5 - aa, ROAD.half - 0.5, side).mul(float(1).sub(smoothstep(ROAD.half - 0.32, ROAD.half - 0.32 + aa, side)));
  const dash = step(fract(positionWorld.z.div(ROAD_PAINT.dash * 2)), 0.5).mul(float(1).sub(smoothstep(0.07, 0.07 + aa, side)));
  const patches = smoothstep(0.35, 0.6, mx_noise_float(xz.mul(0.09))).mul(0.6);
  let surface = mix(ROAD_PAINT.asphalt, ROAD_PAINT.patch, patches);
  surface = mix(surface, ROAD_PAINT.line, edgeLine.max(dash).mul(lineFade).mul(0.9));
  const grounded = mix(palette.sand, colorNode, smoothstep(1.5, 7.5, h));
  const painted = mix(mix(grounded, ROAD_PAINT.gravel, shoulder.mul(0.8)), surface, asphalt);
  // The headlight's pool on the ground ahead of the bike, at night.
  const toward = xz.sub(uLamp.xy),
    forward = vec2(sin(uLamp.z), cos(uLamp.z));
  const along = dot(toward, forward),
    beside = abs(dot(toward, vec2(forward.y, forward.x.negate())));
  const pool = smoothstep(1.5, 6, along)
    .mul(float(1).sub(smoothstep(14, 48, along)))
    .mul(float(1).sub(smoothstep(along.mul(0.2).add(1), along.mul(0.42).add(2.5), beside)))
    .mul(uLamp.w);
  // Shore masks use the actual fragment height, never interpolated corner colors.
  terrainMat = litMaterial(painted.mul(brush), {
    emissiveNode: painted.mul(ROAD_PAINT.lamp).mul(pool).mul(5),
  });
  terrainMat.positionNode = vec3(positionLocal.x, hv, positionLocal.z);
  terrainMat.normalNode = transformNormalToView(varying(surfaceNormal).normalize());
}
const terrain = new THREE.Mesh(buildGrid(TERRAIN_CELLS, CELL), terrainMat);
terrain.frustumCulled = false;
terrain.receiveShadow = true;
scene.add(terrain);

// Approved jade coves: the same one opaque draw, with CPU-owned depth and
// soft, footprint-filtered ripples. The shader lives in src/water.js.
const waterMaterial = createWaterMaterial({
  time, origin: uWaterOrigin, seaLevel: SEA_LEVEL, cellSize: CELL, loadCell,
  palette, litMaterial, horizonTint, azimuthAlign,
  sky: {
    zenith: uZenith, upper: uUpper, upperWarm: uUpperWarm,
    sunDir: uSunDir, sunColor: uSunColor, moonDir: uMoonDir,
    moonLight: uMoonLight, lowSun: uLowSun, glow: uGlow,
  },
});
const water = new THREE.Mesh(buildGrid(WATER_CELLS, WATER_CELL), waterMaterial);
water.frustumCulled = false;
scene.add(water);

// ---------------------------------------------------------------------------
// Geometry helpers for the procedural props (no assets anywhere).
// ---------------------------------------------------------------------------
function mergeParts(parts) {
  // parts: [{ geometry, matrix, color, card }]; returns one non-indexed geometry with
  // vertex colors. Leaf cards also carry their center and whether the distant crown
  // keeps them, packed into one attribute: WebGPU allows only eight vertex buffers.
  const positions = [],
    normals = [],
    colors = [],
    uvs = [],
    cards = [];
  const nm = new THREE.Matrix3();
  for (const p of parts) {
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry;
    const pos = g.attributes.position,
      nor = g.attributes.normal;
    const m = p.matrix || new THREE.Matrix4();
    nm.getNormalMatrix(m);
    const v = new THREE.Vector3(),
      n = new THREE.Vector3();
    const c = p.color !== undefined ? new THREE.Color(p.color) : new THREE.Color(0xffffff);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      positions.push(v.x, v.y, v.z);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      normals.push(n.x, n.y, n.z);
      colors.push(c.r, c.g, c.b);
      uvs.push(g.attributes.uv?.getX(i) ?? 0, g.attributes.uv?.getY(i) ?? 0);
      if (p.card) cards.push(p.card.center.x, p.card.center.y, p.card.center.z, p.card.kept ? 1 : 0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (cards.length) geo.setAttribute('card', new THREE.Float32BufferAttribute(cards, 4));
  return geo;
}
const M = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
// vertex-colored props: color comes from the geometry, tinted per instance when instanced
function propMaterial(extra = {}) {
  return litMaterial(stylize(attribute('color', 'vec3')), extra);
}

// ---------------------------------------------------------------------------
// Trees: every species in the library is one baked tree, instanced whole and
// tinted per instance by its climate. All species share the crown rules.
// ---------------------------------------------------------------------------
// Painted leaves. Each form is a different way of filling the card: broad
// leaves, needle bundles, palm fronds, or blossom petals.
function leafTexture(leaf) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d'),
    r = mulberry32(178);
  ctx.lineCap = 'round';
  const form = leaf.form ?? 'broad';
  if (form === 'frond') {
    // long feathered blades radiating from the stem
    for (let j = 0; j < 9; j++) {
      const a = -0.35 + (j / 8) * 0.7 - Math.PI / 2 + (r() - 0.5) * 0.12,
        len = 215 + r() * 30;
      ctx.strokeStyle = leaf.dark[j % 3];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(256, 470);
      ctx.lineTo(256 + Math.cos(a) * len, 470 + Math.sin(a) * len);
      ctx.stroke();
      for (let k = 8; k < len; k += 7) {
        const x = 256 + Math.cos(a) * k,
          y = 470 + Math.sin(a) * k,
          w = 26 * (1 - k / len) + 6;
        ctx.strokeStyle = [...leaf.mid, leaf.light][(k / 7 + j) % 4 | 0];
        ctx.lineWidth = 3.5;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a + side * 1.1) * w, y + Math.sin(a + side * 1.1) * w);
          ctx.stroke();
        }
      }
    }
  } else if (form === 'needle') {
    // bundles of short needles around twigs
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * Math.PI * 2;
      ctx.strokeStyle = '#4a4634';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(256, 256);
      ctx.lineTo(256 + Math.cos(a) * 190, 256 + Math.sin(a) * 190);
      ctx.stroke();
    }
    for (let j = 0; j < 900; j++) {
      const a = r() * Math.PI * 2,
        rad = Math.sqrt(r()) * 200;
      const x = 256 + Math.cos(a) * rad,
        y = 256 + Math.sin(a) * rad,
        dir = a + (r() - 0.5) * 1.2,
        len = 14 + r() * 16;
      ctx.strokeStyle = [...leaf.dark, ...leaf.mid, leaf.light][j % 7];
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(dir) * len, y + Math.sin(dir) * len);
      ctx.stroke();
    }
  } else {
    for (let j = 0; j < 11; j++) {
      const a = (j / 11) * Math.PI * 2,
        x = 256 + Math.cos(a) * 170,
        y = 256 + Math.sin(a) * 170;
      ctx.strokeStyle = form === 'petal' ? '#6b5a4a' : '#526b3e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(256, 275);
      ctx.quadraticCurveTo((256 + x) / 2, 220, x, y);
      ctx.stroke();
    }
    for (let j = 0; j < 360; j++) {
      const a = r() * Math.PI * 2,
        rad = Math.sqrt(r()) * (177 + 20 * Math.sin(a * 5));
      ctx.save();
      ctx.translate(256 + Math.cos(a) * rad, 256 + Math.sin(a) * rad);
      ctx.rotate(a + (r() - 0.5) * 1.8);
      const len = 16 + r() * 15,
        w = 7 + r() * 7,
        g = ctx.createLinearGradient(-len / 2, w, len / 2, -w);
      g.addColorStop(0, leaf.dark[j % 3]);
      g.addColorStop(0.55, leaf.mid[j % 3]);
      g.addColorStop(1, leaf.light);
      ctx.fillStyle = g;
      ctx.beginPath();
      if (form === 'petal') {
        // five round petals about a small heart
        for (let k = 0; k < 5; k++) {
          const pa = (k / 5) * Math.PI * 2;
          ctx.moveTo(Math.cos(pa) * w * 0.9 + w * 0.55, Math.sin(pa) * w * 0.9);
          ctx.arc(Math.cos(pa) * w * 0.9, Math.sin(pa) * w * 0.9, w * 0.55, 0, Math.PI * 2);
        }
      } else {
        ctx.moveTo(-len * 0.55, 0);
        ctx.bezierCurveTo(-len * 0.2, -w, len * 0.24, -w * 0.7, len * 0.6, 0);
        ctx.bezierCurveTo(len * 0.15, w * 0.8, -len * 0.28, w, -len * 0.55, 0);
      }
      ctx.fill();
      if (form !== 'petal') {
        ctx.strokeStyle = '#cee09a55';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(-len * 0.4, 0);
        ctx.lineTo(len * 0.45, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}
const barkCanvas = document.createElement('canvas');
barkCanvas.width = 512;
barkCanvas.height = 1024;
const bc = barkCanvas.getContext('2d'),
  br = mulberry32(911);
bc.fillStyle = '#73775b';
bc.fillRect(0, 0, 512, 1024);
for (let j = 0; j < 150; j++) {
  const x = br() * 512,
    phase = br() * Math.PI * 2,
    width = 2 + br() * 14;
  for (const wrap of [-512, 0, 512]) {
    bc.strokeStyle = ['#4f5b43', '#8d906a', '#656c50', '#a2a07b', '#596347'][j % 5];
    bc.lineWidth = width;
    bc.beginPath();
    for (let y = -16; y <= 1040; y += 16) {
      const xx =
        x +
        wrap +
        Math.sin((y / 1024) * Math.PI * 4 + phase) * 8 +
        Math.sin((y / 1024) * Math.PI * 10 + phase) * 3;
      y === -16 ? bc.moveTo(xx, y) : bc.lineTo(xx, y);
    }
    bc.stroke();
    bc.strokeStyle = '#b0ac8060';
    bc.lineWidth = 0.9;
    bc.stroke();
  }
}
bc.globalAlpha = 0.42;
bc.fillStyle = '#92947a';
bc.fillRect(0, 0, 512, 1024);
bc.globalAlpha = 1;
const barkMap = new THREE.CanvasTexture(barkCanvas);
barkMap.colorSpace = THREE.SRGBColorSpace;
barkMap.wrapS = barkMap.wrapT = THREE.RepeatWrapping;
const barkRelief = new THREE.CanvasTexture(barkCanvas);
barkRelief.wrapS = barkRelief.wrapT = THREE.RepeatWrapping;
// Detail levels never switch, and nothing dithers: a screen-space dissolve
// between two crowns of different shape reads as a stripe of grain. The distant
// crown is every KEEP-th card of the full crown, enlarged, so over a band of
// camera distance the full crown morphs into it: kept cards grow, the rest
// shrink to nothing, and at the band's end the two are pixel-identical, so
// the swap is invisible. Before the streamed ring ends, every tree shrinks into
// its base, because the fog is still thin there and a dissolve would show.
const TREE_RADIUS = LITE ? 1300 : 1900;
const CROWN_FADE = [540, 680],
  RING_FADE = [TREE_RADIUS - 220, TREE_RADIUS - 50];
// Each vertex reads its own instance base, so a whole tree shares one distance.
const treeBase = attribute('base', 'vec3');
const baseDistance = length(treeBase.sub(cameraPosition));
const crownBand = smoothstep(CROWN_FADE[0], CROWN_FADE[1], baseDistance);
const distantCrown = step(CROWN_FADE[1], baseDistance);
const ringScale = float(1).sub(smoothstep(RING_FADE[0], RING_FADE[1], baseDistance));
const grown = (position) => treeBase.add(position.sub(treeBase).mul(ringScale));
const sway = vec3(
  sin(time.mul(0.8).add(positionWorld.x.mul(0.05))).mul(attribute('position', 'vec3').y.mul(0.018)),
  0,
  0,
);
const barkSample = paintedSample(barkMap);
function woodMaterial(tint) {
  const m = litMaterial(vec4(barkSample.rgb.mul(uniform(tint)), barkSample.a));
  m.bumpMap = barkRelief;
  m.bumpScale = 0.015;
  m.positionNode = grown(positionLocal);
  return m;
}
function leafMaterial(map, visible, position) {
  const m = litMaterial(paintedSample(map), {
    basic: { side: THREE.DoubleSide, alphaTest: 0.04, alphaToCoverage: true },
  });
  m.normalNode = transformNormalToView(normalLocal);
  m.emissiveNode = texture(map).rgb.mul(0.025);
  m.opacityNode = visible;
  m.positionNode = grown(position.add(sway));
  return m;
}
// The full crown scales each card about its own center. Instancing has already
// moved the vertex, so the instance spin (cos, sin, xz scale, y scale) rebuilds
// the card center in world space from its tree-local one.
const spin = attribute('spin', 'vec4'),
  card = attribute('card', 'vec4'),
  cardCenter = card.xyz,
  cardKept = card.w;
const cardScaled = vec3(cardCenter.x.mul(spin.z), cardCenter.y.mul(spin.w), cardCenter.z.mul(spin.z));
const cardWorld = treeBase.add(
  vec3(
    cardScaled.x.mul(spin.x).add(cardScaled.z.mul(spin.y)),
    cardScaled.y,
    cardScaled.z.mul(spin.x).sub(cardScaled.x.mul(spin.y)),
  ),
);
const MAX_TREES = 4000;
// Bake one species: a trunk, its limbs, and a crown of painted cards. The
// distant crown is the kept cards enlarged, so it must be built from the same
// card list. Instance whole trees rather than upload 175 matrices per tree.
function bakeSpecies(id, spec) {
  const r = mulberry32(9702 + [...id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7));
  const woodParts = [],
    crownParts = [],
    distantParts = [];
  // The tree kit. A species grows through it: branch() lays wood, card()
  // hangs a painted card. Any generator that only does those two things keeps
  // the crown morph, the ring shrink and the tint rules for free.
  function branch(a, b, r1, r2) {
    const len = a.distanceTo(b),
      curve = new THREE.CatmullRomCurve3([
        a,
        a
          .clone()
          .lerp(b, 0.3)
          .add(new THREE.Vector3(-r1 * 0.3, len * 0.13, r1 * 0.4)),
        a.clone().lerp(b, 0.72),
        b,
      ]);
    const g = new THREE.TubeGeometry(curve, 4, 1, 6, false),
      p = g.attributes.position;
    for (let i = 0; i <= 4; i++) {
      const t = i / 4,
        center = curve.getPointAt(t),
        radius = THREE.MathUtils.lerp(r1, r2, t);
      for (let j = 0; j <= 6; j++) {
        const k = i * 7 + j;
        p.setXYZ(
          k,
          center.x + (p.getX(k) - center.x) * radius,
          center.y + (p.getY(k) - center.y) * radius,
          center.z + (p.getZ(k) - center.z) * radius,
        );
        g.attributes.uv.setXY(k, j / 3, (t * len) / 6);
      }
    }
    g.computeVertexNormals();
    woodParts.push({ geometry: g });
    return curve;
  }
  const cards = [];
  const addCard = (p, normal, rotation, size) =>
    cards.push({
      p,
      normal,
      size,
      matrix: rotation.isMatrix4 ? rotation : M(p.x, p.y, p.z, 1, 1, 1, rotation.x, rotation.y, rotation.z),
    });
  const { trunk: T, limbs: Lb } = spec,
    K = spec.crown ?? { shape: 'custom' };
  if (spec.bake) spec.bake({ THREE, random: r, branch, card: addCard, matrix: M, spec });
  else growTree();
  function growTree() {
  const trunk = branch(
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(T.lean, T.height, -T.lean * 0.25),
    T.radius,
    T.radius * (K.shape === 'cone' ? 0.12 : 0.33),
  );
  // limbs leave the trunk in a spiral; dome crowns hang a cloud of cards on each tip
  for (let j = 0; j < Lb.count; j++) {
    const a = j * 2.39996 + r() * 0.4,
      radius = Lb.spread * (0.85 + r() * 0.3);
    const tip = new THREE.Vector3(Math.cos(a) * radius, Lb.rise * (0.9 + r() * 0.25), Math.sin(a) * radius);
    branch(trunk.getPointAt(Math.min(0.95, Lb.from + j * 0.08)), tip, T.radius * 0.33, T.radius * 0.095);
    if (K.shape !== 'dome') continue;
    for (let k = 0; k < K.cards; k++) {
      const u = r() * Math.PI * 2,
        v = Math.acos(2 * r() - 1),
        rr = Math.pow(r(), 0.35);
      const p = new THREE.Vector3(
        tip.x + Math.cos(u) * Math.sin(v) * rr * K.radius,
        tip.y + Math.cos(v) * rr * K.height,
        tip.z + Math.sin(u) * Math.sin(v) * rr * K.radius,
      );
      addCard(
        p,
        new THREE.Vector3((p.x - tip.x) / K.radius, (p.y - tip.y) / K.height + 0.35, (p.z - tip.z) / K.radius).normalize(),
        new THREE.Euler((r() - 0.5) * 2.1, r() * Math.PI * 2, (r() - 0.5) * 0.7),
        K.size + r() * K.size * 0.5,
      );
    }
  }
  if (K.shape === 'cone') {
    // cards along the trunk in a cone that narrows toward the top
    for (let k = 0; k < K.cards; k++) {
      const t = K.from + (1 - K.from) * Math.pow(k / K.cards, 0.85),
        a = k * 2.39996,
        width = K.radius * Math.pow(1 - t, 0.75) * (0.55 + r() * 0.55);
      const center = trunk.getPointAt(Math.min(1, t)),
        p = new THREE.Vector3(center.x + Math.cos(a) * width, center.y + (r() - 0.3) * 0.8, center.z + Math.sin(a) * width);
      addCard(
        p,
        new THREE.Vector3(Math.cos(a), 0.55, Math.sin(a)).normalize(),
        new THREE.Euler(-0.5 + (r() - 0.5) * 0.9, -a + Math.PI / 2 + (r() - 0.5) * 0.5, (r() - 0.5) * 0.4),
        K.size * (0.7 + 0.45 * (1 - t)) + r() * 0.6,
      );
    }
  } else if (K.shape === 'fan') {
    // a ring of fronds from the top of the trunk, each painted from the
    // card's foot upward, so the card's own up axis is laid along the frond:
    // outward, drooping, its face turned to the sky
    const top = trunk.getPointAt(1);
    for (let k = 0; k < K.cards; k++) {
      const a = (k / K.cards) * Math.PI * 2 + r() * 0.3,
        droop = 0.15 + r() * 0.55,
        size = K.size * (0.85 + r() * 0.3);
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)),
        right = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)),
        frond = out
          .clone()
          .multiplyScalar(Math.cos(droop))
          .setY(-Math.sin(droop)),
        face = new THREE.Vector3().crossVectors(frond, right).normalize();
      if (face.y < 0) face.negate();
      const p = top.clone().addScaledVector(frond, size * 0.5 - 0.4).add(new THREE.Vector3(0, K.height * 0.3, 0));
      const basis = new THREE.Matrix4().makeBasis(right, frond, face).setPosition(p);
      addCard(p, face, basis, size);
    }
  }
  }
  if (cards.length > BUDGET.crownCards)
    throw new Error(`scenery library: species ${id}: ${cards.length} cards, the crown budget is ${BUDGET.crownCards}`);
  const keepEvery = Math.max(1, Math.round(cards.length / 35)),
    distantScale = 1 + 0.85 * ((keepEvery - 1) / 4);
  cards.forEach((c, k) => {
    const kept = k % keepEvery === 0;
    for (const [parts, factor] of [[crownParts, 1], ...(kept ? [[distantParts, distantScale]] : [])]) {
      const g = new THREE.PlaneGeometry(c.size * factor, c.size * factor);
      g.applyMatrix4(c.matrix);
      for (let i = 0; i < g.attributes.normal.count; i++)
        g.attributes.normal.setXYZ(i, c.normal.x, c.normal.y, c.normal.z);
      parts.push(parts === crownParts ? { geometry: g, card: { center: c.p, kept } } : { geometry: g });
    }
  });
  const woodGeo = mergeParts(woodParts),
    crownGeo = cards.length ? mergeParts(crownParts) : null,
    distantGeo = cards.length ? mergeParts(distantParts) : null;
  for (const part of [...woodParts, ...crownParts, ...distantParts]) part.geometry.dispose();
  (crownGeo ?? woodGeo).computeBoundingBox();
  const map = cards.length ? leafTexture(LEAVES[spec.leaf] ?? LEAVES.broad) : null;
  const wood = new THREE.InstancedMesh(woodGeo, woodMaterial(libraryColor(`species ${id}.trunk.tint`, spec.trunk.tint)), MAX_TREES);
  const meshes = [wood];
  const pool = { id, spec, wood, crown: null, distant: null, map, count: 0, near: 0, far: 0 };
  pool.top = (crownGeo ?? woodGeo).boundingBox.max.y;
  {
    // clearance from the baked shape itself, so any generator is honest
    const box = (crownGeo ?? woodGeo).boundingBox;
    pool.radius = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) + 2;
  }
  if (crownGeo) {
    const cardScale = mix(float(1).sub(crownBand), mix(1, distantScale, crownBand), cardKept);
    pool.crown = new THREE.InstancedMesh(
      crownGeo,
      leafMaterial(map, float(1).sub(distantCrown), cardWorld.add(positionLocal.sub(cardWorld).mul(cardScale))),
      MAX_TREES,
    );
    pool.distant = new THREE.InstancedMesh(distantGeo, leafMaterial(map, distantCrown, positionLocal), MAX_TREES);
    // The full crown also reads the instance spin, interleaved with the base
    // so the two share one vertex buffer: WebGPU allows eight per material.
    const leafInstance = new THREE.InstancedInterleavedBuffer(new Float32Array(MAX_TREES * 7), 7, 1);
    leafInstance.setUsage(THREE.DynamicDrawUsage);
    pool.crown.geometry.setAttribute('base', new THREE.InterleavedBufferAttribute(leafInstance, 3, 0));
    pool.spin = new THREE.InterleavedBufferAttribute(leafInstance, 4, 3);
    pool.crown.geometry.setAttribute('spin', pool.spin);
    meshes.push(pool.crown, pool.distant);
    pool.crown.castShadow = true;
  }
  for (const mesh of meshes) {
    if (mesh !== pool.crown) {
      const base = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TREES * 3), 3);
      base.setUsage(THREE.DynamicDrawUsage);
      mesh.geometry.setAttribute('base', base);
    }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    scene.add(mesh);
  }
  wood.castShadow = true;
  pool.meshes = meshes;
  pool.tint = {
    cold: libraryColor(`species ${id}.tint.cold`, spec.tint.cold),
    warm: libraryColor(`species ${id}.tint.warm`, spec.tint.warm),
    dry: libraryColor(`species ${id}.tint.dry`, spec.tint.dry),
  };
  return pool;
}
const speciesPools = {};
for (const [id, spec] of Object.entries(SPECIES)) speciesPools[id] = bakeSpecies(id, spec);
const speciesIds = Object.keys(speciesPools);
const treeRecords = [];
const TREE_CELL = 96;
// Crown assignment margins: a ring rebuild happens at most one cell after the
// bike crosses a cell, and the camera orbits at most CAMERA.maxDist from it.
const NEAR_CROWN = 830,
  FAR_CROWN = 400;
// The road keeps its verge clear: nothing stands within this of the asphalt's
// edge, a tree by its trunk and crown.
const VERGE = 4;
const roadSide = (x, z) => road.distance(x, z);
// Props: any object the library places in the world. Each kind bakes one
// geometry through the prop kit, is measured against its budget, and gets an
// instanced pool that shrinks into the ground at the ring's edge like a tree.
const propKit = {
  THREE,
  random: (name) => mulberry32(hash2(0x9e37, 0, [...String(name)].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 5))),
  merge: mergeParts,
  matrix: M,
  sstep,
  color: (value) => libraryColor('prop color', value),
};
const propMat = propMaterial();
propMat.positionNode = grown(positionLocal);
function makePool(geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  const base = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  base.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('base', base);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.count = 0;
  scene.add(mesh);
  return mesh;
}
const propPools = PROPS.map((entry) => {
  const geometry = entry.bake(propKit);
  const errors = validateBaked(entry, geometry);
  if (errors.length) throw new Error('scenery library: ' + errors.join('; '));
  const capacity = Math.min(BUDGET.propInstances, entry.budget?.instances ?? 500);
  return { entry, mesh: makePool(geometry, propMat, capacity), capacity, count: 0 };
});
const propRecords = [];
// A bounded, streamed ambient-occlusion sheet anchors trunks beyond the sun map.
const aoCanvas = document.createElement('canvas');
aoCanvas.width = aoCanvas.height = 512;
const aoContext = aoCanvas.getContext('2d'),
  aoMap = new THREE.CanvasTexture(aoCanvas);
// The sheet is painted in world order, so it must upload unflipped: a
// flipped upload mirrors every shade in z, and the mirrored shades then
// jump two cells whenever the sheet re-centers.
aoMap.flipY = false;
const aoOrigin = uniform(new THREE.Vector2()),
  AO_SPAN = 4096;
const aoUV = positionWorld.xz.sub(aoOrigin).div(AO_SPAN).add(0.5);
const aoEdge = max(abs(aoUV.x.sub(0.5)), abs(aoUV.y.sub(0.5)));
terrainMat.aoNode = mix(texture(aoMap, aoUV).r, 1, smoothstep(0.45, 0.5, aoEdge));
function updateGroundAO(x, z) {
  aoOrigin.value.set(x, z);
  aoContext.fillStyle = '#fff';
  aoContext.fillRect(0, 0, 512, 512);
  for (const tree of treeRecords) {
    const px = ((tree.x - x) / AO_SPAN + 0.5) * 512,
      pz = ((tree.z - z) / AO_SPAN + 0.5) * 512,
      r = ((tree.radius * 0.6) / AO_SPAN) * 512;
    const gradient = aoContext.createRadialGradient(px, pz, 0, px, pz, r);
    gradient.addColorStop(0, '#0006');
    gradient.addColorStop(0.3, '#0004');
    gradient.addColorStop(1, '#0000');
    aoContext.fillStyle = gradient;
    aoContext.fillRect(px - r, pz - r, r * 2, r * 2);
  }
  aoMap.needsUpdate = true;
}
let treeCellX = 1e9,
  treeCellZ = 1e9;
const _m4 = new THREE.Matrix4(),
  _q = new THREE.Quaternion(),
  _v3 = new THREE.Vector3(),
  _s3 = new THREE.Vector3(),
  _zero = new THREE.Vector3(),
  _col = new THREE.Color(),
  _col2 = new THREE.Color();
const _weights = new Float32Array(BIOMES.length),
  _mix = new Float32Array(speciesIds.length);
// What a climate wants: the biome weights folded over the library.
function placeTrees(bx, bz) {
  const cx = Math.floor(bx / TREE_CELL),
    cz = Math.floor(bz / TREE_CELL);
  if (cx === treeCellX && cz === treeCellZ) return;
  treeCellX = cx;
  treeCellZ = cz;
  const r = Math.ceil(TREE_RADIUS / TREE_CELL);
  let n = 0;
  treeRecords.length = 0;
  propRecords.length = 0;
  for (const pool of Object.values(speciesPools)) pool.count = pool.near = pool.far = 0;
  for (const pool of propPools) pool.count = 0;
  // What a prop's place() may ask about a cell: its climate, the ground, and
  // a random stream of its own, so props never reshuffle the trees.
  const cell = {
    size: TREE_CELL,
    corner: { x: 0, z: 0 },
    x: 0,
    z: 0,
    weights: _weights,
    biome: (id) => _weights[BIOMES.findIndex((biome) => biome.id === id)] ?? 0,
    mix(id) {
      let sum = 0;
      for (let i = 0; i < BIOMES.length; i++) sum += _weights[i] * (BIOMES[i].props?.[id] ?? 0);
      return sum;
    },
    blend(pick) {
      _col2.setRGB(0, 0, 0);
      for (let i = 0; i < BIOMES.length; i++) {
        const c = biomeColors[i][pick(BIOMES[i]) === BIOMES[i].ground.rock ? 'rock' : 'base'];
        _col2.r += _weights[i] * c.r;
        _col2.g += _weights[i] * c.g;
        _col2.b += _weights[i] * c.b;
      }
      return _col2;
    },
    roll: null,
    height: heightAt,
    slope: slopeAt,
    land: (x, z) => heightAt(x, z) > 3,
    // the road: how far a point is from its centre line, signed (+x side
    // positive), unsigned, and the road's heading at a z
    roadSide,
    road: (x, z) => Math.abs(roadSide(x, z)),
    roadHeading: (z) => road.heading(z),
  };
  for (let gz = cz - r; gz <= cz + r && n < MAX_TREES; gz++)
    for (let gx = cx - r; gx <= cx + r && n < MAX_TREES; gx++) {
      const ccx = (gx + 0.5) * TREE_CELL,
        ccz = (gz + 0.5) * TREE_CELL;
      if (Math.hypot(ccx - bx, ccz - bz) > TREE_RADIUS) continue;
      const h0 = heightAt(ccx, ccz);
      if (h0 < 3) continue;
      const temp = fieldAt(ccx, ccz, 1),
        moist = fieldAt(ccx, ccz, 2);
      biomeAt(ccx, ccz, _weights);
      let density = 0,
        mixTotal = 0;
      _mix.fill(0);
      for (let i = 0; i < BIOMES.length; i++) {
        const w = _weights[i],
          biome = BIOMES[i];
        density += w * biome.density;
        for (const [id, weight] of Object.entries(biome.species)) {
          _mix[speciesIds.indexOf(id)] += w * weight;
          mixTotal += w * weight;
        }
      }
      let s = hash2(gx, gz, seed);
      const roll = () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
      };
      // every prop kind gets its own stream from this cell
      cell.corner.x = gx * TREE_CELL;
      cell.corner.z = gz * TREE_CELL;
      cell.x = ccx;
      cell.z = ccz;
      for (const pool of propPools) {
        const stream = mulberry32(hash2(gx, gz, seed ^ hash2(pool.entry.id.length, 7, 0x51)));
        cell.roll = stream;
        for (const put of pool.entry.place(cell, propKit) ?? []) {
          if (pool.count >= pool.capacity) break;
          if (Math.abs(roadSide(put.x, put.z)) < ROAD.shoulder + VERGE + (pool.entry.obstacle?.radius ?? 1)) continue;
          const h = heightAt(put.x, put.z),
            scale = Array.isArray(put.scale) ? put.scale : [put.scale ?? 1, put.scale ?? 1, put.scale ?? 1];
          _q.setFromAxisAngle(_v3.set(0, 1, 0), put.yaw ?? 0);
          _m4.compose(_v3.set(put.x, h - (put.sink ?? 0), put.z), _q, _s3.set(scale[0], scale[1], scale[2]));
          pool.mesh.setMatrixAt(pool.count, _m4);
          pool.mesh.geometry.attributes.base.setXYZ(pool.count, put.x, h, put.z);
          pool.mesh.setColorAt(pool.count++, put.tint ?? _col.setRGB(1, 1, 1));
          const obstacle = pool.entry.obstacle;
          if (obstacle)
            propRecords.push({
              x: put.x,
              z: put.z,
              ground: h,
              top: h - (put.sink ?? 0) + obstacle.height * scale[1],
              radius: obstacle.radius * Math.max(scale[0], scale[2]),
              kind: pool.entry.id,
            });
        }
      }
      const grove = 2 + 4 * sstep(-0.25, 0.3, perlin2(ccx / 370, ccz / 370, seed ^ 0xc071));
      // This density cap keeps the entire ring inside its fixed allocation.
      const count = Math.min(3, Math.floor(density * grove));
      if (count <= 0 || mixTotal <= 0) continue;
      for (let k = 0; k < count && n < MAX_TREES; k++) {
        const ux = roll(),
          uz = roll(),
          us = roll(),
          pick = roll() * mixTotal;
        const px = (gx + ux) * TREE_CELL,
          pz = (gz + uz) * TREE_CELL;
        const h = heightAt(px, pz);
        if (h < 4 || slopeAt(px, pz) > 0.6) continue;
        let chosen = -1,
          acc = 0;
        for (let i = 0; i < _mix.length; i++) {
          if (_mix[i] <= 0) continue;
          acc += _mix[i];
          chosen = i;
          if (pick <= acc) break;
        }
        const pool = speciesPools[speciesIds[chosen]],
          spec = pool.spec;
        const sc = spec.scale[0] + us * (spec.scale[1] - spec.scale[0]),
          tall = sc * (0.9 + uz * 0.4),
          angle = ux * 6.283;
        // a crown may lean over the verge, a trunk may not stand in it
        if (Math.abs(roadSide(px, pz)) < ROAD.shoulder + VERGE + sc * pool.radius * 0.35) continue;
        _q.setFromAxisAngle(_v3.set(0, 1, 0), angle);
        _m4.compose(_v3.set(px, h, pz), _q, _s3.set(sc, tall, sc));
        pool.wood.setMatrixAt(pool.count, _m4);
        pool.wood.geometry.attributes.base.setXYZ(pool.count, px, h, pz);
        _col
          .copy(pool.tint.cold)
          .lerp(pool.tint.warm, sstep(0.3, 0.7, temp))
          .lerp(pool.tint.dry, sstep(0.45, 0.25, moist));
        pool.wood.setColorAt(pool.count++, _col);
        // Both crowns exist through the dissolve band, so a rebuild never changes what is drawn.
        const distance = Math.hypot(px - bx, pz - bz);
        if (pool.crown) {
          if (distance < NEAR_CROWN) {
            pool.crown.setMatrixAt(pool.near, _m4);
            pool.crown.geometry.attributes.base.setXYZ(pool.near, px, h, pz);
            pool.spin.setXYZW(pool.near, Math.cos(angle), Math.sin(angle), sc, tall);
            pool.crown.setColorAt(pool.near++, _col);
          }
          if (distance > FAR_CROWN) {
            pool.distant.setMatrixAt(pool.far, _m4);
            pool.distant.geometry.attributes.base.setXYZ(pool.far, px, h, pz);
            pool.distant.setColorAt(pool.far++, _col);
          }
        }
        treeRecords.push({
          x: px,
          z: pz,
          ground: h,
          top: h + pool.top * tall,
          radius: sc * pool.radius,
          trunk: sc * spec.trunk.radius + 0.3,
          species: pool.id,
        });
        n++;
      }
    }
  for (const pool of Object.values(speciesPools)) {
    pool.wood.count = pool.count;
    if (pool.crown) {
      pool.crown.count = pool.near;
      pool.distant.count = pool.far;
    }
    for (const mesh of pool.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.attributes.base.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  for (const pool of propPools) {
    pool.mesh.count = pool.count;
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.mesh.geometry.attributes.base.needsUpdate = true;
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
  }
  updateGroundAO(cx * TREE_CELL, cz * TREE_CELL);
  placeSites(bx, bz);
}

// ---------------------------------------------------------------------------
// Local grass uses the same quiet texture contrast and upward lighting as
// the approved close study. Placement does not depend on blade detail. Each
// biome tints the blades and says how thick they grow.
const grassCanvas = document.createElement('canvas');
grassCanvas.width = 256;
grassCanvas.height = 256;
const gc = grassCanvas.getContext('2d'),
  gr = mulberry32(614);
for (let i = 0; i < 96; i++) {
  const x = 6 + gr() * 244,
    h = 55 + gr() * 180,
    bend = (gr() - 0.5) * 60,
    width = 1.5 + gr() * 3;
  gc.fillStyle = ['#638c37', '#7ca448', '#8cae50', '#a2bb61'][i % 4];
  gc.beginPath();
  gc.moveTo(x - width, 256);
  gc.quadraticCurveTo(x - width * 0.5, 256 - h * 0.65, x + bend, 256 - h);
  gc.quadraticCurveTo(x + width * 0.6, 256 - h * 0.4, x + width, 256);
  gc.fill();
}
const grassMap = new THREE.CanvasTexture(grassCanvas);
grassMap.colorSpace = THREE.SRGBColorSpace;
grassMap.anisotropy = 4;
const grassMat = litMaterial(paintedSample(grassMap), {
  basic: { side: THREE.DoubleSide, alphaTest: 0.08, alphaToCoverage: true },
});
grassMat.normalNode = transformNormalToView(vec3(0, 1, 0));
grassMat.aoNode = mix(terrainMat.aoNode, 1, attribute('uv', 'vec2').y);
grassMat.opacityNode = float(1).sub(smoothstep(120, 190, length(positionWorld.sub(cameraPosition))));
grassMat.positionNode = positionLocal.add(
  vec3(
    sin(time.mul(1.4).add(positionWorld.x.mul(0.08)))
      .mul(attribute('position', 'vec3').y.pow(2))
      .mul(0.16),
    0,
    0,
  ),
);
const grassGeo = new THREE.PlaneGeometry(2.6, 1);
grassGeo.translate(0, 0.5, 0);
const grass = new THREE.InstancedMesh(grassGeo, grassMat, LITE ? 8000 : 20000);
grass.count = 0;
grass.frustumCulled = false;
grass.receiveShadow = true;
grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(grass);
const grassTints = BIOMES.map((biome) => libraryColor(`biome ${biome.id}.grass.tint`, biome.grass.tint));
let grassX = NaN,
  grassZ = NaN;
function placeGrass(x, z) {
  grass.visible = camera.position.y - heightAt(x, z) < 250;
  if (!grass.visible) return;
  const ix = Math.floor(x / CELL),
    iz = Math.floor(z / CELL);
  if (ix === grassX && iz === grassZ) return;
  grassX = ix;
  grassZ = iz;
  const cx = Math.floor(x / 64),
    cz = Math.floor(z / 64);
  let count = 0;
  for (let tz = cz - 5; tz <= cz + 5; tz++)
    for (let tx = cx - 5; tx <= cx + 5; tx++) {
      if (Math.hypot((tx + 0.5) * 64 - x, (tz + 0.5) * 64 - z) > 260) continue;
      biomeAt((tx + 0.5) * 64, (tz + 0.5) * 64, _weights);
      let thickness = 0;
      _col.setRGB(0, 0, 0);
      for (let i = 0; i < BIOMES.length; i++) {
        thickness += _weights[i] * BIOMES[i].grass.density;
        _col.r += _weights[i] * grassTints[i].r;
        _col.g += _weights[i] * grassTints[i].g;
        _col.b += _weights[i] * grassTints[i].b;
      }
      const r = mulberry32(hash2(tx, tz, seed ^ 0x6a455));
      for (let i = 0; i < 256 && count < grass.instanceMatrix.count; i++) {
        const px = (tx + r()) * 64,
          pz = (tz + r()) * 64,
          scale = 0.55 + r() * 0.8,
          angle = r() * Math.PI,
          keep = r() < thickness;
        const h = heightAt(px, pz);
        if (!keep || h < 2 || slopeAt(px, pz) > 0.65 || Math.abs(roadSide(px, pz)) < ROAD.shoulder + 0.6) continue;
        _q.setFromAxisAngle(_v3.set(0, 1, 0), angle);
        _m4.compose(_v3.set(px, h, pz), _q, _s3.setScalar(scale));
        grass.setMatrixAt(count, _m4);
        grass.setColorAt(count++, _col);
      }
    }
  grass.count = count;
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Old stone: watchtowers and churches of coral stone, rare sites of the same
// weathered masonry, found on a sparse grid near the road, sunk and tilted by
// their age, mossy at the foot. Watchtowers face the sunrise, toward the sea.
// Nothing announces them.
// ---------------------------------------------------------------------------
const STONE = {
  warm: C(SWATCH.stoneWarm),
  cool: C(SWATCH.stoneCool),
  dark: C(SWATCH.stoneDark),
  moss: C(SWATCH.moss),
};
// The masonry kit every site type is built from: tapered pillars, blocks
// and slabs, each a little worn, sunk and leaning. Builders only compose it.
function masonryKit(parts, r) {
  const tone = () => C(0).copy(STONE.warm).lerp(STONE.cool, r()).lerp(STONE.dark, r() * 0.35);
  const taper = (g, amount) => {
    const p = g.attributes.position;
    g.computeBoundingBox();
    const { min, max } = g.boundingBox;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) - min.y) / Math.max(0.001, max.y - min.y);
      p.setX(i, p.getX(i) * (1 - amount * t));
      p.setZ(i, p.getZ(i) * (1 - amount * t));
    }
    g.computeVertexNormals();
    return g;
  };
  const place = (g, x, y, z, yaw = 0, tilt = 0, roll = 0) =>
    parts.push({ geometry: g, matrix: M(x, y, z, 1, 1, 1, tilt, yaw, roll), color: tone() });
  return {
    THREE,
    random: r,
    color: (value) => libraryColor('site color', value),
    raw(g, x, y, z, yaw = 0, tilt = 0, roll = 0) {
      place(g, x, y, z, yaw, tilt, roll);
    },
    block(x, y, z, w, h, d, yaw = 0, wear = 0.05) {
      place(taper(new THREE.BoxGeometry(w, h, d), wear), x, y, z, yaw, (r() - 0.5) * wear, (r() - 0.5) * wear);
    },
    pillar(x, z, height, radius, lean = 0.03, broken = false) {
      const h = broken ? height * (0.25 + r() * 0.35) : height;
      const g = new THREE.CylinderGeometry(radius * 0.72, radius, h, 7, 1);
      g.translate(0, h / 2 - 0.4, 0);
      place(g, x, 0, z, r() * 6.283, (r() - 0.5) * lean, (r() - 0.5) * lean);
      if (!broken) {
        const cap = new THREE.BoxGeometry(radius * 2.2, radius * 0.55, radius * 2.2);
        cap.translate(0, h - 0.4 + radius * 0.27, 0);
        place(cap, x, 0, z, 0, 0, 0);
      }
    },
    fallen(x, z, length, radius) {
      const g = new THREE.CylinderGeometry(radius * 0.72, radius, length, 7, 1);
      g.translate(0, length / 2, 0);
      place(g, x, radius * 0.6, z, r() * 6.283, Math.PI / 2 - 0.05 + r() * 0.1, 0);
    },
    standing(x, z, height, width, depth, yaw) {
      const g = taper(new THREE.BoxGeometry(width, height, depth), 0.25);
      g.translate(0, height / 2 - 0.5, 0);
      place(g, x, 0, z, yaw, (r() - 0.5) * 0.12, (r() - 0.5) * 0.12);
    },
  };
}
function bakeSite(type) {
  const parts = [],
    r = mulberry32(0x5e77 + type.id.length * 977 + type.id.charCodeAt(0));
  const kit = masonryKit(parts, r);
  type.build(kit);
  const geometry = mergeParts(parts);
  for (const part of parts) part.geometry.dispose();
  const errors = validateBaked(type, geometry);
  if (errors.length) throw new Error('scenery library: ' + errors.join('; '));
  // moss climbs the lowest stones
  const positions = geometry.attributes.position,
    colors = geometry.attributes.color;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    _col.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i));
    _col.lerp(STONE.moss, sstep(1.6, -0.3, y) * 0.55);
    colors.setXYZ(i, _col.r, _col.g, _col.b);
  }
  geometry.computeBoundingBox();
  return geometry;
}
const SITES_PER_TYPE = BUDGET.siteInstances;
const siteMat = propMaterial();
siteMat.positionNode = grown(positionLocal);
const sitePools = SITES.map((type) => {
  const geometry = bakeSite(type);
  const mesh = new THREE.InstancedMesh(geometry, siteMat, SITES_PER_TYPE);
  const base = new THREE.InstancedBufferAttribute(new Float32Array(SITES_PER_TYPE * 3), 3);
  base.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('base', base);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.count = 0;
  scene.add(mesh);
  return { type, mesh, height: geometry.boundingBox.max.y, count: 0 };
});
const siteRecords = [];
// Sites are found, not scattered: a sparse grid of cells, each with a small
// chance of holding one, and the site must fit its ground. The same cell
// always holds the same site, so a place seen once is there when you return.
function placeSites(bx, bz) {
  siteRecords.length = 0;
  for (const pool of sitePools) pool.count = 0;
  const reach = TREE_RADIUS + SITE_CELL,
    oddsTotal = SITES.reduce((sum, type) => sum + type.odds, 0);
  const c0x = Math.floor((bx - reach) / SITE_CELL),
    c1x = Math.floor((bx + reach) / SITE_CELL),
    c0z = Math.floor((bz - reach) / SITE_CELL),
    c1z = Math.floor((bz + reach) / SITE_CELL);
  for (let gz = c0z; gz <= c1z; gz++)
    for (let gx = c0x; gx <= c1x; gx++) {
      const r = mulberry32(hash2(gx, gz, seed ^ 0x2a11));
      const ccx = (gx + 0.5) * SITE_CELL,
        ccz = (gz + 0.5) * SITE_CELL;
      if (Math.hypot(ccx - bx, ccz - bz) > TREE_RADIUS + SITE_CELL * 0.7) continue;
      // the biome's welcome, read at the cell center, scales the odds
      biomeAt(ccx, ccz, _weights);
      let welcome = 0;
      for (let i = 0; i < BIOMES.length; i++) welcome += _weights[i] * BIOMES[i].sites;
      if (r() > SITE_ODDS * welcome) continue;
      let pick = r() * oddsTotal,
        pool = sitePools[0];
      for (const candidate of sitePools) {
        pick -= candidate.type.odds;
        if (pick <= 0) {
          pool = candidate;
          break;
        }
      }
      if (pool.count >= SITES_PER_TYPE) continue;
      const type = pool.type;
      const scale = 0.85 + r() * 0.4,
        yaw = type.sunward ? SUNRISE_AZIMUTH + (r() - 0.5) * 0.2 : r() * 6.283,
        sink = 0.3 + r() * 0.9;
      for (let attempt = 0; attempt < 4; attempt++) {
        const px = (gx + 0.2 + r() * 0.6) * SITE_CELL,
          pz = (gz + 0.2 + r() * 0.6) * SITE_CELL;
        const h = heightAt(px, pz),
          side = Math.abs(roadSide(px, pz));
        // seen from the road, never on it
        if (h < 8 || slopeAt(px, pz) > type.slope || side < type.footprint * scale + ROAD.shoulder + VERGE || side > 520) continue;
        // a hill site stands on a local top; a flat site on ground that stays level
        let fits = true;
        for (let k = 0; k < 8 && fits; k++) {
          const a = (k / 8) * Math.PI * 2,
            around = heightAt(px + Math.cos(a) * 90, pz + Math.sin(a) * 90);
          fits = type.hill ? around <= h + 3 : Math.abs(around - h) < 12;
        }
        if (!fits) continue;
        _q.setFromAxisAngle(_v3.set(0, 1, 0), yaw);
        _m4.compose(_v3.set(px, h - sink, pz), _q, _s3.setScalar(scale));
        pool.mesh.setMatrixAt(pool.count, _m4);
        pool.mesh.geometry.attributes.base.setXYZ(pool.count++, px, h, pz);
        siteRecords.push({
          x: px,
          z: pz,
          ground: h,
          top: h - sink + pool.height * scale,
          radius: type.footprint * scale,
          type: type.id,
        });
        break;
      }
    }
  for (const pool of sitePools) {
    pool.mesh.count = pool.count;
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.mesh.geometry.attributes.base.needsUpdate = true;
  }
}

// Clouds: painted sky below; soft volumes when the camera nears the deck.
// ---------------------------------------------------------------------------
const puffParts = [];
{
  const r = mulberry32(seed ^ 0x51ed);
  for (let i = 0; i < 7; i++) {
    const s = 0.55 + r() * 0.75;
    puffParts.push({
      geometry: new THREE.SphereGeometry(1, 20, 12),
      matrix: M((r() - 0.5) * 2.6, (r() - 0.5) * 0.7, (r() - 0.5) * 1.6, s * 1.25, s * 0.7, s),
      color: 0xffffff,
    });
  }
}
const puffGeo = mergeParts(puffParts);
const cloudMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
cloudMat.colorNode = mix(
  uHorizon,
  uCloudWhite,
  smoothstep(-0.7, 0.8, normalLocal.y).mul(0.7).add(0.15),
);
cloudMat.opacityNode = pow(abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld)))), 0.7)
  .mul(0.8)
  .mul(uCloudBodies)
  .mul(float(1).sub(smoothstep(2300, 2900, length(positionWorld.sub(cameraPosition)))));
const CLOUDS = 40,
  CLOUD_FIELD = 6400;
const clouds = new THREE.InstancedMesh(puffGeo, cloudMat, CLOUDS);
clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
clouds.frustumCulled = false;
scene.add(clouds);
const cloudBase = [];
{
  const r = mulberry32(seed ^ 0xc10d);
  for (let i = 0; i < CLOUDS; i++)
    cloudBase.push({
      x: r() * CLOUD_FIELD,
      z: r() * CLOUD_FIELD,
      y: DECK_Y + (r() - 0.5) * 90,
      s: 55 + r() * 95,
      rot: r() * 6.283,
      drift: 0.6 + r() * 0.8,
    });
}
function updateClouds(bx, bz, t) {
  const cx = camera.position.x,
    cy = camera.position.y,
    cz = camera.position.z;
  for (let i = 0; i < CLOUDS; i++) {
    const c = cloudBase[i];
    let x = c.x + t * 4.0 * c.drift - bx,
      z = c.z - bz;
    x = (((x % CLOUD_FIELD) + CLOUD_FIELD * 1.5) % CLOUD_FIELD) - CLOUD_FIELD / 2;
    z = (((z % CLOUD_FIELD) + CLOUD_FIELD * 1.5) % CLOUD_FIELD) - CLOUD_FIELD / 2;
    const px = bx + x,
      pz = bz + z;
    const d = Math.hypot(px - cx, c.y - cy, pz - cz);
    const shrink = sstep(c.s * 1.6, c.s * 3.6, d);
    _q.setFromAxisAngle(_v3.set(0, 1, 0), c.rot);
    _m4.compose(_v3.set(px, c.y, pz), _q, _s3.set(c.s * shrink, c.s * 0.6 * shrink, c.s * shrink));
    clouds.setMatrixAt(i, _m4);
  }
  clouds.instanceMatrix.needsUpdate = true;
}
// cloud sea: a heaped plane just under the deck, holes from noise, seen only from above
let seaMat;
{
  // The cloud surface is atmosphere, not land inside its own height fog.
  // Paint its folds directly so the view above does not become a blank sheet.
  seaMat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  seaMat.opacityNode = uAbove.mul(0.94);
  const heapAt = (p) =>
    mx_noise_float(p.mul(0.0016).add(time.mul(0.003)))
      .mul(38.0)
      .add(mx_noise_float(p.mul(0.006).sub(time.mul(0.004))).mul(14.0));
  const heap = heapAt(positionWorld.xz);
  // The tops are lit: a normal from the heap's slope turns the sunward flanks
  // to the sun, warm while it is low and warmer toward it, blushing opposite
  // it, and leaves the hollows to the sky's blue; the moon lights them at
  // night. The far sea fades into the same horizon the sky draws.
  const STEP = 10;
  const slopeX = heapAt(positionWorld.xz.add(vec2(STEP, 0))).sub(heap).div(STEP),
    slopeZ = heapAt(positionWorld.xz.add(vec2(0, STEP))).sub(heap).div(STEP);
  const n = normalize(vec3(slopeX.negate().mul(3.5), 1, slopeZ.negate().mul(3.5)));
  const view = normalize(positionWorld.sub(cameraPosition));
  const sunUp = smoothstep(-0.04, 0.06, uSunDir.y);
  const s = max(dot(view, uSunDir), 0.0).mul(sunUp);
  const align = azimuthAlign(view, uSunDir),
    anti = azimuthAlign(view, uSunDir.negate());
  const sunCol = mix(uSunColor, uGlow, uLowSun.mul(0.6));
  // the ramp follows the sun's height, so the tops stay sculpted at noon
  const lit = smoothstep(uSunDir.y.sub(0.6), uSunDir.y.add(0.3), dot(n, uSunDir)).mul(sunUp);
  const moonlit = smoothstep(uMoonDir.y.sub(0.6), uMoonDir.y.add(0.3), dot(n, uMoonDir)).mul(uMoonLight);
  const hollow = smoothstep(26, -32, heap);
  const shade = mix(uUpper.mul(0.6), uCloudWhite, 0.2).mul(float(1).sub(hollow.mul(0.3)));
  const folds = Fn(() => {
    const light = mix(uCloudWhite, sunCol, uLowSun.mul(0.7).add(pow(s, 4).mul(0.3))).toVar();
    light.assign(mix(light, uGlow, uLowSun.mul(pow(align, 1.5)).mul(0.65)));
    light.assign(mix(light, mix(light, VENUS, 0.5), uVenusI.mul(pow(anti, 1.5)).mul(0.45)));
    const tops = mix(shade, light, lit.mul(float(1).sub(hollow.mul(0.55))));
    return tops.add(vec3(0.42, 0.5, 0.72).mul(moonlit).mul(0.1));
  })();
  const cover = max(uWhiteout, smoothstep(2000, 4300, length(positionWorld.sub(cameraPosition))));
  seaMat.colorNode = mix(folds, horizonTint(view), cover);
  seaMat.positionNode = vec3(
    positionLocal.x,
    heap.add(sin(positionWorld.x.mul(0.006).add(time.mul(0.2))).mul(4.0)),
    positionLocal.z,
  );
}
const cloudSeaGeo = new THREE.PlaneGeometry(9000, 9000, 96, 96);
cloudSeaGeo.rotateX(-Math.PI / 2);
const cloudSea = new THREE.Mesh(cloudSeaGeo, seaMat);
cloudSea.position.y = DECK_Y - 55;
cloudSea.frustumCulled = false;
cloudSea.renderOrder = 2;
scene.add(cloudSea);

// ---------------------------------------------------------------------------
// The bike. src/bike.js lays out the GNEGR motorcycle and its rider in the
// colors of a paint from library/paints/; the engine makes the meshes, lights
// them with its own soft material, measures the bike against its budget, and
// spins the wheels. The viewer picks a paint in the corner, never before
// Begin, and the page remembers it; the registry's first is the default.
// ---------------------------------------------------------------------------
const bikeMaterial = propMaterial();
const bikeKit = { THREE, merge: mergeParts, M };
let paintId = PAINT[storedSettings.paint] ? storedSettings.paint : PAINTS[0].id;
const paintsMeasured = new Set();
const bike = new THREE.Group();
bike.rotation.order = 'YXZ'; // heading, then pitch, then lean
function dressBike(id) {
  for (const child of [...bike.children]) {
    bike.remove(child);
    child.traverse((o) => o.isMesh && o.geometry.dispose());
  }
  const paint = PAINT[id],
    built = buildBike(paint, bikeKit);
  if (!paintsMeasured.has(id)) {
    const whole = mergeParts([{ geometry: built.body }, ...built.wheels.map((w) => ({ geometry: w.geometry }))]);
    const errors = validateBaked({ ...paint, budget: { triangles: BIKE.triangles } }, whole);
    whole.dispose();
    if (errors.length) throw new Error('scenery library: ' + errors.join('; '));
    paintsMeasured.add(id);
  }
  bike.add(new THREE.Mesh(built.body, bikeMaterial));
  bike.userData.wheels = built.wheels.map((w) => {
    const pivot = new THREE.Group();
    pivot.position.set(...w.at);
    pivot.add(new THREE.Mesh(w.geometry, bikeMaterial));
    bike.add(pivot);
    return pivot;
  });
  bike.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  bike.userData.paint = id;
}
dressBike(paintId);
scene.add(bike);
function setPaint(id) {
  if (!PAINT[id]) throw new Error('unknown paint: ' + id);
  paintId = id;
  dressBike(id);
  showPaint();
  saveSettings();
  if (!running || paused) {
    last = performance.now();
    renderer.setAnimationLoop(frame);
  }
}

// The flock: now and then a loose line of egrets keeps the bike company for
// a while, over the fields beside the road, then peels away.
const birdMaterial = propMaterial({ basic: { side: THREE.DoubleSide } });
const birdKit = { THREE, merge: mergeParts, M };
function makeBird(kind) {
  const g = new THREE.Group();
  const built = buildBird(kind, birdKit);
  g.add(new THREE.Mesh(built.body, birdMaterial));
  const wings = [];
  for (const wing of built.wings) {
    let parent = g;
    const pivots = [];
    for (const seg of wing.segments) {
      const pivot = new THREE.Group();
      pivot.position.set(...seg.at);
      pivot.add(new THREE.Mesh(seg.geometry, birdMaterial));
      parent.add(pivot);
      pivots.push(pivot);
      parent = pivot;
    }
    wings.push({ s: wing.s, pivots });
  }
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  g.scale.setScalar((kind.scale ?? 1) * kind.flock.scale);
  Object.assign(g.userData, { kind, wings, phase: Math.random() * 6.28, flapAmp: 0.1 });
  g.rotation.order = 'YXZ';
  g.visible = false;
  return g;
}
const flockKind = BIRDS[0];
{
  const whole = buildBird(flockKind, birdKit);
  const merged = mergeParts([{ geometry: whole.body }, ...whole.wings.flatMap((w) => w.segments.map((seg) => ({ geometry: seg.geometry })))]);
  const errors = validateBaked(flockKind, merged);
  merged.dispose();
  whole.body.dispose();
  for (const w of whole.wings) for (const seg of w.segments) seg.geometry.dispose();
  if (errors.length) throw new Error('scenery library: ' + errors.join('; '));
}
const companions = [];
if (flockKind)
  for (let i = 0; i < 6; i++) {
    const b = makeBird(flockKind);
    scene.add(b);
    companions.push(b);
  }
const formation = [
  [0, 0, 0],
  [-4, 1, -6],
  [5, -0.5, -9],
  [-9, 2, -14],
  [10, 1, -17],
  [-2, 3, -23],
];

// ---------------------------------------------------------------------------
// Sky events: the sun's and the moon's horizon crossings, found on the same
// arcs the sky draws. The watchtowers face the sunrise; night is the span
// from sunset to sunrise.
// ---------------------------------------------------------------------------
const SKY_EVENTS = (() => {
  const sun = new THREE.Vector3(),
    moon = new THREE.Vector3();
  const height = (body, phase) => {
    skyBodies(phase, sun, moon);
    return (body === 'sun' ? sun : moon).y;
  };
  const events = [];
  const steps = 720;
  for (const body of ['sun', 'moon']) {
    let previous = height(body, 0);
    for (let i = 1; i <= steps; i++) {
      const next = height(body, i / steps);
      if (previous < 0 !== next < 0) {
        let lo = (i - 1) / steps,
          hi = i / steps;
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          if (height(body, mid) < 0 === previous < 0) lo = mid;
          else hi = mid;
        }
        const phase = (lo + hi) / 2;
        events.push({ body, rising: next > previous, phase, solar: solar(phase) });
      }
      previous = next;
    }
  }
  return events.sort((a, b) => a.phase - b.phase);
})();
const SUNRISE = SKY_EVENTS.find((event) => event.body === 'sun' && event.rising);
const SUNSET = SKY_EVENTS.find((event) => event.body === 'sun' && !event.rising);
const NIGHT_SPAN = (((SUNRISE.phase - SUNSET.phase) % 1) + 1) % 1;
const isNight = (phase) => ((((phase - SUNSET.phase) % 1) + 1) % 1) < NIGHT_SPAN;
const SUNRISE_AZIMUTH = (() => {
  skyBodies(SUNRISE.phase, _v3, _s3);
  return Math.atan2(_v3.x, _v3.z);
})();

// ---------------------------------------------------------------------------
// The ride: the bike rides itself, on the right-hand lane of the road, slower
// into the bends and up the grades. A steer takes it wherever the viewer
// points it, off the road and over the land too; let go, and after a moment
// it turns back and rejoins the road, riding on the way it was facing.
// ---------------------------------------------------------------------------
const state = {
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  speed: RIDE.cruise,
  yawRate: 0,
  lean: 0,
  pitch: 0,
  dir: 1, // which way along the road: +1 toward +z, -1 back
  free: 0, // seconds the viewer's steer still holds the bike off its plan
  steer: 0, // heading change from steering, applied whole on the next frame
  nudgeYaw: 0,
  odometer: 0,
  onRoad: 1,
  t: 0,
  dragging: false,
  dragButton: -1, // 0 orbits the camera, 2 steers the bike
  lastPX: 0,
  lastPY: 0,
};
// The viewer has the bars while the steering button, or a touch, is held.
const steering = () => state.dragButton === 2;
// Where along the road a fresh world starts: on land, not on a causeway, on
// gentle grades, in the coast or the paddies when either is in reach, so the
// first sunrise lands over farmland or the sea.
const START = (() => {
  const probe = [0, 0, 0, 0],
    weights = new Float32Array(BIOMES.length),
    liked = ['coast', 'paddies'].map((id) => BIOMES.findIndex((biome) => biome.id === id)).filter((i) => i >= 0);
  const r = mulberry32(seed ^ 0xbead);
  let best = null;
  for (let i = 0; i < 120; i++) {
    const z0 = Math.round((r() - 0.5) * 40000);
    let score = 0;
    for (let k = 0; k < 10; k++) {
      const z = z0 + k * 70,
        y = road.y(z),
        grade = Math.abs(road.y(z + 16) - y) / 16;
      world.sample(road.x(z) + 40, z, probe);
      biomeWeights(probe[1], probe[2], probe[3], weights);
      score += (y > ROAD.floor + 2 ? 1 : -6) - 20 * Math.max(0, grade - 0.06);
      for (const j of liked) score += 2 * weights[j];
    }
    if (best === null || score > best.score) best = { z: z0, score };
  }
  return best.z;
})();
state.z = START;
state.x = road.x(START) - Math.cos(road.heading(START)) * ROAD.lane;
state.heading = road.heading(START);
function n1(t, s) {
  return perlin2(t, 0.37, s);
}
// What the bike must keep clear of: trunks, the huts, the old stone.
function pushClear() {
  for (const records of [treeRecords, siteRecords, propRecords])
    for (const o of records) {
      const r = (o.trunk ?? o.radius) + 0.5,
        dx = state.x - o.x,
        dz = state.z - o.z,
        d2 = dx * dx + dz * dz;
      if (d2 >= r * r || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      state.x = o.x + (dx / d) * r;
      state.z = o.z + (dz / d) * r;
    }
}

// ---------------------------------------------------------------------------
// The opening. A world's first ride starts on the road a few seconds before
// sunrise, with the day stretched so the dawn lasts while the title comes up
// and goes; then the day keeps its own pace. A steer ends the stretch. A
// resumed ride never plays it.
// ---------------------------------------------------------------------------
const INTRO = {
  beforeSunrise: 14, // seconds of dawn before the sun crosses
  hold: 45, // seconds the day is stretched
  stretch: 0.5, // day clock speed while it is
};
const intro = { beat: null, at: 0, ended: null };
let dayRate = 1,
  dayRateTarget = 1;
function updateIntro() {
  if (!intro.beat) return;
  if (state.t >= INTRO.hold) endIntro('ridden');
  dayRateTarget = intro.beat ? INTRO.stretch : 1;
}
function endIntro(how) {
  if (!intro.beat) return;
  intro.beat = null;
  intro.ended = how;
  dayRateTarget = 1;
}
// The title card. A few seconds into the ride, "Niño Redoble presents" and
// then "The Long Ride" come up out of a soft blur, hold while the sun comes
// up, and go. It belongs to the opening: it starts on its beat only while the
// opening is still playing, and once started it finishes even if the viewer
// steers, since a card cut off halfway reads as a fault. It runs on the
// simulation clock, so a pause holds it and the checks can step through it.
const TITLE = {
  at: 4, // seconds after Begin
  presents: [0, 2.6], // seconds after `at` over which the small line comes up
  name: [1.6, 5.6], // the title, fully up a few seconds later
  out: [11.5, 15], // both fade away
};
const title = { started: false, done: false, presents: 0, name: 0 };
const titleCard = {
  presents: document.getElementById('titlePresents'),
  name: document.getElementById('titleName'),
};
function updateTitle() {
  if (title.done) return;
  const t = state.t - TITLE.at;
  if (!title.started) {
    if (!intro.beat || t < 0) return;
    title.started = true;
  }
  const fall = 1 - sstep(TITLE.out[0], TITLE.out[1], t);
  const up = sstep(TITLE.name[0], TITLE.name[1], t);
  title.presents = sstep(TITLE.presents[0], TITLE.presents[1], t) * fall;
  title.name = up * fall;
  titleCard.presents.style.opacity = title.presents.toFixed(3);
  titleCard.name.style.opacity = title.name.toFixed(3);
  // the title sharpens as it comes up and drifts a little larger the whole
  // time it is on screen; a viewer who asked for less motion gets the fade alone
  if (!reducedMotion) {
    const drift = sstep(TITLE.name[0], TITLE.out[1], t);
    titleCard.name.style.filter = `blur(${((1 - up) * 12).toFixed(2)}px)`;
    titleCard.name.style.transform = `scale(${(0.955 + 0.06 * drift).toFixed(4)})`;
  }
  if (t >= TITLE.out[1]) title.done = true;
}
// The viewer took the bars: the plan lets go for a while, and so does the opening.
function takeBars() {
  state.free = RIDE.hold;
  endIntro('steered');
}
const _front = new THREE.Vector3();
function updateRide(dt) {
  state.t += dt;
  updateIntro();
  const side = road.distance(state.x, state.z);
  state.onRoad = 1 - sstep(ROAD.shoulder, ROAD.shoulder + 6, Math.abs(side));
  // Steering turns the bike one to one with the mouse, and the camera with
  // it: the bike turns to face the way the camera looks, while the camera
  // itself holds still in the world.
  let turn = state.steer;
  state.steer = 0;
  if (steering()) {
    const give = cam.yaw * Math.min(1, dt * 4);
    cam.yaw -= give;
    turn += give;
    state.free = RIDE.hold;
  } else if (state.free > 0 && !state.dragging) state.free = Math.max(0, state.free - dt);
  if (Math.abs(state.nudgeYaw) > 0.02) state.free = Math.max(state.free, 0.5);
  // The plan: pure pursuit of a point on the right-hand lane a second or so
  // ahead, along the road the way the bike faces. It steers the bike back to
  // the road from wherever the viewer left it.
  const s = road.slope(state.z);
  if (state.free > 0) state.dir = Math.cos(wrapAngle(state.heading - Math.atan2(s, 1))) >= 0 ? 1 : -1;
  const foot = state.z - ((state.x - road.x(state.z)) * s) / (1 + s * s);
  const look = Math.max(12, state.speed * RIDE.look) + Math.min(60, Math.abs(side) * 0.5);
  const zt = foot + (state.dir * look) / Math.sqrt(1 + s * s);
  const ht = road.heading(zt) + (state.dir < 0 ? Math.PI : 0);
  const tx = road.x(zt) - Math.cos(ht) * ROAD.lane,
    tz = zt + Math.sin(ht) * ROAD.lane;
  const want = wrapAngle(Math.atan2(tx - state.x, tz - state.z) - state.heading);
  const planned = Math.max(-RIDE.turn, Math.min(RIDE.turn, want * (2.4 * state.speed) / look));
  const plan = state.free > 0 ? 0 : 1;
  const yawRateTarget = planned * plan + state.nudgeYaw;
  state.yawRate += (yawRateTarget - state.yawRate) * Math.min(1, dt * 4);
  state.heading = wrapAngle(state.heading + state.yawRate * dt + turn);
  // Speed: the cruise on the road, slower into a bend by the grip it can
  // take, a little slower up a grade, and slow over open ground.
  const bend = Math.abs(wrapAngle(road.heading(foot + state.dir * 60) - road.heading(foot))) / 60 + 1e-4;
  const grade = (road.y(foot + state.dir * 20) - road.y(foot)) / 20;
  let vTarget = Math.min(RIDE.cruise, Math.sqrt(RIDE.grip / bend)) * (1 - Math.min(0.3, Math.max(0, grade) * 2));
  vTarget = vTarget * state.onRoad + RIDE.rough * (1 - state.onRoad);
  if (Math.abs(turn) / dt > 1.5) vTarget = Math.min(vTarget, RIDE.rough);
  state.speed += Math.max(-4 * dt, Math.min(2 * dt, vTarget - state.speed));
  // Move, never into the sea: a shore turns the bike along it.
  let fx = Math.sin(state.heading),
    fz = Math.cos(state.heading);
  const step = state.speed * dt;
  if (heightAt(state.x + fx * (step + 2), state.z + fz * (step + 2)) < RIDE.wade) {
    let found = 0;
    for (const a of [0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, 2.4, -2.4]) {
      const h = state.heading + a;
      if (heightAt(state.x + Math.sin(h) * (step + 2), state.z + Math.cos(h) * (step + 2)) >= RIDE.wade) {
        found = a;
        break;
      }
    }
    state.heading = wrapAngle(state.heading + found * Math.min(1, dt * 3));
    fx = Math.sin(state.heading);
    fz = Math.cos(state.heading);
    if (!found || heightAt(state.x + fx * (step + 2), state.z + fz * (step + 2)) < RIDE.wade) state.speed *= Math.exp(-dt * 3);
  }
  if (heightAt(state.x + fx * step, state.z + fz * step) >= RIDE.wade || heightAt(state.x, state.z) < RIDE.wade) {
    state.x += fx * state.speed * dt;
    state.z += fz * state.speed * dt;
  }
  pushClear();
  state.odometer += state.speed * dt;
  // pose: the tyres stand on the drawn ground, the bike leans into its turn
  const yf = heightAt(state.x + fx * BIKE.front, state.z + fz * BIKE.front),
    yr = heightAt(state.x + fx * BIKE.rear, state.z + fz * BIKE.rear);
  state.y = (yf + yr) / 2;
  const rough = (1 - state.onRoad) * 0.025 * Math.sin(state.t * 13.1) * Math.sin(state.t * 5.3 + 1);
  state.pitch = Math.atan2(yf - yr, BIKE.base) + rough;
  const leanTarget = Math.max(-0.6, Math.min(0.6, Math.atan((state.speed * (state.yawRate + turn / dt)) / 9.81)));
  state.lean += (leanTarget - state.lean) * Math.min(1, dt * 3);
  if (!state.dragging) state.nudgeYaw *= Math.exp(-dt / 1.6);
  bike.position.set(state.x, state.y, state.z);
  bike.rotation.set(-state.pitch, state.heading, -state.lean);
  animateBike(bike, state.odometer);
  _front.set(fx, 0, fz);
}

// Pointer input follows the conventions of World of Warcraft's camera: the left
// button orbits the camera and leaves it where you put it, the right button
// steers, and the wheel zooms. Touch steers, since it has only one button.
// Heading grows counter-clockwise seen from above, which is a left turn, so
// rightward input subtracts: the view and the bike turn right, as in WoW.
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (!running || disposed) return;
  if (e.button !== 0 && e.button !== 2 && e.pointerType !== 'touch') return;
  state.dragging = true;
  state.dragButton = e.pointerType === 'touch' || e.button === 2 ? 2 : 0;
  if (state.dragButton === 2) takeBars();
  state.lastPX = e.clientX;
  state.lastPY = e.clientY;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // synthetic pointers have nothing to capture
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!state.dragging) return;
  const dx = e.clientX - state.lastPX,
    dy = e.clientY - state.lastPY;
  state.lastPX = e.clientX;
  state.lastPY = e.clientY;
  // Either button raises and lowers the view; the left one orbits sideways
  // around the bike, the right one turns the bike.
  if (dy) cam.pitch = Math.max(CAMERA.minPitch, Math.min(CAMERA.maxPitch, cam.pitch + dy * CAMERA.turnPerPixel));
  if (state.dragButton === 0) cam.yaw = wrapAngle(cam.yaw - dx * CAMERA.turnPerPixel);
  else state.steer -= dx * CAMERA.turnPerPixel;
  if (dx || dy) showView(-1);
});
const endDrag = () => {
  // either button can have moved the framing, and framing is remembered
  if (state.dragButton >= 0) saveSettings();
  state.dragging = false;
  state.dragButton = -1;
};
canvas.addEventListener('lostpointercapture', endDrag);
window.addEventListener('blur', endDrag);
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener(
  'wheel',
  (e) => {
    if (!running) return;
    e.preventDefault();
    cam.dist = Math.max(CAMERA.minDist, Math.min(CAMERA.maxDist, cam.dist * Math.exp(e.deltaY * 0.0012)));
    showView(-1);
    saveSettings();
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  if (e.target.closest('button, a, input') || !running) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePause();
    return;
  }
  if (e.key.startsWith('Arrow')) e.preventDefault();
  if (paused) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') takeBars();
  if (e.key === 'ArrowLeft') state.nudgeYaw = 0.5;
  if (e.key === 'ArrowRight') state.nudgeYaw = -0.5;
  if (e.key === 'c' || e.key === 'C') nextView();
});

// ---------------------------------------------------------------------------
// Camera: World of Warcraft's third person. It hangs rigidly at a yaw, pitch
// and distance from the bike, so the bike is the pivot of every orbit and holds
// its place on screen. There is no director; only the viewer moves it, by a
// drag, the wheel, or the camera control's few framings, and it stays where
// it is put.
// ---------------------------------------------------------------------------
const CAMERA = {
  dist: 6.5,
  pitch: 0.2, // elevation above the bike, radians
  minDist: 3,
  maxDist: 70,
  minPitch: -0.12,
  maxPitch: 1.3,
  turnPerPixel: 0.004,
  lookRise: 1.0, // aim at the rider's shoulders, so the bike sits a little below center
  clearance: 0.8,
};
// The camera control's framings: behind, beside, ahead looking back, the
// drone overhead, and far off across the country.
const VIEWS = [
  { id: 'chase', yaw: 0, pitch: 0.2, dist: 6.5 },
  { id: 'side', yaw: 1.3, pitch: 0.1, dist: 6 },
  { id: 'ahead', yaw: 2.8, pitch: 0.12, dist: 8 },
  { id: 'drone', yaw: 0.3, pitch: 0.8, dist: 32 },
  { id: 'far', yaw: -1.0, pitch: 0.3, dist: 62 },
];
const cam = {
  yaw: 0, // orbit around the bike, relative to its heading; 0 is behind
  pitch: CAMERA.pitch,
  dist: CAMERA.dist,
  lift: 0, // extra height that keeps the camera out of the ground
  view: 0, // the framing last chosen, -1 once a drag has moved it
};
{
  // the viewer's framing is theirs across visits and worlds
  const orbit = storedSettings.camera ?? {};
  cam.yaw = finite(orbit.yaw, -Math.PI, Math.PI) ?? cam.yaw;
  cam.pitch = finite(orbit.pitch, CAMERA.minPitch, CAMERA.maxPitch) ?? cam.pitch;
  cam.dist = finite(orbit.dist, CAMERA.minDist, CAMERA.maxDist) ?? cam.dist;
  cam.view = finite(orbit.view, -1, VIEWS.length - 1) ?? 0;
}
function updateCamera(dt) {
  const yaw = state.heading + Math.PI + cam.yaw,
    cp = Math.cos(cam.pitch),
    pivotY = state.y + CAMERA.lookRise;
  const want = _v3.set(
    state.x + Math.sin(yaw) * cp * cam.dist,
    pivotY + Math.sin(cam.pitch) * cam.dist,
    state.z + Math.cos(yaw) * cp * cam.dist,
  );
  // The ground lifts the camera quickly and lets it settle back slowly.
  const floor = Math.max(SEA_LEVEL, heightAt(want.x, want.z));
  const lift = Math.max(0, floor + CAMERA.clearance - want.y);
  cam.lift += (lift - cam.lift) * Math.min(1, dt * (lift > cam.lift ? 12 : 1.5));
  want.y = Math.max(want.y + cam.lift, floor + 0.5);
  camera.position.copy(want);
  camera.lookAt(state.x, pivotY, state.z);
}

// ---------------------------------------------------------------------------
// Moments: rare, scheduled, with cooldowns. For now: the egrets.
// ---------------------------------------------------------------------------
const moments = { nextFlock: 90, flockStarted: 0, flockUntil: 0, flockOn: false, side: 1 };
function updateMoments(dt, sound = true) {
  if (!moments.flockOn && state.t > moments.nextFlock && !isNight(dayPhase)) {
    moments.flockOn = true;
    moments.flockStarted = state.t;
    moments.flockUntil = state.t + 35 + Math.random() * 20;
    moments.side = Math.random() < 0.5 ? -1 : 1;
    if (sound) audio.chime(2);
  }
  if (moments.flockOn && state.t > moments.flockUntil) {
    moments.flockOn = false;
    moments.nextFlock = state.t + 140 + Math.random() * 90;
  }
  const fx = Math.sin(state.heading),
    fz = Math.cos(state.heading),
    rx = -Math.cos(state.heading),
    rz = Math.sin(state.heading);
  companions.forEach((b, i) => {
    const f = formation[i];
    // they come in from ahead and to one side, keep pace a while, then rise away
    const tIn = Math.min(1, Math.max(0, (state.t - moments.flockStarted) / 10));
    const tOut = moments.flockOn ? 1 : Math.max(0, 1 - (state.t - moments.flockUntil) / 12);
    const a = moments.flockStarted > 0 ? Math.min(tIn, tOut) : 0;
    b.visible = a > 0.01;
    if (!b.visible) return;
    const ease = 1 - Math.pow(1 - a, 3);
    const spread = flockKind.flock.spread ?? 1;
    const off = moments.side * (22 + f[0] * spread) + (1 - ease) * moments.side * 60;
    const ahead = 14 + f[2] * spread + (1 - ease) * 90;
    const wob = n1(state.t * 0.3 + i * 7.7, S3 + i) * 1.5;
    const px = state.x + rx * off + fx * ahead,
      pz = state.z + rz * off + fz * ahead;
    b.position.set(px, Math.max(heightAt(px, pz), SEA_LEVEL) + 14 + f[1] + wob + (1 - ease) * 30, pz);
    b.rotation.set(0, state.heading, -state.lean * 0.4);
    animateBird(b, dt, i % 2 === 0 || Math.sin(state.t * 0.7 + i) > 0.2, 0.9 + i * 0.05);
  });
}

// ---------------------------------------------------------------------------
// Sound: everything synthesized. A twin's low engine note that follows the
// road speed through the gears and opens up on a climb, wind that rises with
// speed, the sea near the coast, and a pentatonic chime now and then.
// ---------------------------------------------------------------------------
const audio = (() => {
  let ctx = null,
    master = null,
    windFilter = null,
    windGain = null,
    waterGain = null,
    engine = null,
    noise = null,
    delay = null,
    muted = storedSettings.muted === true,
    volume = finite(storedSettings.volume, 0, 1) ?? 0.5,
    started = false;
  let chimeTimer = 30;
  const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99];
  // where each gear runs out, in m/s; the note climbs through each and drops at the shift
  const GEARS = [0, 5, 9.5, 14, 18.5, 26];
  function pinkBuffer(seconds) {
    const sr = ctx.sampleRate,
      n = Math.floor(sr * seconds),
      buf = ctx.createBuffer(1, n, sr),
      d = buf.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }
  function unavailable() {
    document.getElementById('muteBtn').textContent = 'sound unavailable';
    document.getElementById('muteBtn').disabled = true;
  }
  function start() {
    if (started) return;
    started = true;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return unavailable();
    try {
      ctx = new Audio();
    } catch {
      return unavailable();
    }
    ctx.resume().catch(() => {});
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    master.gain.linearRampToValueAtTime(muted ? 0 : volume, ctx.currentTime + 4);
    noise = pinkBuffer(4);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0.1;
    src.connect(windFilter).connect(windGain).connect(master);
    src.start();
    const src2 = ctx.createBufferSource();
    src2.buffer = noise;
    src2.loop = true;
    src2.playbackRate.value = 0.7;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 220;
    wf.Q.value = 0.9;
    waterGain = ctx.createGain();
    waterGain.gain.value = 0;
    src2.connect(wf).connect(waterGain).connect(master);
    src2.start();
    // The engine: a sawtooth at the firing rate over a square an octave down,
    // softly clipped, its loudness pulsing with the firing, through a low-pass
    // that opens with the throttle. Quiet: it sits under the wind.
    const fire = ctx.createOscillator(),
      low = ctx.createOscillator(),
      pulse = ctx.createOscillator();
    fire.type = 'sawtooth';
    low.type = 'square';
    pulse.type = 'sine';
    const lowGain = ctx.createGain();
    lowGain.gain.value = 0.45;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 1.8);
    shaper.curve = curve;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2.2;
    filter.frequency.value = 400;
    const amp = ctx.createGain();
    amp.gain.value = 0.7;
    const depth = ctx.createGain();
    depth.gain.value = 0.3;
    pulse.connect(depth).connect(amp.gain);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    fire.connect(shaper);
    low.connect(lowGain).connect(shaper);
    shaper.connect(filter).connect(amp).connect(gain).connect(master);
    for (const o of [fire, low, pulse]) o.start();
    engine = { fire, low, pulse, filter, gain };
    delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2400;
    delay.connect(dl).connect(fb).connect(delay);
    delay.connect(master);
  }
  function chime(count = 1) {
    if (!ctx) return;
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + i * (0.9 + Math.random() * 0.6);
      const f = PENTA[Math.floor(Math.random() * PENTA.length)] * (Math.random() < 0.3 ? 2 : 1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 2.01;
      const g2 = ctx.createGain();
      g2.gain.value = 0.18;
      o.connect(g);
      o2.connect(g2).connect(g);
      g.connect(master);
      g.connect(delay);
      o.start(t);
      o2.start(t);
      o.stop(t + 5);
      o2.stop(t + 5);
      o.onended = () => {
        o.disconnect();
        o2.disconnect();
        g2.disconnect();
        g.disconnect();
      };
    }
  }
  // the engine's revolutions per minute at a road speed, through the gears
  function rpm(v) {
    let g = 1;
    while (g < GEARS.length - 1 && v > GEARS[g]) g++;
    const lo = GEARS[g - 1],
      hi = GEARS[g];
    return 1900 + 3400 * Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  }
  function update(dt) {
    if (!ctx) return;
    const now = ctx.currentTime,
      v = state.speed;
    const gust = 0.5 + 0.5 * Math.sin(state.t * 0.43) * Math.sin(state.t * 0.071 + 1.3);
    windFilter.frequency.setTargetAtTime(300 + v * 32 + gust * 220, now, 0.4);
    windGain.gain.setTargetAtTime(0.04 + 0.13 * (v / RIDE.cruise) ** 2 + 0.05 * gust, now, 0.5);
    // the engine works harder up a grade and eases off down one
    const climb = Math.max(-0.5, Math.min(1, state.pitch * 8));
    const f = rpm(v) / 60;
    engine.fire.frequency.setTargetAtTime(f, now, 0.12);
    engine.low.frequency.setTargetAtTime(f / 2, now, 0.12);
    engine.pulse.frequency.setTargetAtTime(f / 2, now, 0.12);
    engine.filter.frequency.setTargetAtTime(260 + f * 4 + 380 * Math.max(0, climb), now, 0.2);
    engine.gain.gain.setTargetAtTime(0.05 + 0.025 * Math.max(0, climb) + 0.01 * Math.min(1, v / 5), now, 0.3);
    // sea-ness: how much of the ground around the bike is under water
    let under = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.283;
      if (heightAt(state.x + Math.cos(a) * 260, state.z + Math.sin(a) * 260) < 0) under++;
    }
    waterGain.gain.setTargetAtTime((under / 8) * 0.3, now, 1.2);
    chimeTimer -= dt;
    if (chimeTimer <= 0) {
      chime(1 + (Math.random() < 0.3 ? 1 : 0));
      chimeTimer = 40 + Math.random() * 50;
    }
  }
  function applyGain(seconds) {
    if (master && ctx.state !== 'closed') {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, seconds);
    }
  }
  function toggleMute() {
    muted = !muted;
    applyGain(0.3);
    saveSettings();
    return muted;
  }
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (muted) muted = false;
    applyGain(0.08);
    saveSettings();
    return muted;
  }
  function suspend(s) {
    if (!ctx || ctx.state === 'closed') return;
    ctx[s ? 'suspend' : 'resume']().catch(() => {});
  }
  function dispose() {
    return ctx && ctx.state !== 'closed' ? ctx.close().catch(() => {}) : Promise.resolve();
  }
  return {
    start,
    chime,
    update,
    toggleMute,
    setVolume,
    suspend,
    dispose,
    rpm,
    get state() {
      return ctx?.state ?? 'not-created';
    },
    get gain() {
      return master?.gain.value ?? 0;
    },
    get volume() {
      return volume;
    },
    get muted() {
      return muted;
    },
  };
})();
function saveSettings() {
  remember.write(SETTINGS_KEY, {
    volume: audio.volume,
    muted: audio.muted,
    camera: { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, view: cam.view },
    paint: paintId,
  });
}
// ---------------------------------------------------------------------------
// The corner: a paint control opens one strip of the bike in every paint, and
// a camera control steps through the framings. A pick repaints the bike at
// once and is remembered. An ordinary vertical wheel scrolls the strip
// sideways. The strip closes by itself, on Escape, or on a click anywhere
// else. Both are inert until Begin.
// ---------------------------------------------------------------------------
const paintButton = document.getElementById('paintBtn'),
  viewButton = document.getElementById('viewBtn'),
  perch = document.getElementById('perch'),
  paintStrip = document.getElementById('perchPaints'),
  hudLine = document.getElementById('hud');
const tiles = new Map();
// The strip is built the first time it opens: inline tiles are not worth
// paying for on a visit that never looks.
function buildPerch() {
  if (tiles.size) return;
  for (const paint of PAINTS) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.title = paint.name;
    tile.setAttribute('aria-label', `Ride in ${paint.name}`);
    tile.dataset.paint = paint.id;
    tile.innerHTML = bikeTile(paint) + `<span class="name">${paint.name}</span>`;
    tile.addEventListener('click', () => {
      setPaint(paint.id);
      armPerchIdle();
    });
    paintStrip.append(tile);
    tiles.set(paint.id, tile);
  }
  showPaint();
}
function showPaint() {
  paintButton.textContent = 'paint: ' + PAINT[paintId].name.toLowerCase();
  for (const [id, tile] of tiles) tile.setAttribute('aria-pressed', String(id === paintId));
  markOverflow();
}
showPaint();
function showView(index) {
  cam.view = index;
  viewButton.textContent = 'camera: ' + (index < 0 ? 'free' : VIEWS[index].id);
}
showView(cam.view);
function nextView() {
  const view = VIEWS[(cam.view + 1) % VIEWS.length];
  Object.assign(cam, { yaw: view.yaw, pitch: view.pitch, dist: view.dist });
  showView(VIEWS.indexOf(view));
  saveSettings();
  if (!running || paused) {
    last = performance.now();
    renderer.setAnimationLoop(frame);
  }
}
viewButton.addEventListener('click', nextView);
// What is out of sight on the strip is told twice: the edge it can still be
// scrolled toward fades, and its rail shows how much is in view and where.
function markOverflow() {
  const strip = paintStrip,
    max = strip.scrollWidth - strip.clientWidth,
    rail = strip.nextElementSibling;
  strip.dataset.overflow = max < 1 ? '' : [strip.scrollLeft > 1 ? 'start' : '', strip.scrollLeft < max - 1 ? 'end' : ''].filter(Boolean).join(' ');
  rail.classList.toggle('on', max >= 1);
  rail.firstElementChild.style.width = `${((100 * strip.clientWidth) / Math.max(1, strip.scrollWidth)).toFixed(2)}%`;
  rail.firstElementChild.style.marginLeft = `${((100 * strip.scrollLeft) / Math.max(1, strip.scrollWidth)).toFixed(2)}%`;
}
const WHEEL_LINE = 16;
function wheelStrip(e) {
  const strip = e.currentTarget,
    max = strip.scrollWidth - strip.clientWidth;
  if (max < 1 || !e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  const step = e.deltaMode === 1 ? e.deltaY * WHEEL_LINE : e.deltaMode === 2 ? e.deltaY * strip.clientWidth : e.deltaY;
  const before = strip.scrollLeft;
  strip.scrollLeft = Math.max(0, Math.min(max, before + step));
  if (strip.scrollLeft !== before) e.preventDefault();
}
paintStrip.addEventListener('wheel', wheelStrip, { passive: false });
paintStrip.addEventListener('scroll', markOverflow, { passive: true });
let perchIdle = 0;
const PERCH_IDLE_MS = 7000;
function armPerchIdle() {
  clearTimeout(perchIdle);
  perchIdle = setTimeout(closePerch, PERCH_IDLE_MS);
}
// The strip sits just above the controls line, however many lines that wraps to.
function placePerch() {
  perch.style.bottom = `${Math.round(window.innerHeight - hudLine.getBoundingClientRect().top + 8)}px`;
}
function openPerch() {
  if (perch.classList.contains('open')) return;
  buildPerch();
  placePerch();
  perch.inert = false;
  perch.classList.add('open');
  paintButton.setAttribute('aria-expanded', 'true');
  showPaint();
  tiles.get(paintId)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  markOverflow();
  armPerchIdle();
}
function closePerch() {
  clearTimeout(perchIdle);
  if (!perch.classList.contains('open')) return;
  perch.classList.remove('open');
  perch.inert = true;
  paintButton.setAttribute('aria-expanded', 'false');
}
paintButton.addEventListener('click', () => (perch.classList.contains('open') ? closePerch() : openPerch()));
for (const type of ['pointermove', 'pointerdown', 'focusin', 'wheel']) perch.addEventListener(type, armPerchIdle, { passive: true });
document.addEventListener('pointerdown', (e) => {
  if (!perch.contains(e.target) && !paintButton.contains(e.target)) closePerch();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePerch();
});
const muteButton = document.getElementById('muteBtn'),
  volumeSlider = document.getElementById('volume');
const showMuted = (muted) => {
  muteButton.textContent = muted ? 'sound off' : 'sound on';
  muteButton.setAttribute('aria-pressed', String(muted));
};
muteButton.addEventListener('click', () => showMuted(audio.toggleMute()));
volumeSlider.value = String(audio.volume);
showMuted(audio.muted);
volumeSlider.addEventListener('input', () => showMuted(audio.setVolume(volumeSlider.value)));

// ---------------------------------------------------------------------------
// Approved soft reconstruction in display space, followed by FXAA.
// ---------------------------------------------------------------------------
// Four samples here and nowhere else; see the renderer above.
const scenePass = pass(scene, camera, { samples: 4 });
const col = scenePass.getTextureNode();
// The phone budget skips the bloom and the soft reconstruction; FXAA stays.
const glow = LITE ? null : bloom(col, LOOK.bloom.strength, LOOK.bloom.radius, LOOK.bloom.threshold);
const post = new RenderPipeline(renderer);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LOOK.exposure;
post.outputColorTransform = false;
// Everything past tone mapping is display-referred, in the eight bits per
// channel a screen has, so the two intermediates the chain materialises hold
// exactly that. The soft pass reads its input nine times per pixel and FXAA
// reads its own more than that, and halving the width of every one of those
// reads is the cheapest bandwidth this page can give back. Neither needs a
// depth buffer either; each is one full-screen quad.
const LDR = { type: THREE.UnsignedByteType, depthBuffer: false };
const display = convertToTexture(renderOutput(vec4(glow ? col.rgb.add(glow.rgb) : col.rgb, 1)), null, null, LDR);
const softened = Fn(() => {
  const center = display.sample(screenUV),
    graded = (rgb) => {
      rgb = rgb.mul(LOOK.post.mul).add(vec3(LOOK.post.lift[0], LOOK.post.lift[1], LOOK.post.lift[2])).toVar();
      rgb.assign(saturation(rgb, float(LOOK.post.sat)));
      rgb.assign(mix(vec3(0.5), rgb, float(LOOK.post.contrast)));
      return rgb;
    };
  if (LITE) return vec4(graded(center.rgb), center.a);
  const sum = center.rgb.mul(4).toVar(),
    weights = float(4).toVar();
  for (const [x, y, spatial] of [
    [-1, 0, 2],
    [1, 0, 2],
    [0, -1, 2],
    [0, 1, 2],
    [-1, -1, 1],
    [1, -1, 1],
    [-1, 1, 1],
    [1, 1, 1],
  ]) {
    const neighbor = display.sample(screenUV.add(vec2(x, y).div(viewportSize))).rgb;
    const delta = neighbor.sub(center.rgb),
      weight = exp(dot(delta, delta).mul(-40)).mul(spatial);
    sum.addAssign(neighbor.mul(weight));
    weights.addAssign(weight);
  }
  return vec4(graded(mix(center.rgb, sum.div(weights), 0.65)), center.a);
})();
const softDisplay = convertToTexture(softened, null, null, LDR);
post.outputNode = fxaa(softDisplay);

// ---------------------------------------------------------------------------
// Day cycle and atmosphere per frame
// ---------------------------------------------------------------------------
// A fresh world opens ten seconds before the sunrise the opening flies into.
let dayPhase = SUNRISE.phase - INTRO.beforeSunrise / DAY_SECONDS;
const _sunDir = new THREE.Vector3(),
  _moonDir = new THREE.Vector3();
const BASE_EXPOSURE = LOOK.exposure;
// Where the sun and the moon stand at a moment of the day clock. The moon
// rides its own arc, up before dusk and gone before dawn. The ride reads
// these too.
function skyBodies(phase, sunOut, moonOut) {
  const elev = (solar(phase) - 0.25) * Math.PI * 2;
  sunOut
    .set(-0.18 - 0.27 * Math.sin(elev), Math.sin(elev) * 0.7, Math.cos(elev) * 0.65 + 0.55)
    .normalize();
  const melev = elev + Math.PI + 0.35;
  moonOut
    .set(0.3 - 0.2 * Math.sin(melev), Math.sin(melev) * 0.45, -(Math.cos(melev) * 0.5 + 0.45))
    .normalize();
}
function updateAtmosphere(dt) {
  dayRate += (dayRateTarget - dayRate) * Math.min(1, dt * 0.8);
  dayPhase = (dayPhase + (dt * dayRate) / DAY_SECONDS) % 1;
  evalPalette(solar(dayPhase));
  skyBodies(dayPhase, _sunDir, _moonDir);
  const sy = _sunDir.y;
  const night = sstep(-0.02, -0.2, sy);
  const sunUp = sstep(-0.025, 0.06, sy);
  const moonAbove = sstep(-0.02, 0.12, _moonDir.y);
  const moonLight = sstep(-0.09, -0.2, sy) * moonAbove;
  uNight.value = night;
  uSunDir.value.copy(_sunDir);
  uMoonDir.value.copy(_moonDir);
  uMoonUp.value = moonAbove;
  uMoonLight.value = moonLight;
  uLowSun.value = Math.exp(-((sy / 0.14) ** 2));
  uGlowI.value = sstep(-0.22, -0.04, sy) * (1 - sstep(0.12, 0.32, sy));
  uVenusI.value = Math.exp(-(((sy + 0.03) / 0.09) ** 2));
  uZenith.value.copy(pal.zenith);
  uUpper.value.copy(pal.upper);
  uHorizon.value.copy(pal.horizon);
  uHorizonWarm.value.copy(pal.horizonWarm);
  uUpperWarm.value.copy(pal.upperWarm);
  uGlow.value.copy(pal.glow);
  uCloudWhite.value
    .copy(cloudWhite)
    .lerp(pal.glow, uLowSun.value * 0.45)
    .lerp(pal.horizon, night * 0.97);
  uBelow.value.copy(pal.below);
  uSunColor.value.copy(pal.sun);
  // One shadow-casting light: the sun by day, the moon by night. It changes
  // direction only while its intensity is zero, so nothing ever jumps.
  if (sunUp > 0) {
    sun.position.copy(_sunDir);
    sun.color.copy(pal.sun);
    sun.intensity = pal.sunI * sunUp;
    sun.shadow.intensity = 0.55 * LOOK.shadowI;
  } else {
    sun.position.copy(_moonDir);
    sun.color.copy(MOON_COLOR);
    sun.intensity = L.moon.intensity * moonLight;
    sun.shadow.intensity = 0.4 * LOOK.shadowI;
  }
  // The shadow frame follows the bike, but only in whole shadow-map texels
  // across the light's plane, so the shadows drawn on the ground never crawl
  // as the frame slides under them.
  _m4.lookAt(sun.position, _zero, sun.up);
  const texel = (SHADOW_HALF * 2) / SHADOW_MAP,
    e = _m4.elements;
  _v3.set(e[0], e[1], e[2]);
  _s3.set(e[4], e[5], e[6]);
  const along = bike.position.dot(_v3),
    up = bike.position.dot(_s3);
  sun.target.position
    .copy(bike.position)
    .addScaledVector(_v3, Math.round(along / texel) * texel - along)
    .addScaledVector(_s3, Math.round(up / texel) * texel - up);
  sun.position.multiplyScalar(1000).add(sun.target.position);
  hemi.color.copy(pal.hemiSky);
  hemi.groundColor.copy(pal.hemiGround);
  hemi.intensity = pal.hemiI;
  // cloud sea and whiteout follow the camera's altitude relative to the deck;
  // the eye stops down a little over the bright sea
  const rel = camera.position.y - DECK_Y;
  uAbove.value = sstep(-90, 30, rel);
  renderer.toneMappingExposure = BASE_EXPOSURE * (1 - 0.25 * night) * (1 - 0.12 * uAbove.value);
  uFogDensity.value = FOG_DENSITY * (1 - 0.28 * sstep(0.1, 0.65, sy)) * (1 + 0.35 * night);
  cloudSea.visible = uAbove.value > 0.001;
  uCloudBodies.value = sstep(-240, -80, rel);
  clouds.visible = uCloudBodies.value > 0.001;
  uWhiteout.value = (1 - sstep(0, 80, Math.abs(rel + 20))) * 0.996;
  // No star vertices submitted in daylight or inside the opaque deck.
  galaxy.stars.visible = night > 0 && uWhiteout.value < 0.995;
  sky.position.copy(camera.position);
  // the headlight comes on with the dusk
  uLamp.value.set(state.x, state.z, state.heading, sstep(0.02, -0.12, sy));
}

// ---------------------------------------------------------------------------
// Resume. A remembered ride in this world continues from its exact moment:
// place, course, speed, time of day and the schedules that hang off the clock.
// ---------------------------------------------------------------------------
function restoreRide(stored) {
  if (!stored || stored.seed !== seed) return false;
  const n = (key, min, max) => finite(stored[key], min, max);
  const x = n('x'),
    z = n('z'),
    heading = n('heading'),
    t = n('t', 0),
    phase = n('dayPhase', 0, 1);
  if ([x, z, heading, t, phase].some((v) => v === null)) return false;
  Object.assign(state, {
    x,
    z,
    t,
    heading: wrapAngle(heading),
    speed: n('speed', 0, 40) ?? RIDE.cruise,
    yawRate: n('yawRate', -2, 2) ?? 0,
    lean: n('lean', -1, 1) ?? 0,
    dir: stored.dir === -1 ? -1 : 1,
    odometer: n('odometer', 0) ?? 0,
  });
  dayPhase = phase % 1;
  const flock = stored.flock ?? {};
  Object.assign(moments, {
    nextFlock: finite(flock.next, 0) ?? t + 90,
    flockStarted: finite(flock.started, 0) ?? 0,
    flockUntil: finite(flock.until, 0) ?? 0,
    flockOn: flock.on === true,
  });
  return true;
}
function rideMemory() {
  return {
    seed,
    x: state.x,
    z: state.z,
    t: state.t,
    heading: state.heading,
    speed: state.speed,
    yawRate: state.yawRate,
    lean: state.lean,
    dir: state.dir,
    odometer: state.odometer,
    dayPhase,
    flock: {
      next: moments.nextFlock,
      started: moments.flockStarted,
      until: moments.flockUntil,
      on: moments.flockOn,
    },
  };
}
// Written every couple of seconds while riding and whenever the ride stops,
// hides or leaves; never before Begin, when nothing has changed.
let begun = false,
  lastSave = -Infinity;
function saveRide() {
  if (!begun || disposed) return;
  lastSave = performance.now();
  remember.write(RESUME_KEY, rideMemory());
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const resumed = restoreRide(storedRide);
if (!resumed) intro.beat = 'dawn';
skyBodies(dayPhase, _sunDir, _moonDir);
fillAll(Math.round(state.x / CELL), Math.round(state.z / CELL));
state.y = heightAt(state.x, state.z);
placeTrees(state.x, state.z);
// stand the bike on its wheels for the still behind Begin
updateRide(1e-4);
state.t = resumed ? state.t - 1e-4 : 0;
let last = performance.now();
let running = false,
  paused = false,
  disposed = false,
  primed = false;
let openingTimer, disposalTask;
let timestampPending = false,
  timestampTask = Promise.resolve(),
  captureTask = Promise.resolve();
const perf = { cpuMs: 0, renderMs: 0, frameMs: 0, frames: 0, gpuMs: null };
// Raw per-frame samples, kept only under `?profile=1`. Averages hide the
// long frames a fan hears, so the bench needs the distribution, not an EMA.
const TRACE_MAX = 60000;
const trace = {
  frame: [],
  cpu: [],
  render: [],
  gpu: [],
  reset() {
    for (const key of ['frame', 'cpu', 'render', 'gpu']) trace[key].length = 0;
    trace.at = performance.now();
    return trace;
  },
  at: 0,
};
const push = (list, value) => {
  if (list.length < TRACE_MAX) list.push(value);
};
// One executable simulation path, also used by sustained-ride regression checks.
function advance(dt, sound = true) {
  if (disposed || !Number.isFinite(dt) || dt <= 0 || dt > 0.05) return;
  updateRide(dt);
  updateTitle();
  time.value = state.t;
  updateHeightfield(state.x, state.z);
  uOrigin.value.set(Math.round(state.x / CELL) * CELL, Math.round(state.z / CELL) * CELL);
  terrain.position.set(uOrigin.value.x, 0, uOrigin.value.y);
  uWaterOrigin.value.set(
    Math.round(state.x / WATER_CELL) * WATER_CELL,
    Math.round(state.z / WATER_CELL) * WATER_CELL,
  );
  water.position.set(uWaterOrigin.value.x, 0, uWaterOrigin.value.y);
  cloudSea.position.set(state.x, DECK_Y - 55, state.z);
  placeTrees(state.x, state.z);
  updateClouds(state.x, state.z, state.t);
  updateMoments(dt, sound);
  updateCamera(dt);
  placeGrass(camera.position.x, camera.position.z);
  updateAtmosphere(dt);
  if (performance.now() - lastSave > 2000) saveRide();
}
// A small linear picture of the scene as it stands, for checks that must see
// what is drawn (the sun over the clouds, the light on their tops) rather than
// trust a uniform: the canvas itself cannot be read back after presentation.
function capture(width = 192, height = 108) {
  if (disposed) return Promise.resolve(null);
  const task = captureTask.then(async () => {
    if (disposed) return null;
    const target = new THREE.RenderTarget(width, height, { type: THREE.FloatType, depthBuffer: true });
    const aspect = camera.aspect;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setRenderTarget(target);
    try {
      await renderer.renderAsync(scene, camera);
      const read = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
      // rows come top first on both backends
      const data = new Float32Array(read.length),
        row = width * 4,
        flip = !renderer.backend.isWebGPUBackend;
      for (let y = 0; y < height; y++) data.set(read.subarray(y * row, (y + 1) * row), (flip ? height - 1 - y : y) * row);
      return { width, height, data };
    } finally {
      renderer.setRenderTarget(null);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      target.dispose();
    }
  });
  captureTask = task.catch(() => null);
  return task;
}
function frame(now) {
  if (disposed || document.hidden) return;
  const interval = now - last;
  const dt = Math.min(0.05, interval / 1000);
  last = now;
  if (primed && running && !paused) perf.frameMs += (interval - perf.frameMs) * 0.05;
  const t0 = performance.now();
  if (running && !paused) {
    advance(dt);
    audio.update(dt);
  } else if (!running) {
    // One still, lit frame behind Begin. No idle GPU loop.
    uOrigin.value.set(Math.round(state.x / CELL) * CELL, Math.round(state.z / CELL) * CELL);
    terrain.position.set(uOrigin.value.x, 0, uOrigin.value.y);
    uWaterOrigin.value.set(
      Math.round(state.x / WATER_CELL) * WATER_CELL,
      Math.round(state.z / WATER_CELL) * WATER_CELL,
    );
    water.position.set(uWaterOrigin.value.x, 0, uWaterOrigin.value.y);
    cloudSea.position.set(state.x, DECK_Y - 55, state.z);
    updateClouds(state.x, state.z, 0);
    updateCamera(dt);
    placeGrass(camera.position.x, camera.position.z);
    updateAtmosphere(0);
  }
  const t1 = performance.now();
  post.render();
  perf.triangles = renderer.info.render.triangles;
  perf.drawCalls = renderer.info.render.drawCalls;
  if (profiling && !timestampPending) {
    timestampPending = true;
    timestampTask = renderer.resolveTimestampsAsync().then(
      () => {
        perf.gpuMs = renderer.info.render.timestamp || null;
        if (perf.gpuMs) push(trace.gpu, perf.gpuMs);
        timestampPending = false;
      },
      () => {
        timestampPending = false;
      },
    );
  }
  const t2 = performance.now();
  perf.cpuMs += (t1 - t0 - perf.cpuMs) * 0.1;
  perf.renderMs += (t2 - t1 - perf.renderMs) * 0.1;
  perf.frames++;
  if (profiling && primed && running && !paused) {
    push(trace.frame, interval);
    push(trace.cpu, t1 - t0);
    push(trace.render, t2 - t1);
  }
  primed = true;
  if (!running || paused) renderer.setAnimationLoop(null);
  unveil();
}
// The veil lifts only once the first frame is on screen: the GPU has finished
// the work behind it (the queue on WebGPU, a fence on WebGL2) and the browser
// has had a frame in which to present it. A fade begun any earlier would show
// a blank canvas for a moment, or a world with half its shaders compiled.
let ready = false,
  veilTask = null;
function unveil() {
  if (veilTask) return veilTask;
  veilTask = (async () => {
    const backend = renderer.backend;
    if (backend.isWebGPUBackend) await backend.device.queue.onSubmittedWorkDone();
    else {
      const gl = backend.gl,
        fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      while (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) await new Promise((r) => setTimeout(r, 16));
      gl.deleteSync(fence);
    }
    await new Promise(requestAnimationFrame);
    if (disposed) return;
    ready = true;
    document.getElementById('loading').classList.add('gone');
    panel.classList.add('ready');
    beginBtn.disabled = false;
  })();
  return veilTask;
}
renderer.setAnimationLoop(frame);

window.addEventListener('resize', () => {
  if (disposed) return;
  if (perch.classList.contains('open')) {
    placePerch();
    markOverflow();
  }
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(renderScale());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (!running || paused) {
    last = performance.now();
    // TSL FRAME nodes advance on the renderer's animation tick, not a direct
    // call. Schedule one tick so the scene pass does not reuse its old image.
    renderer.setAnimationLoop(frame);
  }
});
function syncPlayback() {
  if (disposed) return;
  endDrag();
  saveRide();
  last = performance.now();
  audio.suspend(document.hidden || paused || !running);
  renderer.setAnimationLoop(!disposed && !document.hidden && running && !paused ? frame : null);
}
function togglePause() {
  if (!running || disposed) return;
  paused = !paused;
  const button = document.getElementById('pauseBtn');
  button.textContent = paused ? 'resume' : 'pause';
  button.title = paused ? 'Resume ride' : 'Pause ride';
  button.setAttribute('aria-pressed', String(paused));
  syncPlayback();
}
document.getElementById('pauseBtn').addEventListener('click', togglePause);
document.addEventListener('visibilitychange', () => {
  syncPlayback();
  if (!document.hidden && !primed) renderer.setAnimationLoop(frame);
});
function dispose() {
  if (disposed) return disposalTask;
  saveRide();
  disposed = true;
  running = false;
  renderer.setAnimationLoop(null);
  clearTimeout(openingTimer);
  const audioTask = audio.dispose();
  // Readback buffers must finish mapping before renderer disposal destroys them.
  disposalTask = Promise.all([timestampTask, captureTask, audioTask]).then(() => {
    const geometries = new Set(),
      materials = new Set();
    scene.traverse((o) => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material)
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      if (o.isInstancedMesh) o.dispose();
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of [hfTex, barkMap, barkRelief, aoMap, grassMap, galaxy.map]) t.dispose();
    for (const pool of Object.values(speciesPools)) pool.map?.dispose();
    sun.shadow.dispose();
    scenePass.dispose();
    glow?.dispose();
    display.dispose();
    softDisplay.dispose();
    post.dispose();
    renderer.dispose();
  });
  return disposalTask;
}
window.addEventListener('pagehide', (e) => {
  saveRide();
  if (e.persisted) {
    renderer.setAnimationLoop(null);
    audio.suspend(true);
  } else dispose();
});
window.addEventListener('pageshow', (e) => {
  if (e.persisted) syncPlayback();
});
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  window.rideFailure();
});
renderer.backend.device?.addEventListener('uncapturederror', () => {
  if (!disposed) window.rideFailure();
});
renderer.backend.device?.lost.then((info) => {
  if (!disposed && info.reason !== 'destroyed') window.rideFailure();
});

// The gate. The world stands still behind Begin until the veil has lifted and
// the viewer asks; that click is also the gesture that unlocks sound.
const beginBtn = document.getElementById('beginBtn'),
  panel = document.getElementById('begin');
beginBtn.addEventListener('click', () => {
  if (running || disposed || !ready) return;
  audio.start();
  running = true;
  begun = true;
  paused = reducedMotion;
  panel.classList.add('gone');
  panel.inert = true;
  document.getElementById('hud').inert = false;
  const pauseButton = document.getElementById('pauseBtn');
  pauseButton.disabled = false;
  pauseButton.textContent = paused ? 'resume' : 'pause';
  pauseButton.title = paused ? 'Resume ride' : 'Pause ride';
  pauseButton.setAttribute('aria-pressed', String(paused));
  canvas.inert = false;
  canvas.focus({ preventScroll: true });
  syncPlayback();
  openingTimer = setTimeout(() => {
    if (!disposed && !paused && !document.hidden) audio.chime(3);
  }, 1800);
});
// expose a little for review tooling
window.__ride = {
  state,
  cam,
  views: VIEWS,
  nextView,
  perf,
  trace,
  renderer,
  camera,
  moments,
  heightAt,
  dispose,
  step: (dt) => advance(dt, false),
  capture,
  lite: LITE,
  road,
  ride: RIDE,
  roadSpec: ROAD,
  start: START,
  surface: {
    cell: CELL,
    size: N,
    data: hfData,
    get center() {
      return [hfCx, hfCz];
    },
  },
  objects: {
    terrain,
    water,
    species: speciesPools,
    props: Object.fromEntries(propPools.map((pool) => [pool.entry.id, pool.mesh])),
    sites: sitePools,
    grass,
    clouds,
    cloudSea,
    sky,
    bike,
    companions,
    sun,
    groundShade: { map: aoMap, origin: aoOrigin.value, span: AO_SPAN },
  },
  get dayPhase() {
    return dayPhase;
  },
  set dayPhase(v) {
    dayPhase = ((v % 1) + 1) % 1;
  },
  get running() {
    return running;
  },
  get paused() {
    return paused;
  },
  get disposed() {
    return disposed;
  },
  get audioState() {
    return audio.state;
  },
  get masterGain() {
    return audio.gain;
  },
  get volume() {
    return audio.volume;
  },
  get muted() {
    return audio.muted;
  },
  rpm: audio.rpm,
  seed,
  resumed,
  isNight,
  intro,
  opening: INTRO,
  title,
  titleCard: TITLE,
  get ready() {
    return ready;
  },
  solar,
  nightShare: NIGHT_SHARE,
  deck: DECK_Y,
  get dayRate() {
    return dayRate;
  },
  biomeAt,
  treeCell: TREE_CELL,
  trees: treeRecords,
  sites: siteRecords,
  placed: propRecords,
  library: {
    swatches: SWATCH,
    biomes: BIOMES,
    species: SPECIES,
    sites: SITES,
    props: PROPS,
    birds: BIRDS,
    paints: PAINTS,
    validate: () => validateLibrary(registry),
    validateBaked,
  },
  sky: { sun: _sunDir, moon: _moonDir, events: SKY_EVENTS, galaxy },
  begin: () => beginBtn.click(),
  renderStyle: 'soft',
  paints: PAINTS.map((entry) => entry.id),
  get paint() {
    return paintId;
  },
  setPaint,
};
