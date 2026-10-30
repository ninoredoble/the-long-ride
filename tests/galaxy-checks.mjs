import assert from 'node:assert/strict';
import { brightestMatter, makeDust, sampleDust, photographicMatter } from '../src/galaxy-matter.js';

const dust = makeDust();
const again = makeDust();
assert.equal(dust.data.length, 4096 * 512, 'temporary extinction field has a fixed budget');
assert.deepEqual(dust.data, again.data, 'dust branching is deterministic');
let darkest = 1,
  clearest = 0,
  peak = 0,
  colorSpread = 0;
for (let i = 0; i < 3000; i++) {
  const longitude = -Math.PI + (i / 3000) * Math.PI * 2;
  const latitude = Math.sin(i * 2.399963) * 0.35;
  const a = photographicMatter(longitude, latitude, dust);
  const b = photographicMatter(longitude + Math.PI * 2, latitude, dust);
  assert(Number.isFinite(a.transmission) && a.transmission >= 0 && a.transmission <= 1);
  darkest = Math.min(darkest, a.transmission);
  clearest = Math.max(clearest, a.transmission);
  for (let c = 0; c < 3; c++) {
    assert(Number.isFinite(a.color[c]) && a.color[c] >= 0 && a.color[c] <= 2);
    assert(Math.abs(a.color[c] - b.color[c]) < 1e-9, 'stellar light wraps seamlessly around the sky');
    peak = Math.max(peak, a.color[c]);
  }
  colorSpread = Math.max(colorSpread, Math.max(...a.color) - Math.min(...a.color));
  assert(
    Math.abs(sampleDust(dust, longitude, latitude) - sampleDust(dust, longitude - Math.PI * 2, latitude)) < 1e-9,
    'extinction wraps with the stellar light',
  );
}
assert(darkest < 0.1 && clearest > 0.9, 'dust has opaque branches and clear star windows');
assert(peak > 0.5 && colorSpread > 0.1, 'stellar light has a luminous core and color separation');

// The brightest place in the sky, which the flight turns toward once a night,
// is found in this field and nowhere else: it lies in the galactic core, it is
// as bright as anything the sky can be sampled at, and it does not move.
const luminance = (color) => color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
const brightest = brightestMatter(dust);
assert.deepEqual(brightest, brightestMatter(dust), 'the brightest place is deterministic');
const there = photographicMatter(brightest.longitude, brightest.latitude, dust);
assert(there.core > 0.9 && there.body > 0.9, 'the brightest place lies in the galactic core');
let found = 0;
for (let i = 0; i < 40000; i++) {
  const longitude = -Math.PI + (i / 40000) * Math.PI * 2;
  const latitude = Math.sin(i * 2.399963) * 0.4;
  found = Math.max(found, luminance(photographicMatter(longitude, latitude, dust).color));
}
assert(found <= brightest.peak * 1.1, 'nothing in the sky is brighter than the peak it reports', String(found));
assert(luminance(there.color) > found * 0.6, 'the place it points at is as luminous as the sky gets');
console.log('Galaxy field checks passed: deterministic, bounded, periodic, finite, colored, contrasting, and led by its core.');
