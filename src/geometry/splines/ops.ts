import type { Vec3 } from "@/types/core";
import type { SplineData, SplinePointDTO } from "@/types/geometry/spline";

/**
 * Tangent adjustment operations for spline points. Each takes the current
 * data and the selected point indices and returns NEW data (deep-copied) —
 * callers wrap the result in a SetNodeDataCommand for one undo step.
 */

const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v: Vec3): Vec3 => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

function clone(data: SplineData): SplineData {
  return {
    closed: data.closed,
    points: data.points.map((p) => ({
      position: [...p.position] as Vec3,
      inHandle: [...p.inHandle] as Vec3,
      outHandle: [...p.outHandle] as Vec3,
      mode: p.mode,
    })),
  };
}

function apply(
  data: SplineData,
  sel: readonly number[],
  fn: (p: SplinePointDTO, i: number, pts: SplinePointDTO[]) => void,
): SplineData {
  const next = clone(data);
  for (const i of sel) {
    const p = next.points[i];
    if (p) fn(p, i, next.points);
  }
  return next;
}

/** Linear: zero both handles — straight segments in and out. */
export function toLinear(data: SplineData, sel: readonly number[]): SplineData {
  return apply(data, sel, (p) => {
    p.inHandle = [0, 0, 0];
    p.outHandle = [0, 0, 0];
    p.mode = "linear";
  });
}

/**
 * Curve: auto-smooth (Catmull-Rom style) — tangent direction along
 * next−prev, handle length a third of the distance to each neighbour.
 * Endpoints of an open spline aim at their single neighbour.
 */
export function toCurve(data: SplineData, sel: readonly number[]): SplineData {
  return apply(data, sel, (p, i, pts) => {
    const n = pts.length;
    const prev = data.closed ? pts[(i - 1 + n) % n] : pts[i - 1];
    const next = data.closed ? pts[(i + 1) % n] : pts[i + 1];
    const dir = norm(
      sub((next ?? p).position, (prev ?? p).position), // endpoint: aim at the neighbour
    );
    const dPrev = prev ? len(sub(prev.position, p.position)) / 3 : 0;
    const dNext = next ? len(sub(next.position, p.position)) / 3 : 0;
    p.inHandle = scale(dir, -(dPrev || dNext));
    p.outHandle = scale(dir, dNext || dPrev);
    p.mode = "smooth";
  });
}

/** Break angle: handles keep their vectors but stop being linked. */
export function breakAngle(data: SplineData, sel: readonly number[]): SplineData {
  return apply(data, sel, (p) => {
    p.mode = "broken";
  });
}

/**
 * Equalize angle: make in/out collinear again (average their directions,
 * keep each handle's length) and re-link as smooth.
 */
export function equalAngle(data: SplineData, sel: readonly number[]): SplineData {
  return apply(data, sel, (p) => {
    const li = len(p.inHandle);
    const lo = len(p.outHandle);
    if (li < 1e-9 && lo < 1e-9) {
      p.mode = "smooth";
      return;
    }
    // average of the two tangent directions (out as-is, in negated)
    const dir = norm([
      p.outHandle[0] - p.inHandle[0],
      p.outHandle[1] - p.inHandle[1],
      p.outHandle[2] - p.inHandle[2],
    ]);
    p.outHandle = scale(dir, lo || li);
    p.inHandle = scale(dir, -(li || lo));
    p.mode = "smooth";
  });
}

/** Equalize length: both handles take the average of their lengths. */
export function equalLength(data: SplineData, sel: readonly number[]): SplineData {
  return apply(data, sel, (p) => {
    const li = len(p.inHandle);
    const lo = len(p.outHandle);
    const avg = (li + lo) / 2;
    if (avg < 1e-9) return;
    if (li > 1e-9) p.inHandle = scale(norm(p.inHandle), avg);
    if (lo > 1e-9) p.outHandle = scale(norm(p.outHandle), avg);
  });
}

/**
 * 0° Y: flatten the handles' local-Y so tangents run horizontal in the
 * drawing plane — profile-curve staple (flat top/bottom of a vase).
 */
export function zeroYAngle(data: SplineData, sel: readonly number[]): SplineData {
  return apply(data, sel, (p) => {
    p.inHandle = [p.inHandle[0], 0, p.inHandle[2]];
    p.outHandle = [p.outHandle[0], 0, p.outHandle[2]];
  });
}

/** Delete the selected points (spline survives with ≥2 left, else caller decides). */
export function deletePoints(data: SplineData, sel: readonly number[]): SplineData {
  const drop = new Set(sel);
  const next = clone(data);
  next.points = next.points.filter((_, i) => !drop.has(i));
  return next;
}

/** Toggle open/closed. */
export function setClosed(data: SplineData, closed: boolean): SplineData {
  const next = clone(data);
  next.closed = closed;
  return next;
}
