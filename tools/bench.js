async function bench(options = window.__bench || {}) {
  // A repeatable measurement of how hard the page works the machine. Runs in a
  // main-page tab opened with `?profile=1&seed=<n>`, on either backend, against
  // the source page or the bundle, and reads only what the running page reports:
  // the raw frame trace (`__fly.trace`, armed by the same flag) and the
  // renderer's own counters. Nothing here ships; the bundler folds `src/` and
  // `library/`, never `tools/`.
  //
  // Why these numbers. A laptop fan follows sustained power, and on this page
  // power is the GPU and the main thread staying busy, not the frame rate: under
  // vsync the rate pins to the display and hides every bit of headroom, so it
  // says nothing about cost. The two busy fractions do. GPU busy is the timer
  // query's frame cost times the frames actually presented each second, and main
  // busy is the same for the simulation plus the render call. Both keep falling
  // as the work gets cheaper even while the rate never moves, which is the
  // property a power proxy needs. Frame-time percentiles and the long-frame
  // share carry the other half of the product's promise: a hitch is felt. Run
  // the browser with `--disable-gpu-vsync --disable-frame-rate-limit` as well,
  // and the frame time becomes the naked cost of a frame.
  //
  // Why vantages and not a free flight. Cost follows what is in front of the
  // bird, and a free flight is never twice in the same place: the same build
  // measured twice drifted by more than half its frame time, which is larger
  // than any win worth chasing. So each station teleports the bird to a fixed
  // place, course and hour of this seed's world and holds it there while the
  // window is read. Draw calls and triangle counts repeating exactly across runs
  // is the check that the vantage really is the same scene.
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const settle = Date.now() + 30000;
  while (!window.__fly?.ready && !window.flightFailed && Date.now() < settle) await wait(50);
  const z = window.__fly;
  if (!z?.ready) throw new Error('the world did not open');
  // A resumed flight starts somewhere else, so every vantage would be a
  // different scene; clear the page's memory and reload before measuring.
  if (z.resumed) throw new Error('this world resumed a remembered flight; clear storage and reload');
  if (!z.trace) throw new Error('open the page with ?profile=1 so the frame trace is armed');
  const stat = (list) => {
    if (!list.length) return null;
    const sorted = Float64Array.from(list).sort();
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const variance = sorted.reduce((a, b) => a + (b - mean) * (b - mean), 0) / sorted.length;
    const round = (v) => Math.round(v * 1000) / 1000;
    return {
      n: sorted.length,
      // The cheapest frames in a window are the ones the rest of the machine
      // left alone, so p05 is the honest cost of the work itself, and the mean
      // is what the viewer's machine actually spent under everything else.
      p05: round(at(0.05)),
      mean: round(mean),
      p50: round(at(0.5)),
      p95: round(at(0.95)),
      p99: round(at(0.99)),
      max: round(sorted[sorted.length - 1]),
      sd: round(Math.sqrt(variance)),
    };
  };
  const pct = (v) => Math.round(v * 10) / 10;
  const seconds = options.seconds ?? 10,
    only = options.only ?? null,
    wanted = (name) => !only || only.includes(name);

  // The world's own start, read before Begin: three hundred milliseconds of
  // flight is already a different place, and the vantages are measured from it.
  const start = { x: z.state.x, z: z.state.z, heading: z.state.heading };
  // The viewer's framing is remembered across visits, so put it back to the
  // default before measuring; otherwise a saved orbit moves every vantage.
  Object.assign(z.cam, { yaw: 0, pitch: 0.3, dist: 17, lift: 0 });
  if (!z.running) z.begin();
  await wait(300);
  if (z.paused) document.getElementById('pauseBtn').click();
  const deck = z.objects.cloudSea.position.y + 55;
  // Hold the world still: the flight keeps running, but place, course and hour
  // are put back every frame, so streaming, placement and light stand where the
  // vantage says and one build can be compared with another.
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
    z.dayPhase = pin.day;
    // The camera's lift out of the ground eases with the frame time, so a
    // sub-pixel of it survives any settling wait and lights up every leaf edge
    // in a comparison. Zero it: the clamp underneath is exact either way.
    Object.assign(z.cam, { yaw: 0, pitch: 0.3, dist: 17, lift: 0 });
    requestAnimationFrame(hold);
  };
  const station = async (name, place) => {
    // Two steps: the heightfield only knows the ground under a place once it has
    // streamed there, so arrive high, let it fill, then settle to the vantage.
    Object.assign(pin, place, { y: 900, on: true });
    z.forceHigh = !!place.high;
    z.forceLow = false;
    hold();
    await wait(1500);
    pin.y = place.high ? deck + 140 : Math.max(z.heightAt(place.x, place.z), 0) + 130;
    // The heightfield, the tree rings and the grass window all rebuild after a
    // jump; give them frames to arrive before the window opens.
    await wait(3000);
    z.trace.reset();
    const started = performance.now();
    await wait(seconds * 1000);
    const elapsed = (performance.now() - started) / 1000;
    const frame = stat(z.trace.frame),
      cpu = stat(z.trace.cpu),
      render = stat(z.trace.render),
      gpu = stat(z.trace.gpu);
    if (!frame) throw new Error(`station ${name} recorded no frames; is the flight running?`);
    const fps = frame.n / elapsed;
    const long = z.trace.frame.filter((v) => v > 20).length / frame.n;
    return {
      seconds: Math.round(elapsed * 100) / 100,
      frames: frame.n,
      fps: Math.round(fps * 10) / 10,
      frameMs: frame,
      longFrames: pct(long * 100),
      cpuMs: cpu,
      renderMs: render,
      gpuMs: gpu,
      // The two power proxies: milliseconds of work per second of wall clock.
      gpuBusy: gpu ? pct(((gpu.mean * fps) / 1000) * 100) : null,
      mainBusy: pct((((cpu.mean + render.mean) * fps) / 1000) * 100),
      drawCalls: z.perf.drawCalls,
      triangles: z.perf.triangles,
    };
  };
  const at = (dx, dz, extra) => ({ x: start.x + dx, z: start.z + dz, heading: start.heading, day: 0.5, ...extra });
  const stations = {};
  // Noon over the world's own opening ground, and two places a few kilometres
  // off it, so one station's luck with the terrain cannot carry the number.
  if (wanted('dawn')) stations.dawn = await station('dawn', at(0, 0, { day: 0.262 }));
  if (wanted('noon')) stations.noon = await station('noon', at(0, 0, {}));
  if (wanted('far')) stations.far = await station('far', at(4200, -3100, {}));
  // Above the deck, where the cloud sea replaces the ground.
  if (wanted('above'))
    stations.above = await station('above', at(0, 0, { high: true }));
  // Midnight below the deck: the Milky Way, the stars and the moon draw here.
  if (wanted('night')) stations.night = await station('night', at(0, 0, { day: 0 }));
  pin.on = false;
  z.forceHigh = false;
  const canvas = document.querySelector('canvas');
  const list = Object.values(stations);
  const worst = (key) => Math.max(...list.map((s) => s[key] ?? 0));
  const mean = (key) => pct(list.reduce((a, s) => a + (s[key] ?? 0), 0) / list.length);
  return {
    environment: {
      backend: document.getElementById('backendLabel')?.textContent,
      seed: z.seed,
      css: [window.innerWidth, window.innerHeight],
      buffer: [canvas.width, canvas.height],
      pixels: canvas.width * canvas.height,
      pixelRatio: z.renderer.getPixelRatio(),
      dpr: window.devicePixelRatio,
      memoryMB: Math.round((z.renderer.info.memory.total ?? 0) / 1048576),
    },
    stations,
    // The headline: sustained busy fractions and the frame a viewer would feel.
    summary: {
      frameMsMean: pct(list.reduce((a, s) => a + s.frameMs.mean, 0) / list.length),
      frameMsQuiet: pct(list.reduce((a, s) => a + s.frameMs.p05, 0) / list.length),
      gpuMsMean: pct(list.reduce((a, s) => a + (s.gpuMs?.mean ?? 0), 0) / list.length),
      gpuMsQuiet: pct(list.reduce((a, s) => a + (s.gpuMs?.p05 ?? 0), 0) / list.length),
      gpuMsWorst: pct(Math.max(...list.map((s) => s.gpuMs?.mean ?? 0))),
      renderMsMean: pct(list.reduce((a, s) => a + s.renderMs.mean, 0) / list.length),
      gpuBusyMean: mean('gpuBusy'),
      gpuBusyWorst: pct(worst('gpuBusy')),
      mainBusyMean: mean('mainBusy'),
      frameMsP95Worst: pct(Math.max(...list.map((s) => s.frameMs.p95))),
      longFramesWorst: pct(worst('longFrames')),
      drawCallsWorst: worst('drawCalls'),
      trianglesWorst: worst('triangles'),
    },
  };
}
