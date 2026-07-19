import type { Vec3 } from "@/types/core";
import type { SplineData, SplinePointDTO } from "@/types/geometry/spline";

/**
 * Cubic-bezier evaluation over SplineData. Pure math — no Three, no DOM —
 * shared by the render polyline, the pen tool preview, and generators.
 */

/** Bezier control points of span i (from point i to point i+1, wrapping when closed). */
export function spanControls(a: SplinePointDTO, b: SplinePointDTO): [Vec3, Vec3, Vec3, Vec3] {
  const p0 = a.position;
  const p3 = b.position;
  const p1: Vec3 = [p0[0] + a.outHandle[0], p0[1] + a.outHandle[1], p0[2] + a.outHandle[2]];
  const p2: Vec3 = [p3[0] + b.inHandle[0], p3[1] + b.inHandle[1], p3[2] + b.inHandle[2]];
  return [p0, p1, p2, p3];
}

/** Number of spans (segments between anchors) in the spline. */
export function spanCount(data: SplineData): number {
  const n = data.points.length;
  if (n < 2) return 0;
  return data.closed ? n : n - 1;
}

function evalCubic(c: [Vec3, Vec3, Vec3, Vec3], t: number, out: number[], o: number): void {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  out[o] = w0 * c[0][0] + w1 * c[1][0] + w2 * c[2][0] + w3 * c[3][0];
  out[o + 1] = w0 * c[0][1] + w1 * c[1][1] + w2 * c[2][1] + w3 * c[3][1];
  out[o + 2] = w0 * c[0][2] + w1 * c[1][2] + w2 * c[2][2] + w3 * c[3][2];
}

/** True when a span is a straight line (both facing handles zero). */
function spanLinear(a: SplinePointDTO, b: SplinePointDTO): boolean {
  const z = (v: Vec3) => v[0] === 0 && v[1] === 0 && v[2] === 0;
  return z(a.outHandle) && z(b.inHandle);
}

/**
 * A point on span (a → b) at parameter t. Matches the rendered/insert
 * parameterization: a straight (linear) span interpolates its endpoints,
 * a curved span evaluates the cubic — so a t picked here feeds `insertPoint`
 * back to the same location. Used for curve hit-testing (Option-click insert).
 */
export function pointOnSpan(a: SplinePointDTO, b: SplinePointDTO, t: number): Vec3 {
  if (spanLinear(a, b)) {
    const p = a.position;
    const q = b.position;
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  }
  const c = spanControls(a, b);
  const out = [0, 0, 0];
  evalCubic(c, t, out, 0);
  return [out[0]!, out[1]!, out[2]!];
}

/**
 * Sample the whole spline into a flat xyz polyline (local space). Curved
 * spans get `perSpan` segments, straight spans a single segment, so linear
 * points render crisp corners at no cost. Includes the final point; a
 * closed spline's polyline ends back at the start.
 */
export function sampleSpline(data: SplineData, perSpan = 24): Float32Array {
  const spans = spanCount(data);
  const pts = data.points;
  if (spans === 0) {
    const out = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => out.set(p.position, i * 3));
    return out;
  }
  const chunks: number[] = [...pts[0]!.position];
  for (let s = 0; s < spans; s++) {
    const a = pts[s]!;
    const b = pts[(s + 1) % pts.length]!;
    if (spanLinear(a, b)) {
      chunks.push(...b.position);
      continue;
    }
    const c = spanControls(a, b);
    const tmp = [0, 0, 0];
    for (let k = 1; k <= perSpan; k++) {
      evalCubic(c, k / perSpan, tmp, 0);
      chunks.push(tmp[0]!, tmp[1]!, tmp[2]!);
    }
  }
  return new Float32Array(chunks);
}

/**
 * Sample as 2D points in the local drawing plane (x, y — z dropped), for
 * profile consumers like the extrude generator. Closed splines omit the
 * duplicate final point.
 */
export function sampleSpline2D(data: SplineData, perSpan = 24): { x: number; y: number }[] {
  const flat = sampleSpline(data, perSpan);
  let n = flat.length / 3;
  if (data.closed && n > 1) n -= 1; // drop the wrap-around duplicate
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) out.push({ x: flat[i * 3]!, y: flat[i * 3 + 1]! });
  return out;
}

/**
 * Sample into 3D local points for consumers that need the real (possibly
 * non-planar) curve — the extrude's best-fit profile and the sweep's path.
 * Closed splines omit the duplicate final point.
 */
export function sampleSpline3D(data: SplineData, perSpan = 24): Vec3[] {
  const flat = sampleSpline(data, perSpan);
  let n = flat.length / 3;
  if (data.closed && n > 1) n -= 1; // drop the wrap-around duplicate
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) out.push([flat[i * 3]!, flat[i * 3 + 1]!, flat[i * 3 + 2]!]);
  return out;
}

/**
 * Selection stamp for spline point selections: point indices stay valid as
 * long as no point is added or removed, so the count doubles as the
 * "topology version" (all structural spline commands change it).
 */
export function splineStamp(data: SplineData): number {
  return data.points.length;
}
