import type { Vec3 } from "@/types/core";

/**
 * Cloner (F2) — the pure ops half. Produces the per-instance transform matrices
 * for an InstancedMesh; the render layer turns these into an actual mesh. Ops
 * rule: no Three, no DOM, no scene objects — it emits a flat, column-major
 * `Float32Array` (16·N) that drops straight onto `instanceMatrix.array`.
 *
 * Distributions: **linear** (a stepped row), **radial** (a ring, each clone
 * fanned to face around it), **grid** (a 3D lattice), plus **object** — placing
 * a clone at each of another object's points, driven by the render/graph layer
 * (which samples the target geometry and calls {@link clonerInstanceMatrices}
 * with the resulting {@link Instance}s). The random effector then jitters each
 * clone's position/rotation/scale by a deterministic amount keyed on
 * `(seed, index)` — so an instance never moves when the count changes, and the
 * same seed always reproduces the scatter.
 */

export type ClonerMode = "linear" | "radial" | "grid" | "object";
export type Axis = "x" | "y" | "z";

export interface ClonerParams {
  mode: ClonerMode;
  /** Clone count (linear / radial). Grid uses the per-axis counts. */
  count: number;
  /** Linear: translation between successive clones (the set is centered on 0). */
  step: Vec3;
  /** Radial: ring radius. */
  radius: number;
  /** Radial: axis the ring lies perpendicular to (its spin axis). */
  radialAxis: Axis;
  /** Grid: per-axis counts (floored) and spacing. */
  gridCount: Vec3;
  gridSpacing: Vec3;
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
  radius: 3,
  radialAxis: "y",
  gridCount: [3, 3, 1],
  gridSpacing: [1.5, 1.5, 1.5],
  seed: 1,
  positionJitter: [0, 0, 0],
  rotationJitter: [0, 0, 0],
  scaleJitter: 0,
});

/** One placed clone before the effector: base position + base orientation (Euler). */
export interface Instance {
  position: Vec3;
  rotation: Vec3;
}

const TAU = Math.PI * 2;

/** How many instances a param set produces (grid multiplies its axes). */
export function clonerCount(p: ClonerParams): number {
  if (p.mode === "grid") {
    const [nx, ny, nz] = p.gridCount;
    return Math.max(0, Math.floor(nx)) * Math.max(0, Math.floor(ny)) * Math.max(0, Math.floor(nz));
  }
  return Math.max(0, Math.floor(p.count));
}

/**
 * The base placement of each clone (pre-effector) for the built-in distributions.
 * `object` mode returns none — its instances come from the graph layer, which
 * samples the target and calls {@link clonerInstanceMatrices} directly. Every
 * layout is centered on the cloner's origin so growth expands symmetrically.
 */
function layoutInstances(p: ClonerParams): Instance[] {
  const out: Instance[] = [];
  if (p.mode === "grid") {
    const nx = Math.max(0, Math.floor(p.gridCount[0]));
    const ny = Math.max(0, Math.floor(p.gridCount[1]));
    const nz = Math.max(0, Math.floor(p.gridCount[2]));
    const [dx, dy, dz] = p.gridSpacing;
    const mx = (nx - 1) / 2;
    const my = (ny - 1) / 2;
    const mz = (nz - 1) / 2;
    for (let iz = 0; iz < nz; iz++)
      for (let iy = 0; iy < ny; iy++)
        for (let ix = 0; ix < nx; ix++)
          out.push({
            position: [(ix - mx) * dx, (iy - my) * dy, (iz - mz) * dz],
            rotation: [0, 0, 0],
          });
    return out;
  }

  const n = Math.max(0, Math.floor(p.count));
  if (p.mode === "radial") {
    const r = p.radius;
    for (let i = 0; i < n; i++) {
      const a = (TAU * i) / Math.max(1, n);
      const c = Math.cos(a);
      const s = Math.sin(a);
      // ring in the plane perpendicular to radialAxis; base rotation spins each
      // clone by its angle about that axis so the set fans around the ring
      if (p.radialAxis === "y") out.push({ position: [r * s, 0, r * c], rotation: [0, a, 0] });
      else if (p.radialAxis === "x") out.push({ position: [0, r * c, r * s], rotation: [a, 0, 0] });
      else out.push({ position: [r * c, r * s, 0], rotation: [0, 0, a] });
    }
    return out;
  }

  // linear (default)
  const [sx, sy, sz] = p.step;
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const t = i - mid;
    out.push({ position: [sx * t, sy * t, sz * t], rotation: [0, 0, 0] });
  }
  return out;
}

// Reused scratch 3×3 matrices (column-major) so the 100k loop never allocates.
const _rb = new Float64Array(9);
const _rj = new Float64Array(9);
const _r = new Float64Array(9);

/** Column-major 3×3 rotation from Euler XYZ, written into `m` (matches three). */
function eulerMat3(m: Float64Array, x: number, y: number, z: number): void {
  const c1 = Math.cos(x);
  const s1 = Math.sin(x);
  const c2 = Math.cos(y);
  const s2 = Math.sin(y);
  const c3 = Math.cos(z);
  const s3 = Math.sin(z);
  m[0] = c2 * c3;
  m[1] = c1 * s3 + s1 * s2 * c3;
  m[2] = s1 * s3 - c1 * s2 * c3;
  m[3] = -c2 * s3;
  m[4] = c1 * c3 - s1 * s2 * s3;
  m[5] = s1 * c3 + c1 * s2 * s3;
  m[6] = s2;
  m[7] = -s1 * c2;
  m[8] = c1 * c2;
}

/** `out = a · b` for column-major 3×3 matrices (out must differ from a/b). */
function mat3mul(out: Float64Array, a: Float64Array, b: Float64Array): void {
  for (let col = 0; col < 3; col++) {
    const b0 = b[col * 3]!;
    const b1 = b[col * 3 + 1]!;
    const b2 = b[col * 3 + 2]!;
    for (let row = 0; row < 3; row++) {
      out[col * 3 + row] = a[row]! * b0 + a[3 + row]! * b1 + a[6 + row]! * b2;
    }
  }
}

/** Bake a column-major 3×3 rotation (uniformly scaled) + translation into `out` at `o`. */
function composeInto(
  out: Float32Array,
  o: number,
  px: number,
  py: number,
  pz: number,
  r: Float64Array,
  s: number,
): void {
  out[o] = r[0]! * s;
  out[o + 1] = r[1]! * s;
  out[o + 2] = r[2]! * s;
  out[o + 3] = 0;
  out[o + 4] = r[3]! * s;
  out[o + 5] = r[4]! * s;
  out[o + 6] = r[5]! * s;
  out[o + 7] = 0;
  out[o + 8] = r[6]! * s;
  out[o + 9] = r[7]! * s;
  out[o + 10] = r[8]! * s;
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
 * Apply the random effector to a set of base {@link Instance}s and bake the
 * result into a flat column-major `Float32Array` (16·N). The jitter for instance
 * `i` is a pure function of `(seed, i)` — the index is hashed INTO the seed so
 * adjacent clones aren't correlated and instance `i` is stable as the count
 * grows. Jitter rotation composes ONTO the base orientation (radial fan, or a
 * target's surface normal), so it perturbs each clone in its own frame.
 */
export function clonerInstanceMatrices(instances: Instance[], p: ClonerParams): Float32Array {
  const n = instances.length;
  const out = new Float32Array(n * 16);
  const [jpx, jpy, jpz] = p.positionJitter;
  const [jrx, jry, jrz] = p.rotationJitter;
  for (let i = 0; i < n; i++) {
    const rng = mulberry32((p.seed ^ Math.imul(i, 0x9e3779b1)) >>> 0);
    const inst = instances[i]!;
    const px = inst.position[0] + (rng() * 2 - 1) * jpx;
    const py = inst.position[1] + (rng() * 2 - 1) * jpy;
    const pz = inst.position[2] + (rng() * 2 - 1) * jpz;
    eulerMat3(_rb, inst.rotation[0], inst.rotation[1], inst.rotation[2]);
    eulerMat3(_rj, (rng() * 2 - 1) * jrx, (rng() * 2 - 1) * jry, (rng() * 2 - 1) * jrz);
    mat3mul(_r, _rb, _rj);
    const s = 1 + (rng() * 2 - 1) * p.scaleJitter;
    composeInto(out, i * 16, px, py, pz, _r, s);
  }
  return out;
}

/** Every clone's world matrix for a built-in distribution (linear/radial/grid). */
export function clonerMatrices(p: ClonerParams): Float32Array {
  return clonerInstanceMatrices(layoutInstances(p), p);
}
