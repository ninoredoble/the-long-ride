async function rideChecks() {
  // Run in a main-page tab, on either backend, with the Chrome DevTools AXI CLI
  // (commands in CONTRIBUTING.md). No source-text assertions: the checks consume
  // the running page, its road, its geometry and its memory. Each world opens in
  // an iframe of the same address after storage is cleared, and is disposed
  // before the next one, so an earlier world cannot leak into a later check.
  const checks = [];
  const assert = (condition, name, detail = '') => {
    if (!condition) throw new Error(detail ? `${name} (${detail})` : name);
    checks.push(name);
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const openWorld = async (url) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
    frame.src = url;
    document.body.appendChild(frame);
    const win = frame.contentWindow;
    const deadline = Date.now() + 30000;
    let veilHeld = true;
    while (!win.__ride?.ready && !win.rideFailed && Date.now() < deadline) {
      const veil = win.document?.getElementById('loading');
      if (veil && (veil.classList.contains('gone') || !win.document.getElementById('beginBtn').disabled)) veilHeld = false;
      await wait(20);
    }
    if (!win.__ride?.ready || win.rideFailed) throw new Error('world did not open: ' + url);
    const doc = win.document;
    if (!veilHeld || win.__ride.perf.frames < 1 || !doc.getElementById('loading').classList.contains('gone') || doc.getElementById('beginBtn').disabled)
      throw new Error('the veil did not hold until the first frame was drawn, then lift: ' + url);
    return { frame, win, doc, r: win.__ride };
  };
  const closeWorld = async (world) => {
    await world.r.dispose();
    world.frame.remove();
  };
  const wrapAngle = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

  const settled = Date.now() + 20000;
  while (!window.__ride && !window.rideFailed && Date.now() < settled) await wait(50);
  await window.__ride?.dispose?.();
  localStorage.clear();

  let world = await openWorld(location.href);
  let { win, doc, r } = world;
  assert(r && !win.rideFailed, 'scene initialized');
  assert(new URL(win.location.href).searchParams.get('seed') === String(r.seed), 'the address carries the resolved seed');
  const gate = doc.getElementById('begin');
  assert(gate.classList.contains('ready') && !gate.classList.contains('gone') && !doc.getElementById('beginBtn').disabled, 'the gate stands on the drawn world with Begin ready');
  assert(doc.title === 'The Long Ride', 'the page is titled The Long Ride');
  const copy = doc.documentElement.outerHTML;
  assert(!/kunchenguid|kun chen|discord|twitter\.com|x\.com\/|fly-with-me/i.test(copy), 'no original-author links or names in the page');
  assert(r.audioState !== 'running', 'audio waits for Begin', String(r.audioState));

  // Library: validates clean, names the four landscapes of the brief.
  const problems = r.library.validate();
  assert(!problems || problems.length === 0 || problems === true, 'the library validates clean', JSON.stringify(problems));
  const biomeIds = r.library.biomes.map((b) => b.id);
  for (const id of ['coast', 'paddies', 'pineapple', 'pines']) assert(biomeIds.includes(id), 'biome present: ' + id);

  // The road: continuous, smooth, above the sea, and the bike on it.
  const road = r.road,
    S = r.state;
  let worstJump = 0, worstGrade = 0, lowest = 1e9;
  for (let z = S.z - 4000; z < S.z + 4000; z += 2) {
    worstJump = Math.max(worstJump, Math.abs(road.x(z + 2) - road.x(z)) / 2);
    worstGrade = Math.max(worstGrade, Math.abs(road.y(z + 2) - road.y(z)) / 2);
    lowest = Math.min(lowest, road.y(z));
  }
  assert(worstJump < 1.2, 'the road has no sideways seams', 'slope ' + worstJump.toFixed(2));
  assert(worstGrade < 0.2, 'the road grade stays rideable', 'grade ' + worstGrade.toFixed(3));
  assert(lowest >= r.roadSpec.floor - 0.01, 'the road never runs below its floor over water', String(lowest));
  const ground = (x, z) => r.heightAt(x, z);
  assert(Math.abs(ground(road.x(S.z), S.z) - road.y(S.z)) < 0.6, 'the terrain under the road is carved to the road surface', `${ground(road.x(S.z), S.z)} vs ${road.y(S.z)}`);

  // Begin starts the ride; the bike follows the road on its own and keeps to its lane.
  r.begin();
  await wait(300);
  assert(!doc.getElementById('begin') || doc.getElementById('begin').classList.contains('gone') || doc.getElementById('begin').inert, 'Begin lifts the gate');
  let maxSide = 0, minClear = 1e9, rode = 0;
  const z0 = S.z, dir0 = S.dir;
  for (let i = 0; i < 6 * 60 * 20; i++) {
    r.step(0.05);
    maxSide = Math.max(maxSide, Math.abs(road.distance(S.x, S.z)));
    minClear = Math.min(minClear, S.y - ground(S.x, S.z));
  }
  rode = Math.abs(S.z - z0);
  assert(rode > 3000, 'six simulated minutes ride on, far along the road', rode.toFixed(0) + ' m');
  assert(S.dir === dir0, 'the bike never turns back on its own');
  assert(maxSide < 5.4, 'auto-ride stays on the asphalt and shoulder', maxSide.toFixed(2));
  assert(minClear > -0.05, 'the bike never sinks into the ground', minClear.toFixed(2));
  assert(Number.isFinite(S.x + S.y + S.z + S.heading), 'state stays finite');

  // The world is made of the brief's landscapes: a long ride meets every
  // biome, read from the CPU world itself along the road (the page's own
  // heightfield window holds only nine kilometres).
  const seen = {},
    weights = new Float32Array(r.library.biomes.length),
    probe = [0, 0, 0, 0];
  for (let z = S.z - 100000; z < S.z + 100000; z += 250) {
    r.world.sample(road.x(z) + 30, z, probe);
    r.biomeWeights(probe[1], probe[2], probe[3], weights);
    let best = 0;
    for (let i = 1; i < weights.length; i++) if (weights[i] > weights[best]) best = i;
    const id = r.library.biomes[best].id;
    seen[id] = (seen[id] ?? 0) + 1;
  }
  for (const id of ['coast', 'paddies', 'pineapple', 'pines']) assert((seen[id] ?? 0) >= 20, 'a long ride meets ' + id, JSON.stringify(seen));

  // Steering outranks the plan, and the bike rejoins the road afterwards.
  const h0 = S.heading, canvas = doc.getElementById('c');
  const ptr = (type, x, y, button) => canvas.dispatchEvent(new win.PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, button, buttons: type === 'pointerup' ? 0 : button === 2 ? 2 : 1, bubbles: true, pointerType: 'mouse' }));
  ptr('pointerdown', 600, 400, 2);
  for (let i = 1; i <= 10; i++) { ptr('pointermove', 600 + i * 20, 400, 2); await wait(60); }
  ptr('pointerup', 800, 400, 2);
  await wait(900);
  assert(Math.abs(wrapAngle(S.heading - h0)) > 0.2, 'right-drag steers the bike', String(wrapAngle(S.heading - h0)));
  assert(Math.abs(road.distance(S.x, S.z)) > 0 && Number.isFinite(S.x), 'steering leaves the bike somewhere real');
  for (let i = 0; i < 30 * 20; i++) r.step(0.05);
  assert(Math.abs(road.distance(S.x, S.z)) < 4.5 && S.onRoad > 0.9, 'after a steer the bike rejoins the road', road.distance(S.x, S.z).toFixed(2));

  // Camera and paint.
  const view0 = doc.getElementById('viewBtn').textContent;
  doc.getElementById('viewBtn').click();
  await wait(100);
  assert(doc.getElementById('viewBtn').textContent !== view0, 'the camera button changes the view');
  const chosen = r.paints.find((id) => id !== r.paint);
  doc.getElementById('paintBtn').click();
  await wait(100);
  assert(doc.getElementById('perch').classList.contains('open'), 'the paint perch opens');
  const tiles = [...doc.querySelectorAll('#perchPaints button')];
  assert(tiles.length === r.paints.length && tiles.length >= 6, 'one tile per paint', String(tiles.length));
  tiles[r.paints.indexOf(chosen)].click();
  await wait(200);
  assert(r.paint === chosen, 'a tile paints the bike', r.paint);

  // Memory: the paint and the place are remembered, a URL seed beats the memory.
  doc.getElementById('pauseBtn').click();
  await wait(200);
  const savedSeed = r.seed, savedPaint = r.paint;
  await closeWorld(world);
  world = await openWorld(location.href);
  ({ win, doc, r } = world);
  assert(r.paint === savedPaint, 'the chosen paint is remembered', r.paint);
  assert(r.resumed === true, 'the same world resumes where it was left');
  await closeWorld(world);
  const other = new URL(location.href);
  other.searchParams.set('seed', String((savedSeed + 1) >>> 0));
  world = await openWorld(other.href);
  assert(world.r.seed === ((savedSeed + 1) >>> 0) && world.r.resumed === false, 'a URL seed beats the remembered world');
  assert(world.r.paint === savedPaint, 'the paint outlives a change of world');
  await closeWorld(world);
  localStorage.clear();

  // Teardown leaves no running world behind.
  assert(world.r.disposed, 'dispose tears the world down');
  return { checks: checks.length, names: checks };
}
