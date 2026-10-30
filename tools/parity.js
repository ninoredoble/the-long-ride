async function parity(options = window.__parity || {}) {
  // Visual parity, read from the finished picture. The page's own `capture`
  // reads the scene before the display chain, so it cannot see tone mapping,
  // bloom, the soft reconstruction or FXAA; this points the render pipeline at a
  // small target and reads back exactly what a viewer's screen would receive,
  // in the eight bits per channel a screen actually has.
  //
  // Every vantage pins place, course, hour and the simulation clock, so grass,
  // water and cloud motion stand still: two builds at the same vantage differ
  // only where the change differs, and the comparison is pixel against pixel.
  //
  // Run it once with `{ save: true }` on the build being kept as the reference;
  // the pictures go into this origin's local storage. Run it again on a changed
  // build and it returns the difference per vantage, in screen levels. Dev-only,
  // like `tools/bench.js`; the bundler folds `src/` and `library/`, never this.
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const settle = Date.now() + 30000;
  while (!window.__fly?.ready && !window.flightFailed && Date.now() < settle) await wait(50);
  const z = window.__fly;
  if (!z?.ready) throw new Error('the world did not open');
  // A resumed flight starts somewhere else, so every vantage would be a
  // different scene; clear the page's memory and reload before measuring.
  if (z.resumed) throw new Error('this world resumed a remembered flight; clear storage and reload');
  const width = options.width ?? 384,
    height = options.height ?? 216,
    key = options.key ?? 'flyParity';
  // The world's own start, read before Begin: three hundred milliseconds of
  // flight is already a different place, and the vantages are measured from it.
  const start = { x: z.state.x, z: z.state.z, heading: z.state.heading };
  // The viewer's framing is remembered across visits, so put it back to the
  // default before measuring; otherwise a saved orbit moves every vantage.
  Object.assign(z.cam, { yaw: 0, pitch: 0.3, dist: 17, lift: 0 });
  if (!z.running) z.begin();
  await wait(300);
  if (z.paused) document.getElementById('pauseBtn').click();
  // The page is a module and does not put Three.js on the window; the page's own
  // import map resolves it here, for the source page and the bundle alike.
  const THREE = await import('three');
  const renderer = z.renderer;
  const cssWidth = window.innerWidth,
    cssHeight = window.innerHeight,
    ratio = renderer.getPixelRatio();
  const deck = z.objects.cloudSea.position.y + 55;
  const pin = { on: false };
  const hold = () => {
    if (!pin.on) return;
    z.state.x = pin.x;
    z.state.z = pin.z;
    z.state.y = pin.y;
    z.state.heading = pin.heading;
    z.state.vy = 0;
    z.state.yawRate = 0;
    z.state.flapping = false;
    z.state.flapTimer = 0;
    z.state.bank = 0;
    z.state.pitch = 0;
    // The wing beat keeps its own phase, outside the flight state.
    Object.assign(z.objects.bird.userData, { phase: 0, flapAmp: 0.09 });
    z.state.t = pin.t;
    z.dayPhase = pin.day;
    // The camera's lift out of the ground eases with the frame time, so a
    // sub-pixel of it survives any settling wait and lights up every leaf edge
    // in a comparison. Zero it: the clamp underneath is exact either way.
    Object.assign(z.cam, { yaw: 0, pitch: 0.3, dist: 17, lift: 0 });
    requestAnimationFrame(hold);
  };
  // The pipeline sizes every one of its targets from the drawing buffer, so the
  // whole chain has to run at the size that is read back.
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  z.camera.aspect = width / height;
  z.camera.updateProjectionMatrix();
  const target = new THREE.RenderTarget(width, height, { type: THREE.UnsignedByteType, depthBuffer: true });
  const at = (dx, dz, extra) => ({ x: start.x + dx, z: start.z + dz, heading: start.heading, day: 0.5, t: 400, ...extra });
  const places = {
    dawn: at(0, 0, { day: 0.262 }),
    noon: at(0, 0, {}),
    far: at(4200, -3100, {}),
    above: at(0, 0, { deck: true }),
    night: at(0, 0, { day: 0 }),
  };
  const encode = async () => {
    renderer.setOutputRenderTarget(target);
    // TSL frame passes advance on the renderer's own tick, so let the loop draw
    // into the target rather than calling the pipeline by hand.
    await wait(300);
    const read = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
    renderer.setOutputRenderTarget(null);
    await wait(120);
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      rgb[j] = read[i * 4];
      rgb[j + 1] = read[i * 4 + 1];
      rgb[j + 2] = read[i * 4 + 2];
    }
    let binary = '';
    for (let i = 0; i < rgb.length; i += 4096) binary += String.fromCharCode.apply(null, rgb.subarray(i, i + 4096));
    return btoa(binary);
  };
  const decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const difference = (one, two) => {
    const a = decode(one),
      b = decode(two);
    let max = 0,
      sum = 0,
      over1 = 0,
      over2 = 0,
      over4 = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > max) max = d;
      sum += d;
      if (d > 1) over1++;
      if (d > 2) over2++;
      if (d > 4) over4++;
    }
    const share = (v) => Math.round((v / a.length) * 1e6) / 1e4;
    return {
      maxDelta: max,
      meanDelta: Math.round((sum / a.length) * 1000) / 1000,
      overOnePct: share(over1),
      overTwoPct: share(over2),
      overFourPct: share(over4),
    };
  };
  const shots = {};
  // The vantage stands still but the world is not frozen: ripples, cloud folds
  // and the wing beat still move by the length of one frame between two reads.
  // Two reads of the same build, moments apart, measure that floor, and no
  // comparison below it means anything.
  const noise = {};
  for (const [name, place] of Object.entries(places)) {
    // Two steps: the heightfield only knows the ground under a place once it has
    // streamed there, so arrive high, let it fill, then settle to the vantage.
    Object.assign(pin, place, { y: 900, on: true });
    z.forceHigh = !!place.deck;
    z.forceLow = false;
    hold();
    await wait(1500);
    pin.y = place.deck ? deck + 140 : Math.max(z.heightAt(place.x, place.z), 0) + 130;
    await wait(2600);
    shots[name] = await encode();
    await wait(700);
    noise[name] = difference(shots[name], await encode());
  }
  pin.on = false;
  z.forceHigh = false;
  target.dispose();
  renderer.setPixelRatio(ratio);
  renderer.setSize(cssWidth, cssHeight, false);
  z.camera.aspect = cssWidth / cssHeight;
  z.camera.updateProjectionMatrix();

  const record = { width, height, backend: document.getElementById('backendLabel')?.textContent, seed: z.seed, shots };
  if (options.save) {
    localStorage.setItem(key, JSON.stringify(record));
    return { saved: Object.keys(shots), width, height, seed: z.seed, noise };
  }
  const stored = localStorage.getItem(key);
  if (!stored) throw new Error(`no reference in local storage under ${key}; run once with { save: true } first`);
  const reference = JSON.parse(stored);
  if (reference.width !== width || reference.height !== height || reference.seed !== z.seed)
    throw new Error('the reference was taken at another size or seed');
  // A difference is reported in screen levels, because that is the unit a
  // viewer sees in: nothing over one level anywhere is a picture nobody can
  // tell apart, and the share of pixels past two says how far a change spread.
  const compare = {};
  let worst = 0;
  for (const name of Object.keys(shots)) {
    compare[name] = { ...difference(reference.shots[name], shots[name]), noise: noise[name] };
    worst = Math.max(worst, compare[name].maxDelta);
  }
  return { width, height, seed: z.seed, worstDelta: worst, compare };
}
