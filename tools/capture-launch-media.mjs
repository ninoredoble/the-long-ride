#!/usr/bin/env node
// Records the launch media from the page itself: a 1920x1080 60fps film of a
// world's first minute, with the sound the page synthesizes, and a still of
// the same flight. No dependencies; Node 22 or later, plus a Chrome and an
// ffmpeg on the PATH.
//
//   node tools/capture-launch-media.mjs                  the film and the still
//   node tools/capture-launch-media.mjs --seconds 30     a shorter film
//   node tools/capture-launch-media.mjs --seed 7 --only hero
//
// Nothing here ships. The page is served unchanged except for one substitution
// (below), the capture code is injected into the page from the outside, and the
// files land in media/, which is not committed; assets/hero.png is updated by
// hand, deliberately, from what this writes.
//
// How it records, and why it records that way:
//
//   * The film is the engine's canvas composited with the page's own title
//     card, drawn into a second canvas that is what MediaRecorder sees. A
//     canvas stream cannot carry the page's HTML layers, so the title is
//     lifted out of this very DOM as a transparent plate and drawn each frame
//     at the opacity, blur and scale the engine is giving it.
//   * The veil, the Begin gate and the controls are simply never drawn into
//     that composite. They must stay visible in the page: with nothing painted
//     over it the engine's canvas is composited straight to the screen, and
//     copying it then costs a whole frame (60fps becomes 11).
//   * The sound is the page's own audio graph, tapped where it reaches the
//     destination and handed to the recorder as it is. Bridging it through a
//     second AudioContext runs on a second clock and under-runs: a third of
//     the samples go missing and the rest crackles.
//   * Recording starts after Begin, so no veil and no gate reach the film.
//   * The engine's two-megapixel render cap is raised in the copy this serves,
//     because 1920x1080 is just over it and the film should be a true 1080p
//     rather than an upscale. That substitution is asserted, so an engine
//     change cannot quietly turn the film soft.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIDTH = 1920,
  HEIGHT = 1080;
const VIDEO_BITRATE = 12_000_000; // the highest the encoder holds sixty frames a second at
const RENDER_CAP = [/Math\.sqrt\(2000000 \//, 'Math.sqrt(2200000 /'];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// ---------------------------------------------------------------------------
// What was asked for
// ---------------------------------------------------------------------------
function options(argv) {
  const opts = {
    seconds: 60,
    seed: 42,
    out: 'media',
    fps: 60,
    heroAt: 26,
    only: 'both',
    loudness: -16,
    ceiling: -2,
    chrome: process.env.CHROME || null,
    video: null,
    hero: null,
    keep: false,
  };
  const numbers = new Set(['seconds', 'seed', 'fps', 'heroAt', 'loudness', 'ceiling']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in opts)) throw new Error(`unknown option ${argv[i]}`);
    if (key === 'keep') {
      opts.keep = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${argv[i - 1]} wants a value`);
    opts[key] = numbers.has(key) ? Number(value) : value;
  }
  if (!['both', 'video', 'hero'].includes(opts.only)) throw new Error('--only is both, video or hero');
  opts.out = path.resolve(root, opts.out);
  opts.video = path.resolve(root, opts.video ?? path.join(opts.out, 'fly-with-me-launch.mp4'));
  opts.hero = path.resolve(root, opts.hero ?? path.join(opts.out, 'hero.png'));
  return opts;
}

const say = (...parts) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...parts);

// ---------------------------------------------------------------------------
// The page, served from here, and somewhere for the recording to land
// ---------------------------------------------------------------------------
async function serve(capture) {
  const engine = await readFile(path.join(root, 'src/main.js'), 'utf8');
  if (!RENDER_CAP[0].test(engine))
    throw new Error("src/main.js no longer has the render cap this tool raises; find it and fix RENDER_CAP");
  const raised = engine.replace(RENDER_CAP[0], RENDER_CAP[1]);
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/recording') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        capture.push(Buffer.concat(chunks));
        res.writeHead(200).end('ok');
      });
      return;
    }
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !existsSync(file)) return res.writeHead(404).end('not found');
    if (rel === 'src/main.js')
      return res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' }).end(raised);
    readFile(file).then(
      (body) =>
        res
          .writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
          .end(body),
      () => res.writeHead(404).end('not found'),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

// ---------------------------------------------------------------------------
// A browser of our own, spoken to over the DevTools protocol
// ---------------------------------------------------------------------------
function chromeBinary(given) {
  const candidates = given
    ? [given]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('no Chrome found; pass --chrome <path> or set CHROME');
  return found;
}

async function browser(opts) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'fly-with-me-capture-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu',
    // the page renders as fast as it can and the capture caps it; without this
    // headless holds every page to about thirty frames a second
    '--disable-frame-rate-limit',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
  ];
  const child = spawn(chromeBinary(opts.chrome), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let text = '';
    const die = setTimeout(() => reject(new Error('Chrome never announced a debugging endpoint')), 30000);
    child.stderr.on('data', (d) => {
      text += d;
      const found = /ws:\/\/[^\s]+/.exec(text);
      if (found) {
        clearTimeout(die);
        resolve(found[0]);
      }
    });
    child.on('exit', (code) => reject(new Error(`Chrome exited with ${code}`)));
  });

  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('could not speak to Chrome'));
  });
  let next = 0;
  const waiting = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      waiting.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetInfos } = await send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const evaluate = async (fn, ...args) => {
    const expression = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`;
    const { result, exceptionDetails } = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const until = async (fn, timeout = 300000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(fn)) return;
      await sleep(200);
    }
    throw new Error('gave up waiting for the page');
  };
  const screenshot = async () => {
    const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    return Buffer.from(data, 'base64');
  };
  const clickCentre = async (selector) => {
    const box = await evaluate((sel) => {
      const b = document.querySelector(sel).getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, selector);
    for (const type of ['mousePressed', 'mouseReleased'])
      await call('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  };
  const open = async (url) => {
    await call('Page.navigate', { url });
    await until(() => document.readyState === 'complete');
  };

  return {
    call,
    evaluate,
    until,
    screenshot,
    clickCentre,
    open,
    close: async () => {
      try {
        await send('Browser.close');
      } catch {
        child.kill();
      }
      socket.close();
      await new Promise((resolve) => child.on('exit', resolve));
      await rm(profile, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// The capture itself, injected into the page before the engine loads
// ---------------------------------------------------------------------------
function harness() {
  const CAP = {
    state: 'idle',
    error: null,
    mime: null,
    bytes: 0,
    frames: 0,
    rate: 0,
    plates: {},
  };
  window.__capture = CAP;

  // One decision per browser frame, taken on a fixed grid: every callback of a
  // frame shares its timestamp, and deciding per callback starves whichever
  // loop asks second.
  const rawRaf = window.requestAnimationFrame.bind(window);
  let openFrame = -1,
    nextSlot = 0,
    period = 0;
  window.requestAnimationFrame = function (cb) {
    const step = (t) => {
      if (period > 0 && openFrame !== t) {
        if (nextSlot === 0) nextSlot = t;
        if (t < nextSlot - 0.5) return rawRaf(step);
        openFrame = t;
        nextSlot += period;
        if (nextSlot < t) nextSlot = t + period;
      }
      cb(t);
    };
    return rawRaf(step);
  };
  CAP.capFrames = (fps) => {
    period = fps > 0 ? 1000 / fps : 0;
    nextSlot = 0;
  };

  // Whatever the page sends to its audio destination is sent to a tap as well.
  const taps = [];
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    const out = connect.apply(this, [target, ...rest]);
    try {
      const ctx = target && target.context;
      if (ctx && target === ctx.destination && !taps.some((t) => t.ctx === ctx)) {
        const tap = { ctx, dest: ctx.createMediaStreamDestination() };
        taps.push(tap);
        connect.call(this, tap.dest);
      }
    } catch (e) {
      // a tap must never break the page's own sound
    }
    return out;
  };

  const $ = (id) => document.getElementById(id);
  const number = (text, re) => {
    const m = re.exec(text || '');
    return m ? parseFloat(m[1]) : null;
  };

  let mix = null,
    paint = null,
    recorder = null,
    track = null,
    chunks = [],
    running = false;

  CAP.setPlates = async (plates) => {
    for (const plate of plates) {
      const image = new Image();
      image.src = plate.dataUrl;
      await image.decode();
      CAP.plates[plate.key] = { bitmap: await createImageBitmap(image), rect: plate.rect };
    }
    return Object.keys(CAP.plates);
  };

  CAP.prepare = (width, height) => {
    mix = document.createElement('canvas');
    mix.width = width;
    mix.height = height;
    paint = mix.getContext('2d', { alpha: false });
    return { width: mix.width, height: mix.height };
  };

  function composite() {
    const canvas = $('c');
    paint.globalAlpha = 1;
    paint.filter = 'none';
    paint.drawImage(canvas, 0, 0, mix.width, mix.height);
    // The title card, at the opacity, blur and scale the engine is giving it.
    const presents = $('titlePresents'),
      name = $('titleName');
    const pOpacity = parseFloat(getComputedStyle(presents).opacity) || 0;
    if (pOpacity > 0.002 && CAP.plates.presents) {
      paint.globalAlpha = Math.min(1, pOpacity);
      paint.drawImage(CAP.plates.presents.bitmap, 0, 0, mix.width, mix.height);
      paint.globalAlpha = 1;
    }
    const nOpacity = parseFloat(getComputedStyle(name).opacity) || 0;
    const plate = CAP.plates.name;
    if (nOpacity > 0.002 && plate) {
      const blur = number(name.style.filter, /blur\(([\d.]+)px\)/) || 0;
      const scale = number(name.style.transform, /scale\(([\d.]+)\)/) || 1;
      const cx = plate.rect.x + plate.rect.width / 2,
        cy = plate.rect.y + plate.rect.height / 2;
      paint.save();
      paint.globalAlpha = Math.min(1, nOpacity);
      if (blur > 0.01) paint.filter = 'blur(' + blur.toFixed(2) + 'px)';
      paint.translate(cx, cy);
      paint.scale(scale, scale);
      paint.translate(-cx, -cy);
      paint.drawImage(plate.bitmap, 0, 0, mix.width, mix.height);
      paint.restore();
    }
    CAP.frames++;
  }

  const MIMES = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ];
  CAP.start = (bitrate) => {
    const stream = mix.captureStream(0);
    track = stream.getVideoTracks()[0];
    const tap = taps[0];
    if (!tap) throw new Error('the page has not made a sound yet: press Begin first');
    CAP.rate = tap.ctx.sampleRate;
    const both = new MediaStream([...stream.getVideoTracks(), ...tap.dest.stream.getAudioTracks()]);
    CAP.mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    recorder = new MediaRecorder(both, {
      mimeType: CAP.mime,
      videoBitsPerSecond: bitrate,
      audioBitsPerSecond: 192000,
    });
    chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) {
        chunks.push(e.data);
        CAP.bytes += e.data.size;
      }
    };
    running = true;
    // One recorded frame per composite: the stream never merges two into a
    // slot and never leaves one empty.
    const loop = () => {
      if (!running) return;
      try {
        composite();
        track.requestFrame();
      } catch (e) {
        CAP.error = String(e.message || e);
      }
      requestAnimationFrame(loop);
    };
    recorder.start(1000);
    CAP.state = 'recording';
    requestAnimationFrame(loop);
    return { mime: CAP.mime, rate: CAP.rate };
  };

  CAP.stop = () =>
    new Promise((resolve) => {
      running = false;
      if (!recorder || recorder.state === 'inactive') return resolve(null);
      recorder.onstop = () => {
        CAP.state = 'stopped';
        resolve({ frames: CAP.frames, bytes: CAP.bytes, error: CAP.error });
      };
      recorder.stop();
    });

  CAP.upload = async () => {
    const blob = new Blob(chunks, { type: (CAP.mime || '').split(';')[0] });
    const response = await fetch('/recording', { method: 'POST', body: blob });
    return { ok: response.ok, size: blob.size };
  };
}

// The page's title card, lifted out of this DOM as a transparent plate: it is
// the real rendering, so the film carries the real type, kerning and shadow.
const PLATES = {
  presents:
    '#title{display:flex!important}#titlePresents{opacity:1!important;filter:none!important;transform:none!important}#titleName{opacity:0!important}',
  name: '#title{display:flex!important}#titleName{opacity:1!important;filter:none!important;transform:none!important}#titlePresents{opacity:0!important}',
};
const PLATE_BASE =
  '*{transition:none!important;animation:none!important}html,body{background:transparent!important}' +
  '#c{visibility:hidden!important}#loading,#begin,#title,#hud{display:none!important}';

async function liftPlates(chrome) {
  const rects = await chrome.evaluate(() => {
    const box = (id) => {
      const b = document.getElementById(id).getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    };
    return { presents: box('titlePresents'), name: box('titleName') };
  });
  await chrome.call('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const plates = [];
  for (const [key, css] of Object.entries(PLATES)) {
    await chrome.evaluate(
      (all) => {
        let sheet = document.getElementById('capture-plate');
        if (!sheet) {
          sheet = document.createElement('style');
          sheet.id = 'capture-plate';
          document.head.appendChild(sheet);
        }
        sheet.textContent = all;
      },
      PLATE_BASE + css,
    );
    const png = await chrome.screenshot();
    plates.push({ key, rect: rects[key], dataUrl: 'data:image/png;base64,' + png.toString('base64') });
  }
  await chrome.evaluate(() => document.getElementById('capture-plate')?.remove());
  await chrome.call('Emulation.setDefaultBackgroundColorOverride');
  return plates;
}

// ---------------------------------------------------------------------------
// The two passes
// ---------------------------------------------------------------------------
async function recordFlight(opts, url, capture) {
  const chrome = await browser(opts);
  try {
    await chrome.call('Page.addScriptToEvaluateOnNewDocument', { source: `(${harness.toString()})()` });
    await chrome.open(url);
    await chrome.until(() => Boolean(window.__fly && window.__fly.ready));
    const framing = await chrome.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      canvas: [document.getElementById('c').width, document.getElementById('c').height],
      backend: document.getElementById('backendLabel').textContent,
    }));
    if (framing.canvas[0] !== WIDTH || framing.canvas[1] !== HEIGHT)
      throw new Error(`the engine is drawing ${framing.canvas.join('x')}, not ${WIDTH}x${HEIGHT}`);
    say(`world ready on ${framing.backend}, drawing ${framing.canvas.join('x')}`);

    say('lifting the title card');
    const plates = await liftPlates(chrome);
    await chrome.evaluate((list) => window.__capture.setPlates(list), plates);
    await chrome.evaluate((w, h) => window.__capture.prepare(w, h), WIDTH, HEIGHT);
    await chrome.evaluate((fps) => window.__capture.capFrames(fps), opts.fps);

    // Begin first: the film opens on the flight, and the page's audio graph
    // only exists once the viewer has asked for it.
    await chrome.clickCentre('#beginBtn');
    say('begun; recording', `${opts.seconds}s`);
    say('recorder', await chrome.evaluate((bits) => window.__capture.start(bits), VIDEO_BITRATE));
    await sleep((opts.seconds + 3) * 1000);

    const stopped = await chrome.evaluate(() => window.__capture.stop());
    if (stopped?.error) throw new Error(`the capture reported: ${stopped.error}`);
    const sent = await chrome.evaluate(() => window.__capture.upload());
    if (!sent.ok || !capture.length) throw new Error('the recording never arrived');
    say(`captured ${stopped.frames} frames, ${(sent.size / 1e6).toFixed(1)} MB`);
  } finally {
    await chrome.close();
  }
  const raw = path.join(opts.out, 'capture.mp4');
  await writeFile(raw, Buffer.concat(capture));
  return raw;
}

async function captureHero(opts, url) {
  const chrome = await browser(opts);
  try {
    await chrome.open(url);
    await chrome.until(() => Boolean(window.__fly && window.__fly.ready));
    await chrome.clickCentre('#beginBtn');
    // the still is the world alone; a screenshot is not a canvas copy, so
    // hiding the page's own layers here costs nothing
    await chrome.evaluate(() => {
      const sheet = document.createElement('style');
      sheet.textContent = '#hud,#title,#begin,#loading{display:none!important}';
      document.head.appendChild(sheet);
    });
    say(`flying to ${opts.heroAt}s for the still`);
    await sleep(opts.heroAt * 1000);
    const png = await chrome.screenshot();
    await writeFile(opts.hero, png);
    say(`still: ${path.relative(root, opts.hero)} (${(png.length / 1e6).toFixed(2)} MB)`);
  } finally {
    await chrome.close();
  }
}

// ---------------------------------------------------------------------------
// The cut
// ---------------------------------------------------------------------------
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '',
      err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve(out + err) : reject(new Error(`${command} failed:\n${(out + err).slice(-1500)}`)),
    );
  });
}

// The page's sound is quiet on purpose, so the cut is brought up to a delivery
// loudness measured from the take rather than a number typed in here.
async function loudness(file) {
  const text = await run('ffmpeg', ['-i', file, '-af', 'loudnorm=print_format=summary', '-f', 'null', '-']);
  const read = (label) => Number(new RegExp(label + ':\\s*(-?[\\d.]+)').exec(text)?.[1]);
  return { integrated: read('Input Integrated'), peak: read('Input True Peak') };
}

async function encode(opts, raw) {
  const measured = await loudness(raw);
  const wanted = opts.loudness - measured.integrated;
  const room = opts.ceiling - measured.peak + 4; // the limiter may hold back four
  const gain = Math.max(0, Math.min(wanted, room)).toFixed(1);
  const limit = Math.pow(10, opts.ceiling / 20).toFixed(3);
  say(`sound: ${measured.integrated} LUFS in, ${gain} dB up, ceiling ${opts.ceiling} dBTP`);
  const fadeAt = opts.seconds - 1;
  await run('ffmpeg', [
    '-v', 'error',
    '-i', raw,
    '-t', String(opts.seconds),
    '-vf', `fade=t=out:st=${fadeAt}:d=1,format=yuv420p`,
    '-af', `volume=${gain}dB,alimiter=limit=${limit}:level=disabled:attack=15:release=200,afade=t=out:st=${fadeAt - 0.6}:d=1.6`,
    '-fps_mode', 'cfr',
    '-r', String(opts.fps),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-level', '4.2',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-y', opts.video,
  ]);
}

async function report(file) {
  const text = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration,size',
    '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,duration',
    '-of', 'default=noprint_wrappers=1',
    file,
  ]);
  const field = (name) => new RegExp(name + '=(.+)').exec(text)?.[1];
  const durations = [...text.matchAll(/duration=([\d.]+)/g)].map((m) => Number(m[1]));
  say(
    `film: ${path.relative(root, file)} ${field('width')}x${field('height')} ` +
      `${field('r_frame_rate')} ${durations.at(-1).toFixed(2)}s ` +
      `${(Number(field('size')) / 1e6).toFixed(1)} MB`,
  );
  const drift = Math.max(...durations) - Math.min(...durations);
  if (drift > 0.25) throw new Error(`picture and sound are ${drift.toFixed(2)}s apart; the capture under-ran`);
}

// ---------------------------------------------------------------------------
async function main() {
  const opts = options(process.argv.slice(2));
  await mkdir(opts.out, { recursive: true });
  for (const tool of ['ffmpeg', 'ffprobe'])
    await run(tool, ['-version']).catch(() => {
      throw new Error(`${tool} is needed to cut the film; install it and try again`);
    });

  const capture = [];
  const { server, port } = await serve(capture);
  const url = `http://127.0.0.1:${port}/index.html?seed=${opts.seed}&capture=${Date.now()}`;
  say(`serving the page on ${port}, seed ${opts.seed}`);
  try {
    if (opts.only !== 'hero') {
      const raw = await recordFlight(opts, url, capture);
      await encode(opts, raw);
      await report(opts.video);
      if (!opts.keep) await rm(raw, { force: true });
    }
    if (opts.only !== 'video') await captureHero(opts, url);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exitCode = 1;
});
