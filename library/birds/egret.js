// The cattle egret: a small white heron that follows the farms, neck folded
// short in flight, yellow bill, dark legs trailing. Slow, deep beats; a loose
// line of them crosses the fields now and then.
import { defineBird } from '../contract.js';

export default defineBird({
  id: 'egret',
  name: 'egret',
  colors: { body: 0xeeeee6, wing: 0xe9e9e0, hand: 0xe2e2d8, tip: 0xdcdcd0, neck: 0xeeeee6, cap: 0xe8d6a8, beak: 0xcfa851, legs: 0x3a3532 },
  scale: 0.55,
  body: { r: 0.42, at: [0, 0, 0], scale: [1.0, 0.9, 2.0] },
  neck: { from: [0, 0.18, 0.75], to: [0, 0.42, 1.55], r0: 0.18, r1: 0.12, arch: 0.22, color: 'neck' },
  head: { r: 0.17, at: [0, 0.45, 1.66], scale: [0.9, 0.9, 1.3], color: 'neck' },
  beak: { r: 0.05, len: 0.5, at: [0, 0.4, 2.0], sides: 5, tilt: 0.08 },
  marks: [{ r: 0.16, at: [0, 0.5, 1.6], scale: [0.85, 0.7, 1.1], color: 'cap' }],
  legs: { from: [0.1, -0.22, -0.55], to: [0.12, -0.34, -1.85], r: 0.035, foot: [0.05, 0.03, 0.14], color: 'legs' },
  below: 0.4,
  tail: [{ count: 5, x: 0.12, z: -1.05, w: 0.13, len: 0.34, yaw: 0.08, droop: 0.02, color: 'wing' }],
  wings: {
    root: [0.35, 0.14, 0.1],
    colors: ['wing', 'wing', 'wing'],
    segments: [
      { len: 1.2, lead: 0.75, leadTip: 0.72, trail: -0.65, trailTip: -0.65 },
      {
        len: 1.2,
        lead: 0.72,
        leadTip: 0.58,
        trail: -0.65,
        trailTip: -0.65,
        primaries: { count: 5, x0: 0.14, dx: 0.22, z: -0.55, w: 0.16, len: 0.4, dlen: -0.02, yaw: -0.15, dyaw: -0.04, color: 'wing' },
      },
      {
        len: 1.1,
        lead: 0.58,
        leadTip: 0.1,
        trail: -0.65,
        trailTip: -0.45,
        tip: 'round',
        round: 0.25,
        primaries: { count: 4, x0: 0.12, dx: 0.24, z: -0.5, w: 0.16, len: 0.42, dlen: -0.03, yaw: -0.28, dyaw: -0.08, color: 'hand' },
      },
    ],
  },
  flight: { amp: 0.55, glideAmp: 0.08, rate: 4.2, glideRate: 0.9, ease: 2.5, rest: [0.1, -0.06, -0.02], seg: [1.0, 0.6, 0.5], lag: [0, 0.8, 1.5], warp: 0.2, bob: 0.05 },
  flock: { scale: 1, spread: 1.4 },
});
