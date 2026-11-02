# Contributing

The Long Ride is one engine reading a library of places and things. Most contributions are one file under `library/` and one line in `library/index.js`, a paint or a flock included; light, sky, fog, shadows, streaming and shaders belong to the engine and stay closed, which is what keeps every contribution looking like the same world. Read `VISION.md` first: a contribution is judged by whether it makes the viewer calmer or gives them a moment of awe, whether it keeps the world plausible, endless and coherent, and what it costs a machine that runs the page for hours. Quiet and rare beats busy and loud. The engine's own rules are in `AGENTS.md`.

## Running the source

Serve the repository with any static server and open `index.html`:

```bash
python3 -m http.server
```

The browser loads `src/` and `library/` as modules, so the source does not run from `file://`. Three.js r185.1 comes from a CDN through the import map in the page's head, so the first load needs a network connection. WebGPU is used over HTTPS or localhost and WebGL2 otherwise; `?webgl=1` forces WebGL2, `?seed=<number>` picks a world, and `?profile=1` arms the frame trace. The page validates the whole library as it loads and refuses a broken entry by name in the console before anything is drawn.

`node tools/bundle.mjs` (Node 18 or later, no dependencies) folds the page and every module it reaches into `dist/index.html`, one file that opens from anywhere, as one inline module script in dependency order with Three.js left on its CDN; `--check` says whether an existing bundle is current. It folds only static `import ... from` and `export const|let|function|class|default`, so keep modules to those forms: no dynamic import, no `import.meta`, and top-level await only in the entry. `dist/` is generated and ignored.

## The contract

`library/contract.js` is the whole contract: the swatch book, the palette envelope, the budgets, the shape of each entry, and the validator. Read it before writing an entry.

- **Colors** are swatch names (`'meadow'`, `'rockCold'`) or hex values inside the envelope: saturation at most 0.62, lightness between 0.18 and 0.93, measured in sRGB. No neon, no black, no white ground. Named tints such as `'white'` are multipliers over painted textures and are allowed by name.
- **Budgets**: a tree crown has at most 200 painted cards; a baked prop or site type at most 6,000 triangles; a prop kind at most 2,000 instances in the streamed ring; a site type at most 8 sites in the ring. The engine measures every baked geometry and refuses one over its budget by name.
- **Randomness**: use the random stream the kit gives you. It is seeded per entry and per cell, so a change to your object never reshuffles the trees, and the same cell always holds the same thing.
- **Materials**: there are none to write. Kits produce vertex-colored geometry; the engine lights it with its own soft material, fogs it, shadows it, and shrinks it into the ground at the edge of the streamed ring.

## A biome

`library/biomes/<id>.js`, data only: where it lives in climate (temperature, moisture, region, each 0..1), what its ground looks like, which species grow there and how thickly, the grass, the props, and how welcome the old builders were. Copy `library/biomes/autumn.js`.

Biomes are soft cells in the three-axis climate, three slow fields each a dozen kilometers wide and warped so borders wander; the borders are bands of a couple of hundred meters where ground, species and grass blend. Two biomes with the same temperature and moisture can differ on the third axis, region: that is how the autumn vale and the oak hills both exist. Put a new biome where the climate makes sense (frost is cold, dunes are hot and dry) and it will sit between its neighbors without a seam.

## A tree species

`library/species/<id>.js`. Two ways:

- **Data for the tree kit**: a trunk, limbs, and a crown shape, `dome` (cards around each limb tip), `cone` (cards along the trunk), `fan` (a ring of fronds at the top) or `bare`, with a leaf palette from `LEAVES`. Copy `library/species/pine.js` or `oak.js`.
- **Your own generator**: give `bake(kit)` and grow the tree any way you like (an L-system, space colonization, a hand-placed silhouette). The kit gives you `kit.branch(from, to, radiusStart, radiusEnd)` to lay wood along a curve, `kit.card(center, normal, rotationOrMatrix, size)` to hang a painted card, `kit.random()` and `kit.matrix(...)`. A tree that only does those two things gets the crown morph between near and far, the ring shrink, shadows and the climate tint for free.

Every species is one baked tree, instanced whole and tinted per instance by its climate (`tint.cold`, `tint.warm`, `tint.dry`). Keep tops modest, since trees stand near the road: roughly 50 m at the largest scale.

## A site

`library/sites/<id>.js`. One kind of old building seen from the road: its share of the sites found (`odds`), the ground it needs (`slope`, and `hill` for a local top), its `footprint` for clearance, `sunward` to face the sunrise, and `build(kit)` over the masonry kit (`kit.block`, `kit.raw` and the rest of the masonry kit in `library/contract.js`). Sites keep clear of the asphalt and its verge and count as obstacles for the bike and the camera.

Sites are rare on purpose. Do not make one type loud to be seen more often; make it read from the saddle at 75 km/h and let rarity do the rest.

## Any other object

`library/props/<id>.js`. Two functions:

- `bake(kit)` builds the geometry once. The kit has `kit.THREE`, `kit.merge(parts)` to fold `{ geometry, matrix, color }` parts into one vertex-colored geometry, `kit.color(swatchOrHex)` and `kit.matrix(...)`.
- `place(cell, kit)` is called for every cell in the streamed ring and returns where instances stand: `{ x, z, yaw, scale, sink, tint }`. The cell tells you its climate. Props never stand on the road or its verge.

Give `budget: { instances, triangles }` and, if the bike and the camera should keep clear of it, `obstacle: { radius, height }`. Add the prop's density to the biomes that should have it, under `props`.

## A flock

`library/birds/<id>.js`, data only, over the bird kit in `src/birds.js`: an ellipsoid `body`, a `head`, `neck`, `beak`, `legs` and a `tail`, and wings of three hinged segments with painted primaries and a flight profile. The only kind shipped is the cattle egret, a loose line of which crosses the fields beside the road now and then.

## A paint

`library/paints/<id>.js`: an `id`, a `name`, and two colors, `body` (tank, tail, fenders, helmet) and `trim` (stripes, rims), both inside the envelope. The corner control lists the registry's paints in order and the first is the bike a new visitor rides. The tile is drawn from the same two colors.

## The bike

`src/bike.js` is the bike kit, drawn after the GNEGR logo: lofted tank, tail and helmet, swept frame and limbs, wheels with painted rims. It describes the bike as a tree of hinged nodes (swingarm, fork, wheels, rider, head, arms); `animateBike` spins the wheels, works the suspension, steers the bars, leans the rider and reaches each arm to its grip. The whole bike and rider stay under `BIKE.triangles`, which the engine measures on the first build of each paint.

## Checking changes

Serve the repository, then run the browser checks in a fresh tab. With the Chrome DevTools AXI CLI:

```bash
export CHROME_DEVTOOLS_AXI_SESSION=the-long-ride-checks
npx -y chrome-devtools-axi open "http://localhost:8000/index.html?seed=42&check=$(date +%s)"
npx -y chrome-devtools-axi eval "$(<tests/ride-checks.js)"
```

Serve with a server that sends `Cache-Control: no-store`, or restart the browser between edits: module imports are cached across reloads and an old file will otherwise keep running.

Repeat with `webgl=1` and with seeds `0` and `4294967295`, then once on the bundle at `http://localhost:8000/dist/index.html?seed=42`, which is what Pages serves. The script clears the page's memory and checks, each in a fresh frame of the same address: the veil, the gate and Begin; the page free of the original author's links and names; the library validating; the four landscapes meeting along a 200 km sweep of the CPU world; the road continuous, rideable and carved into the terrain; six simulated minutes of auto-ride staying on the asphalt, never sinking into the ground and never turning back; a right-drag steering the bike and the bike rejoining the road; the camera and paint controls; and what is remembered (paint, place, a URL seed beating the remembered world). It does not check the sky, the water or the night: those looks are verified by eye only, against their records at the same seed and vantage. `node tests/galaxy-checks.mjs` checks the Milky Way's generated light. The visibility handler and native background suspension remain manual browser checks.

## Measuring what a change costs

`?profile=1` arms the renderer's timestamp queries and a smoothed summary in `window.__ride.perf`. `tools/bench.js`, `tools/parity.js` and `tools/capture-launch-media.mjs` came with the engine and read `window.__ride`; the bench and parity tools hold the bike still on five stations (`dawn`, `noon`, `far`, `wide` at the far camera framing, and `night`), pinning its place, course and way along the road and the camera framing. `docs/perf-notes.md` records what the engine's frame costs and what was found; its numbers were measured with the original engine's bird vantages, and its snow and mountain sections describe the original engine's terrain, not this one.

## Publishing

`.github/workflows/pages.yml` runs the bundler and publishes `dist/` to GitHub Pages on every push to `main`, or by hand from the Actions tab. One-time setup: **Settings > Pages > Build and deployment > Source: GitHub Actions**. Every path in the page is relative, so it works from a project subpath such as `https://<user>.github.io/the-long-ride/`, and the share link carries whatever address it is served from. Pages serves over HTTPS, which enables WebGPU.

## Before you open a pull request

Run the browser checks on both backends and the three seeds, and once on the bundle. Then ride it: a contribution is judged by eye at seed 42, at noon and at dusk, in the chase and the side camera.
