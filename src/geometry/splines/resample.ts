import type { Vec3 } from "@/types/core";
import type { P2 } from "./planeFrame";

/**
 * Arc-length resampling and tangent estimation over polylines — shared by the
 * sweep generator (path stations) and the instancer (even scatter along a
 * spline). Pure math: no Three, no DOM.
 */

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Even arc-length resample of a polyline to `count` points. A closed polyline
 * spreads `count` points over `[0, total)` (no duplicate at the wrap), an open
 * one over `[0, total]` (a point at each end). Generic over 3D points and
 * plane points so both the sweep path and 2D consumers can share it.
 */
export function resample<T extends Vec3 | P2>(
  pts: T[],
  count: number,
  closed: boolean,
  lerp: (a: T, b: T, t: number) => T,
): T[] {
  const loop = closed ? [...pts, pts[0]!] : pts;
  const dist = (a: T, b: T): number =>
    Array.isArray(a)
      ? Math.hypot(a[0] - (b as Vec3)[0], a[1] - (b as Vec3)[1], a[2] - (b as Vec3)[2])
      : Math.hypot((a as P2).x - (b as P2).x, (a as P2).y - (b as P2).y);
  const cum: number[] = [0];
  for (let i = 1; i < loop.length; i++) cum.push(cum[i - 1]! + dist(loop[i - 1]!, loop[i]!));
  const total = cum[cum.length - 1]!;
  const out: T[] = [];
  // closed → `count` points over [0,total); open → `count` points over [0,total]
  const denom = closed ? count : count - 1;
  for (let k = 0; k < count; k++) {
    const target = total <= 1e-12 ? 0 : (k / denom) * total;
    let s = 1;
    while (s < cum.length - 1 && cum[s]! < target) s++;
    const segLen = cum[s]! - cum[s - 1]!;
    const t = segLen <= 1e-12 ? 0 : (target - cum[s - 1]!) / segLen;
    out.push(lerp(loop[s - 1]!, loop[s]!, t));
  }
  return out;
}

/** Unit tangents by central difference (wrapping when the path is closed). */
export function computeTangents(pts: Vec3[], closed: boolean): Vec3[] {
  const n = pts.length;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    let a: Vec3;
    let b: Vec3;
    if (closed) {
      a = pts[(i - 1 + n) % n]!;
      b = pts[(i + 1) % n]!;
    } else {
      a = pts[Math.max(0, i - 1)]!;
      b = pts[Math.min(n - 1, i + 1)]!;
    }
    out.push(normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
  }
  return out;
}
