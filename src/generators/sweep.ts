import type { Vec3 } from "@/types/core";
import { HEMesh } from "@/geometry/kernel/HEMesh";
import { bestFitFrame, type P2, projectToFrame } from "@/geometry/splines/planeFrame";

export interface SweepParams {
  /** Even stations resampled along the path (only when `usePathPoints` is off). */
  pathSegments: number;
  /** Cross-section rotation around the path tangent, in degrees (default 0). */
  rotation?: number;
  /** Place a ring at each path point (orientation follows the path's own
   * geometry) instead of resampling to `pathSegments` even stations. Default on;
   * absent on sweeps saved before this existed → treated as on. */
  usePathPoints?: boolean;
}

export const defaultSweepParams = (): SweepParams => ({
  pathSegments: 48,
  rotation: 0,
  usePathPoints: true,
});

/** A sampled curve in a common space (handles already resolved to a polyline). */
export interface SweepCurve {
  points: Vec3[];
  closed: boolean;
}

/**
 * C4D-style sweep: a profile curve transported along a path curve, both given
 * as polylines in a common space (the graph bakes each child's transform). The
 * profile is flattened to its own plane, then placed into a rotation-minimizing
 * frame (double-reflection RMF — no Frenet flips at inflection points) at each
 * path station, so the tube never twists or pinches. Ring stations are the
 * path's own points (`usePathPoints`, default) or an even resample to
 * `pathSegments`; `rotation` spins the whole cross-section about the path. The
 * profile's own points define the ring verbatim (no interpolation). A closed
 * profile on an open path gets end caps. Returns null on a degenerate input.
 */
export function buildSweep(
  profile: SweepCurve,
  path: SweepCurve,
  params: SweepParams,
): HEMesh | null {
  if (path.points.length < 2 || profile.points.length < (profile.closed ? 3 : 2)) return null;

  const nP = Math.max(2, Math.round(params.pathSegments));

  // ring stations: the path's own points (orientation follows the path
  // geometry — the default) or an even arc-length resample to `pathSegments`.
  const centers =
    (params.usePathPoints ?? true)
      ? path.points
      : resample(path.points, path.closed ? nP : nP + 1, path.closed, lerp3);
  const frame = bestFitFrame(profile.points);
  // profile ring points, rotated about the path tangent by `rotation` (deg)
  const rot = ((params.rotation ?? 0) * Math.PI) / 180;
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  const ringPts = profile.points.map((p) => {
    const q = projectToFrame(p, frame);
    return { x: q.x * ca - q.y * sa, y: q.x * sa + q.y * ca };
  });

  const tangents = computeTangents(centers, path.closed);
  const { normals, binormals } = rmfFrames(centers, tangents);

  const rings = centers.length;
  const ring = ringPts.length;
  const positions: number[] = [];
  for (let i = 0; i < rings; i++) {
    const c = centers[i]!;
    const nrm = normals[i]!;
    const bin = binormals[i]!;
    for (const p of ringPts) {
      positions.push(
        c[0] + p.x * nrm[0] + p.y * bin[0],
        c[1] + p.x * nrm[1] + p.y * bin[1],
        c[2] + p.x * nrm[2] + p.y * bin[2],
      );
    }
  }

  const at = (r: number, j: number) => r * ring + j;
  const faces: number[][] = [];
  const ringSteps = path.closed ? rings : rings - 1;
  const profSteps = profile.closed ? ring : ring - 1;
  for (let i = 0; i < ringSteps; i++) {
    const i2 = (i + 1) % rings;
    for (let j = 0; j < profSteps; j++) {
      const j2 = (j + 1) % ring;
      faces.push([at(i, j), at(i, j2), at(i2, j2), at(i2, j)]);
    }
  }
  // cap the ends when the profile is a closed loop and the path is open.
  // caps traverse their ring OPPOSITE to the adjoining wall row so shared
  // edges stay manifold: start cap reversed, end cap forward.
  if (profile.closed && !path.closed) {
    faces.push([...Array(ring).keys()].map((j) => at(0, ring - 1 - j)));
    faces.push([...Array(ring).keys()].map((j) => at(rings - 1, j)));
  }
  const faceUVs = faces.map((f) => new Array(f.length * 2).fill(0));
  try {
    return HEMesh.fromPolygons({ positions, faces, faceUVs });
  } catch {
    return null; // self-intersecting sweep (tight bend vs. wide profile)
  }
}

// ---- resampling ------------------------------------------------------------

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Even arc-length resample of a polyline to `count` points. */
function resample<T extends Vec3 | P2>(
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

// ---- path frames -----------------------------------------------------------

/** Unit tangents by central difference (wrapping when the path is closed). */
function computeTangents(pts: Vec3[], closed: boolean): Vec3[] {
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

/**
 * Rotation-minimizing frames via the double-reflection method (Wang et al.
 * 2008): each frame is the previous one transported with the least possible
 * twist, so a swept tube stays coherent where Frenet frames would flip.
 */
function rmfFrames(pts: Vec3[], t: Vec3[]): { normals: Vec3[]; binormals: Vec3[] } {
  const n = pts.length;
  const normals: Vec3[] = new Array(n);
  const binormals: Vec3[] = new Array(n);
  let r = initialPerp(t[0]!);
  normals[0] = r;
  binormals[0] = normalize(cross(t[0]!, r));
  for (let i = 0; i < n - 1; i++) {
    const v1: Vec3 = [
      pts[i + 1]![0] - pts[i]![0],
      pts[i + 1]![1] - pts[i]![1],
      pts[i + 1]![2] - pts[i]![2],
    ];
    const c1 = dot(v1, v1);
    if (c1 < 1e-12) {
      normals[i + 1] = normals[i]!;
      binormals[i + 1] = binormals[i]!;
      continue;
    }
    const rL = reflect(r, v1, c1);
    const tL = reflect(t[i]!, v1, c1);
    const v2: Vec3 = [t[i + 1]![0] - tL[0], t[i + 1]![1] - tL[1], t[i + 1]![2] - tL[2]];
    const c2 = dot(v2, v2);
    r = c2 < 1e-12 ? rL : reflect(rL, v2, c2);
    // re-orthonormalize against the tangent to fight drift
    const ti = t[i + 1]!;
    const d = dot(r, ti);
    r = normalize([r[0] - d * ti[0], r[1] - d * ti[1], r[2] - d * ti[2]]);
    normals[i + 1] = r;
    binormals[i + 1] = normalize(cross(ti, r));
  }
  return { normals, binormals };
}

function reflect(x: Vec3, v: Vec3, c: number): Vec3 {
  const k = (2 / c) * dot(v, x);
  return [x[0] - k * v[0], x[1] - k * v[1], x[2] - k * v[2]];
}

/** A unit vector perpendicular to t, from the world axis least aligned with it. */
function initialPerp(t: Vec3): Vec3 {
  const ax = Math.abs(t[0]);
  const ay = Math.abs(t[1]);
  const az = Math.abs(t[2]);
  const ref: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  return normalize(cross(t, ref));
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
