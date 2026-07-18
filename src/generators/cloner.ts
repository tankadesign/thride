import type { Vec3 } from "@/types/core";

/**
 * Cloner (F2) — the pure ops half. Produces the per-instance transform matrices
 * for a {@link https://developer.mozilla.org/InstancedMesh}; the render layer
 * turns these into an actual `InstancedMesh`. This file follows the ops-layer
 * rule: no Three, no DOM, no scene objects — it emits a flat, column-major
 * `Float32Array` (16·N) that drops straight onto `instanceMatrix.array`.
 *
 * v1 ships the **linear** distribution; radial/grid are more layout functions
 * bolted onto the same pipe (see {@link layoutPositions}). The random effector
 * jitters each clone's position/rotation/scale by a deterministic amount keyed
 * on `(seed, instanceIndex)` — so an instance never moves when the count changes
 * (only new instances appear), and the same seed always reproduces the scatter.
 */

export type ClonerMode = "linear" | "radial" | "grid";

export interface ClonerParams {
  mode: ClonerMode;
  /** Clone count (linear/radial). Grid uses the per-axis counts below. */
  count: number;
  /** Linear: translation between successive clones (the set is centered on 0). */
  step: Vec3;
  // ---- random effector (all default to 0 = no jitter) ----
  /** Effector RNG seed — same seed, same scatter. */
  seed: number;
  /** Max ± position offset per axis. */
  positionJitter: Vec3;
  /** Max ± rotation per axis, Euler XYZ radians. */
  rotationJitter: Vec3;
  /** Max ± uniform scale deviation (0.2 = ±20%). */
  scaleJitter: number;
}

export const defaultClonerParams = (): ClonerParams => ({
  mode: "linear",
  count: 5,
  step: [1.5, 0, 0],
  seed: 1,
  positionJitter: [0, 0, 0],
  rotationJitter: [0, 0, 0],
  scaleJitter: 0,
});

/** How many instances a param set produces (grid multiplies its axes; here: count). */
export function clonerCount(p: ClonerParams): number {
  return Math.max(0, Math.floor(p.count));
}

/**
 * The undithered base position of each clone, before the effector. Linear grows
 * along `step`, centered on the cloner's origin so adding clones expands both
 * ways rather than drifting off in one direction (C4D's default feel).
 */
function layoutPositions(p: ClonerParams): Vec3[] {
  const n = clonerCount(p);
  const out: Vec3[] = [];
  // linear (the only v1 mode; radial/grid slot in here next)
  const [sx, sy, sz] = p.step;
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const t = i - mid;
    out.push([sx * t, sy * t, sz * t]);
  }
  return out;
}

/**
 * Column-major TRS (Euler XYZ) written directly into `out` at `o` — no Matrix4
 * allocation, so a 100k recompute on a count drag stays a tight numeric loop.
 * Layout matches three's `Matrix4.elements` (and `composeTRS`), so the result
 * copies straight onto an `instanceMatrix` buffer.
 */
function composeInto(
  out: Float32Array,
  o: number,
  px: number,
  py: number,
  pz: number,
  rx: number,
  ry: number,
  rz: number,
  s: number,
): void {
  const c1 = Math.cos(rx);
  const s1 = Math.sin(rx);
  const c2 = Math.cos(ry);
  const s2 = Math.sin(ry);
  const c3 = Math.cos(rz);
  const s3 = Math.sin(rz);
  // rotation (Euler XYZ), then uniform scale folds into each basis column
  out[o] = c2 * c3 * s;
  out[o + 1] = (c1 * s3 + s1 * s2 * c3) * s;
  out[o + 2] = (s1 * s3 - c1 * s2 * c3) * s;
  out[o + 3] = 0;
  out[o + 4] = -c2 * s3 * s;
  out[o + 5] = (c1 * c3 - s1 * s2 * s3) * s;
  out[o + 6] = (s1 * c3 + c1 * s2 * s3) * s;
  out[o + 7] = 0;
  out[o + 8] = s2 * s;
  out[o + 9] = -s1 * c2 * s;
  out[o + 10] = c1 * c2 * s;
  out[o + 11] = 0;
  out[o + 12] = px;
  out[o + 13] = py;
  out[o + 14] = pz;
  out[o + 15] = 1;
}

/** mulberry32 — small, fast, deterministic PRNG returning [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Every clone's world matrix as a flat column-major `Float32Array` (16·N).
 * Each instance's jitter is a pure function of `(seed, i)` — the index is hashed
 * INTO the seed (`seed ^ i·φ`), not added, so adjacent clones don't get
 * correlated draws and instance `i` is stable as the count grows.
 */
export function clonerMatrices(p: ClonerParams): Float32Array {
  const positions = layoutPositions(p);
  const n = positions.length;
  const out = new Float32Array(n * 16);
  const [jpx, jpy, jpz] = p.positionJitter;
  const [jrx, jry, jrz] = p.rotationJitter;
  for (let i = 0; i < n; i++) {
    const rng = mulberry32((p.seed ^ Math.imul(i, 0x9e3779b1)) >>> 0);
    const base = positions[i]!;
    const px = base[0] + (rng() * 2 - 1) * jpx;
    const py = base[1] + (rng() * 2 - 1) * jpy;
    const pz = base[2] + (rng() * 2 - 1) * jpz;
    const rx = (rng() * 2 - 1) * jrx;
    const ry = (rng() * 2 - 1) * jry;
    const rz = (rng() * 2 - 1) * jrz;
    const s = 1 + (rng() * 2 - 1) * p.scaleJitter;
    composeInto(out, i * 16, px, py, pz, rx, ry, rz, s);
  }
  return out;
}
