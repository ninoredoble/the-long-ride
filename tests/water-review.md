# Water review and validation

The captain compared three actual-flight studies in Lavish: sky ripples, depth-led jade coves, and sunlit swell. Jade coves was selected, then revised toward a quieter painterly surface with clearer turquoise depth, elongated ripples and soft light strokes. The captain approved that revision and requested removal of the discarded prototypes. Only the approved material remains in `src/water.js`; there is no production look switch. The local review images are not shipped assets.

## Executable checks

Run `tests/flight-checks.js` as described in `CONTRIBUTING.md`. Its water checks find a coast from each seed's real heightfield, render the water in isolation with normal scene lighting, and assert depth color, motion, pause, world-space continuity, night response and the vertex budget. After rebasing onto the updated opening/night-clock engine, all 183 checks passed for seeds 42, 0 and 4294967295 on source and bundle, on WebGPU and WebGL2 (12 runs).

The initial re-centering test accidentally assigned `undefined` to non-light objects' visibility. Three.js hides only explicit `false`, so moving companions and ground shadows polluted the image comparison. An amplified pixel difference located the error in those objects, not the water. Explicit boolean visibility reduced the seed-0 mean linear RGB delta from 0.001384 to 1.61e-10. The final tolerance is 0.00005, tighter than the failed test. The engine translates its grid by whole cells; it does not rebase world coordinates. Vertex waves use local coordinates plus that translation, and fragment patterns use world coordinates, keeping them continuous.

## Performance evidence

Desktop Chrome, 1280 x 800, seed 42, identical paused sunrise bay view, simulation time 40 s, measured before the independent opening/night-clock rebase. Compared the original water and approved revision in the same renderer, rendering continuously through `setAnimationLoop`. Three paired trials per backend, each with 31 warm-up frames and 60 samples, using renderer GPU timestamps rather than CPU submission time or RAF intervals.

Median of the three trial medians, milliseconds:

| Backend | Original | Approved jade |
| --- | ---: | ---: |
| WebGPU | 22.61 | 17.69 |
| WebGL2 | 22.66 | 20.53 |

Median trial p90: WebGPU 23.86 to 17.89 ms; WebGL2 26.01 to 24.65 ms. Individual trials varied substantially, so these are local comparative observations, not a portable speedup or frame-rate guarantee. Both variants drew exactly 52 scene draw calls and 927,373 scene triangles at this view. The water remains one opaque draw, 17,689 vertices, with no new textures or offscreen passes. The rough reflection avoids evaluating the complete star/cloud/moon sky shader again on every water fragment. Physical-phone performance remains a device check.
