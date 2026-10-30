async function nightChecks() {
  // Run in a source or bundled page. A fresh frame owns all destructive trials;
  // assertions consume generated geometry and GPU pixels, never source text.
  const checks = [],
    measurements = {};
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
    checks.push(message);
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await window.__fly?.dispose();
  localStorage.clear();
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
  frame.src = location.href;
  document.body.append(frame);
  const win = frame.contentWindow;
  const deadline = Date.now() + 30000;
  while (!win.__fly?.ready && !win.flightFailed && Date.now() < deadline) await wait(30);
  const f = win.__fly;
  assert(f?.ready && !win.flightFailed, 'night check world opens');
  const { stars, map } = f.sky.galaxy;
  const scene = f.objects.sky.parent;
  const image = map.image.data.slice();
  try {
    f.begin();
    if (!f.paused) win.document.getElementById('pauseBtn').click();
    win.document
      .getElementById('c')
      .dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    f.state.nudgeYaw = 0;
    Object.assign(f.cam, { yaw: 0, pitch: -0.22, dist: 17, lift: 0 });
    const geometry = stars.geometry;
    const directions = geometry.getAttribute('starDirection');
    const colors = geometry.getAttribute('color');
    const radii = geometry.getAttribute('starRadius');
    assert(
      geometry.instanceCount > 100000 && geometry.instanceCount <= 300000,
      'star catalog is dense and bounded by its fixed candidate budget',
    );
    assert(
      geometry.getAttribute('position').count === 4 && geometry.index.count === 6,
      'the catalog shares one indexed quad',
    );
    let directionError = 0;
    for (let i = 0; i < geometry.instanceCount; i++) {
      directionError = Math.max(
        directionError,
        Math.abs(Math.hypot(directions.getX(i), directions.getY(i), directions.getZ(i)) - 1),
      );
      if (![colors.getX(i), colors.getY(i), colors.getZ(i), radii.getX(i)].every(Number.isFinite))
        throw new Error('non-finite star');
      if (radii.getX(i) <= 0 || radii.getX(i) > 9) throw new Error('star radius outside angular budget');
    }
    assert(directionError < 1e-6, 'star directions are finite unit vectors with bounded radii');
    assert(
      map.image.width === 4096 && map.image.height === 512 && image.length === 4096 * 512 * 4,
      'stellar-light atlas respects its fixed allocation',
    );
    const setSky = (phase, altitude) => {
      f.dayPhase = phase;
      f.state.y = altitude;
      f.state.heading = 1.25;
      f.step(0.000001);
      // Isolate sky from seed-dependent foreground, not from its painted clouds.
      for (const object of scene.children) if (object !== f.objects.sky && object !== stars) object.visible = false;
    };
    const picture = async () => {
      const shot = await f.capture(640, 320);
      assert(shot.data.every(Number.isFinite), 'sky readback is finite');
      return shot.data;
    };
    const blankAtlas = () => {
      for (let i = 0; i < map.image.data.length; i += 4) map.image.data.fill(0, i, i + 3);
      map.needsUpdate = true;
    };
    const restoreAtlas = () => {
      map.image.data.set(image);
      map.needsUpdate = true;
    };
    const difference = (a, b) => {
      let total = 0,
        peak = 0,
        points = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d =
          Math.abs(a[i] - b[i]) * 0.2126 +
          Math.abs(a[i + 1] - b[i + 1]) * 0.7152 +
          Math.abs(a[i + 2] - b[i + 2]) * 0.0722;
        total += d;
        peak = Math.max(peak, d);
        if (d > 0.015) points++;
      }
      return { mean: total / (a.length / 4), peak, points };
    };
    setSky(0, 760);
    const full = await picture();
    stars.visible = false;
    const band = await picture();
    blankAtlas();
    const empty = await picture();
    restoreAtlas();
    stars.visible = true;
    measurements.stars = difference(full, band);
    measurements.band = difference(band, empty);
    assert(
      measurements.stars.points > 100 && measurements.stars.peak > 0.08,
      'hundreds of individual star pixels survive in the cloudy night sky',
    );
    assert(
      measurements.band.mean > 0.002 && measurements.band.peak > 0.1,
      'the colored galactic structure is rendered beyond the painted clouds: ' + JSON.stringify(measurements.band),
    );
    const repeat = await picture();
    assert(difference(full, repeat).peak < 1e-5, 'paused star and dust detail is stable across GPU readbacks');
    const attributes = directions.array,
      texels = map.image.data;
    setSky(0.5, 760);
    assert(!stars.visible, 'daylight skips the star draw');
    const day = await picture();
    blankAtlas();
    const dayEmpty = await picture();
    restoreAtlas();
    assert(difference(day, dayEmpty).peak < 1e-5, 'the Milky Way contributes no stellar-light pixels in daylight');
    // The opening starts in a low valley. Use its still-local ground rather
    // than the six-minute flight's path to reach the center of the deck.
    f.cam.pitch = 0;
    setSky(0, 500);
    measurements.crossingCameraY = f.camera.position.y;
    assert(Math.abs(f.camera.position.y - 500) < 0.1, 'the crossing trial reaches the center of the cloud deck');
    assert(!stars.visible, 'the opaque deck skips the star draw');
    const crossing = await picture();
    blankAtlas();
    const crossingEmpty = await picture();
    restoreAtlas();
    measurements.crossing = difference(crossing, crossingEmpty);
    assert(
      measurements.crossing.peak < measurements.band.peak * 0.02,
      'the cloud crossing extinguishes the galaxy rather than leaving a glowing band',
    );
    assert(
      directions.array === attributes && map.image.data === texels,
      'day and cloud transitions retain the same star and texture allocations',
    );
    assert(!win.flightFailed, 'night, daylight and cloud crossing render without graphics failures');
  } finally {
    map.image.data.set(image);
    await f.dispose();
    frame.remove();
    localStorage.clear();
  }
  assert(f.renderer.info.memory.total === 0, 'night-sky teardown releases all graphics allocations');
  return { checks, measurements };
}
