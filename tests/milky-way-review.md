# Milky Way approval

Kun approved **A5 - Galactic shape** in the local Lavish review on 2026-09-08:

> Approve A5 - Galactic shape. Finalize this approach and remove discarded prototypes.

The review compared star-card geometry, a live noise-based rift, and a generated star atlas. Kun preferred the star points and supplied a photograph as the visual reference. Five iterations refined the color separation, branching dust, band width, bright star-cloud windows, asymmetric core and dark flank. The photograph was a reference only; it is not loaded or embedded in the page.

The production implementation is `src/milky-way.js` with the shared extinction/light generator in `src/galaxy-matter.js`. All alternative implementations and the URL look switch were removed. The approved sky is an artistic procedural interpretation, not a catalog-accurate astronomical survey.

## Validation

- Rebased onto the intro-polish and painterly-water changes on `main`.
- `node tests/galaxy-checks.mjs`: deterministic, bounded, periodic and finite extinction/light, with color and contrast.
- `tests/flight-checks.js`: 183 checks passed for source and bundle, seeds `42`, `0`, `4294967295`, on WebGPU and WebGL2.
- `tests/night-checks.js`: 24 checks passed in the same 12 combinations. They read rendered pixels with and without the star catalog and atlas, verify night detail and pause stability, reject daylight and cloud-crossing leakage, and check fixed allocations and disposal.
- No browser console errors in that matrix. Bundler freshness, JavaScript syntax, formatting of new files and diff whitespace checks passed.
- Final production sky pixels matched the approved A5 screenshot exactly in the unobstructed upper-sky comparison region. Checked the live page at emulated `390 × 844` and `844 × 390` mobile viewports without overflow.
- Fixed-view, 1440 × 900 WebGPU timing on the review machine: median whole-render GPU time across 20 warmed samples was about **29.6 ms**, versus **29.0 ms** for the previous sky. This is a local observation, not a frame-rate or physical-phone guarantee. One star draw is added at night; daylight and the opaque cloud deck skip it. Geometry, texture storage and per-frame work remain bounded.

The temporary reference images, review screenshots and detailed test output live in the gitignored `review-assets/` folder. Physical-phone performance and native background suspension still require device checks, as documented in `CONTRIBUTING.md`.
