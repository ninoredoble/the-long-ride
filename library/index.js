// The registry. To add to the world, add a file under biomes/, species/,
// sites/, props/, birds/ or paints/ and one line here. The order of biomes
// and species is theirs to keep: it is not a priority. See CONTRIBUTING.md.

import coast from './biomes/coast.js';
import paddies from './biomes/paddies.js';
import forest from './biomes/forest.js';
import pineapple from './biomes/pineapple.js';
import pasture from './biomes/pasture.js';
import pines from './biomes/pines.js';

import coconut from './species/coconut.js';
import banana from './species/banana.js';
import mango from './species/mango.js';
import raintree from './species/raintree.js';
import lauan from './species/lauan.js';
import pine from './species/pine.js';

import watchtower from './sites/watchtower.js';
import church from './sites/church.js';

import boulders from './props/boulders.js';
import hut from './props/hut.js';

import egret from './birds/egret.js';

import ink from './paints/ink.js';
import signal from './paints/signal.js';
import paper from './paints/paper.js';
import jade from './paints/jade.js';
import mangoPaint from './paints/mango.js';
import laterite from './paints/laterite.js';
import pinePaint from './paints/pine.js';
import dusk from './paints/dusk.js';

export const biomes = [coast, paddies, forest, pineapple, pasture, pines];
export const species = [coconut, banana, mango, raintree, lauan, pine];
export const sites = [watchtower, church];
export const props = [boulders, hut];
// The flock that crosses the road now and then.
export const birds = [egret];
// The first paint is the bike a new visitor rides; the corner control lists this order.
export const paints = [ink, signal, paper, jade, mangoPaint, laterite, pinePaint, dusk];
