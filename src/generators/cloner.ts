import type { Vec3 } from "@/types/core";

/**
 * Instancer (F2) — the pure ops half. Produces the per-instance transform
 * matrices for an InstancedMesh; the render layer turns these into an actual
 * mesh. Ops rule: no Three, no DOM, no scene objects — it emits a flat,
 * column-major `Float32Array` (16·N) that drops straight onto
 * `instanceMatrix.array`.
 *
 * There is a single distribution: **object** — a clone is placed at each of a
 * target object's points (mesh vertices / polygon centers / edge centers, or a
 * spline's points / an even count along it). The graph layer samples the target
 * and hands this module the resulting {@link Instance}s (base position + base
 * orientation frame); {@link clonerInstanceMatrices} applies the random effector
 * (position/rotation/scale jitter keyed on `(seed, index)`, so an instance never
 * moves when the count changes and the same seed reproduces the scatter) and
 * bakes the matrices. The serialized descriptor key stays `type: "cloner"` for
 * backward compatibility even though the UI calls it an Instancer.
 */

/** Target-kind-dependent distribution. mesh: points/faces/edges · spline: points/count. */
export type ClonerDistribution = "points" | "faces" | "edges" | "count";
/** How each clone is oriented: to the surface normal/tangent, or a fixed axis. */
export type ClonerOrientation = "normal" | "direction";
/** The six signed world axes, for `direction` orientation. */
export type UpVector = "x+" | "x-" | "y+" | "y-" | "z+" | "z-";

export interface ClonerParams {
  /** Distribution across the target. Panel shows the subset valid for its kind. */
  distribution: ClonerDistribution;
  /** Spline **count** mode: number of clones spread evenly along the curve (≥ 2). */
  count: number;
  /** `normal` aligns +Y to the surface normal / curve tangent; `direction` to `upVector`. */
  orientation: ClonerOrientation;
  /** Fixed world axis for `direction` orientation. */
  upVector: UpVector;
  /** Keep the target surface/curve rendered (default) or hide it like the template. */
  hideTarget: boolean;
  // ---- instance transform (applied identically to EVERY clone, in the clone's
  //      local frame, before the step transform) ----
  /** Position offset applied to every clone along its local axes. */
  instancePosition: Vec3;
  /** Rotation applied to every clone (Euler XYZ radians). */
  instanceRotation: Vec3;
  /** Per-axis scale applied to every clone (1 = no change). */
  instanceScale: Vec3;
  // ---- step transform (per-clone, accumulated by clone index, in the clone's
  //      local frame; clone 0 is unchanged) ----
  /** Position offset added per step (clone i moves by i·step along its local axes). */
  stepPosition: Vec3;
  /** Rotation added per step (clone i turns by i·step, Euler XYZ radians). */
  stepRotation: Vec3;
  /** Scale MULTIPLIED per step (clone i scales by step^i; 1 = no change). */
  stepScale: Vec3;
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
  distribution: "points",
  count: 10,
  orientation: "normal",
  upVector: "y+",
  hideTarget: true,
  instancePosition: [0, 0, 0],
  instanceRotation: [0, 0, 0],
  instanceScale: [1, 1, 1],
  stepPosition: [0, 0, 0],
  stepRotation: [0, 0, 0],
  stepScale: [1, 1, 1],
  seed: 1,
  positionJitter: [0, 0, 0],
  rotationJitter: [0, 0, 0],
  scaleJitter: 0,
});

/**
 * One placed clone before the effector: base position + a base orientation
 * frame (column-major 3×3 rotation). The graph sampler builds the frame from
 * the target's surface normal / curve tangent (or a fixed axis).
 */
export interface Instance {
  position: Vec3;
  /** Column-major 3×3 rotation (9 floats). */
  basis: number[];
}

/** Fill any missing field from the defaults — a doc serialized before the
 * object-distribution rework (linear/radial/grid params) degrades gracefully. */
export function normClonerParams(p: ClonerParams): ClonerParams {
  const d = defaultClonerParams();
  return {
    distribution: p.distribution ?? d.distribution,
    count: p.count ?? d.count,
    orientation: p.orientation ?? d.orientation,
    upVector: p.upVector ?? d.upVector,
    hideTarget: p.hideTarget ?? d.hideTarget,
    instancePosition: p.instancePosition ?? d.instancePosition,
    instanceRotation: p.instanceRotation ?? d.instanceRotation,
    instanceScale: p.instanceScale ?? d.instanceScale,
    stepPosition: p.stepPosition ?? d.stepPosition,
    stepRotation: p.stepRotation ?? d.stepRotation,
    stepScale: p.stepScale ?? d.stepScale,
    seed: p.seed ?? d.seed,
    positionJitter: p.positionJitter ?? d.positionJitter,
    rotationJitter: p.rotationJitter ?? d.rotationJitter,
    scaleJitter: p.scaleJitter ?? d.scaleJitter,
  };
}

/** The world axis (unit vector) named by an {@link UpVector}. */
export function upVectorAxis(up: UpVector): Vec3 {
  switch (up) {
    case "x+":
      return [1, 0, 0];
    case "x-":
      return [-1, 0, 0];
    case "y+":
      return [0, 1, 0];
    case "y-":
      return [0, -1, 0];
    case "z+":
      return [0, 0, 1];
    case "z-":
      return [0, 0, -1];
  }
}

/**
 * A column-major 3×3 orthonormal basis whose local +Y axis points along `up`
 * (a unit vector). Roll is resolved deterministically from the world axis least
 * aligned with `up`, so the frame is stable and antiparallel `up` is handled.
 * This is the frame a clone wears so it "stands on" a surface normal / tangent.
 */
export function basisFromUp(up: Vec3): number[] {
  const y = normalizeV(up);
  // world +Z is the roll reference unless it's (near) parallel to y, then +X.
  // Chosen so up = +Y yields the identity basis (clones match their template).
  const ref: Vec3 = Math.abs(y[2]) < 0.999999 ? [0, 0, 1] : [1, 0, 0];
  const x = normalizeV(crossV(y, ref));
  const z = crossV(x, y); // already unit (x ⟂ y, both unit)
  // columns are the local X, Y, Z axes expressed in world space
  return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
}

const TWO = 2;

function normalizeV(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function crossV(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// Reused scratch 3×3 matrices (column-major) so the 100k loop never allocates.
const _rj = new Float64Array(9);
const _r = new Float64Array(9);
const _ri = new Float64Array(9); // instance rotation (same for every clone)
const _step = new Float64Array(9); // per-clone step rotation
const _is = new Float64Array(9); // instance · step rotation
const _rb = new Float64Array(9); // base basis · instance · step rotation

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
function mat3mul(out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>): void {
  for (let col = 0; col < 3; col++) {
    const b0 = b[col * 3]!;
    const b1 = b[col * 3 + 1]!;
    const b2 = b[col * 3 + 2]!;
    for (let row = 0; row < 3; row++) {
      out[col * 3 + row] = a[row]! * b0 + a[3 + row]! * b1 + a[6 + row]! * b2;
    }
  }
}

/** Bake a column-major 3×3 rotation (per-axis scaled) + translation into `out` at
 * `o`. Column 0/1/2 (the local X/Y/Z axes) scale by sx/sy/sz. */
function composeInto(
  out: Float32Array,
  o: number,
  px: number,
  py: number,
  pz: number,
  r: Float64Array,
  sx: number,
  sy: number,
  sz: number,
): void {
  out[o] = r[0]! * sx;
  out[o + 1] = r[1]! * sx;
  out[o + 2] = r[2]! * sx;
  out[o + 3] = 0;
  out[o + 4] = r[3]! * sy;
  out[o + 5] = r[4]! * sy;
  out[o + 6] = r[5]! * sy;
  out[o + 7] = 0;
  out[o + 8] = r[6]! * sz;
  out[o + 9] = r[7]! * sz;
  out[o + 10] = r[8]! * sz;
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
 * Bake base {@link Instance}s into a flat column-major `Float32Array` (16·N),
 * applying the **instance transform**, then the per-clone **step transform**,
 * then the **random effector**.
 *
 * Instance transform (uniform): EVERY clone is offset/turned/scaled identically
 * in its own local frame — it comes before the step, so clone `i`'s step offset
 * lands in the instance-rotated frame. Step transform (index-based): clone `i`
 * is offset by `i·stepPosition`, turned by `i·stepRotation`, and scaled by
 * `stepScale^i` — a spiral/taper builder. The effector jitter for instance `i`
 * is a pure function of `(seed, i)` (index hashed IN, so adjacent clones aren't
 * correlated and `i` is stable as the count grows) and composes ONTO the
 * transformed frame. All three perturb each clone in its own local frame.
 * Non-uniform instance scale under a step rotation is approximated per-axis in
 * the clone frame (no shear — TRS matrices can't hold it anyway).
 */
export function clonerInstanceMatrices(instances: Instance[], params: ClonerParams): Float32Array {
  const p = normClonerParams(params);
  const n = instances.length;
  const out = new Float32Array(n * 16);
  const [jpx, jpy, jpz] = p.positionJitter;
  const [jrx, jry, jrz] = p.rotationJitter;
  const [ipx, ipy, ipz] = p.instancePosition;
  const [irx, iry, irz] = p.instanceRotation;
  const [isx, isy, isz] = p.instanceScale;
  const [spx, spy, spz] = p.stepPosition;
  const [srx, sry, srz] = p.stepRotation;
  const [ssx, ssy, ssz] = p.stepScale;
  eulerMat3(_ri, irx, iry, irz); // shared by every clone
  for (let i = 0; i < n; i++) {
    const rng = mulberry32((p.seed ^ Math.imul(i, 0x9e3779b1)) >>> 0);
    const inst = instances[i]!;
    const B = inst.basis;
    // rotation = B · instanceRot · stepRot(i)  (instance innermost ⇒ first)
    eulerMat3(_step, i * srx, i * sry, i * srz);
    mat3mul(_is, _ri, _step);
    mat3mul(_rb, B, _is);
    // local offset = instancePosition + instanceRot · (i·stepPosition) — the
    // step offset lands in the instance-rotated frame; then into world via B
    const ox = i * spx;
    const oy = i * spy;
    const oz = i * spz;
    const lx = ipx + _ri[0]! * ox + _ri[3]! * oy + _ri[6]! * oz;
    const ly = ipy + _ri[1]! * ox + _ri[4]! * oy + _ri[7]! * oz;
    const lz = ipz + _ri[2]! * ox + _ri[5]! * oy + _ri[8]! * oz;
    const sox = B[0]! * lx + B[3]! * ly + B[6]! * lz;
    const soy = B[1]! * lx + B[4]! * ly + B[7]! * lz;
    const soz = B[2]! * lx + B[5]! * ly + B[8]! * lz;
    // random effector: position + rotation jitter, then a uniform scale jitter
    const px = inst.position[0] + sox + (rng() * TWO - 1) * jpx;
    const py = inst.position[1] + soy + (rng() * TWO - 1) * jpy;
    const pz = inst.position[2] + soz + (rng() * TWO - 1) * jpz;
    eulerMat3(_rj, (rng() * TWO - 1) * jrx, (rng() * TWO - 1) * jry, (rng() * TWO - 1) * jrz);
    mat3mul(_r, _rb, _rj);
    const js = 1 + (rng() * TWO - 1) * p.scaleJitter;
    // per-axis scale = instance · step^i · uniform jitter (step^0 = 1)
    composeInto(
      out,
      i * 16,
      px,
      py,
      pz,
      _r,
      isx * Math.pow(ssx, i) * js,
      isy * Math.pow(ssy, i) * js,
      isz * Math.pow(ssz, i) * js,
    );
  }
  return out;
}
