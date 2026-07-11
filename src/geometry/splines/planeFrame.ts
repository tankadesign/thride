import type { Vec3 } from "@/types/core";

/**
 * A right-handed orthonormal frame fitted to a set of 3D points: the plane
 * they best lie in (origin at their centroid, `normal` from Newell's method)
 * plus an in-plane basis (`u`, `v` with `v = normal × u`). Consumers project
 * a profile into `(u, v)` to run planar 2D geometry, then map back to 3D.
 */
export interface PlaneFrame {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  normal: Vec3;
}

export interface P2 {
  x: number;
  y: number;
}

/**
 * Best-fit plane of a 3D polygon. The normal is signed toward +Z so a profile
 * drawn in the local XY plane keeps the original extrude direction, and the
 * basis is picked so a planar-XY profile yields u=+X, v=+Y, normal=+Z — i.e.
 * the whole transform is the identity for the common (flat) case.
 */
export function bestFitFrame(pts: Vec3[]): PlaneFrame {
  const origin: Vec3 = [0, 0, 0];
  for (const p of pts) {
    origin[0] += p[0];
    origin[1] += p[1];
    origin[2] += p[2];
  }
  const count = pts.length || 1;
  origin[0] /= count;
  origin[1] /= count;
  origin[2] /= count;

  // Newell's method: robust normal for a (possibly non-convex) 3D polygon
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  let len = Math.hypot(nx, ny, nz);
  let normal: Vec3 = len < 1e-9 ? [0, 0, 1] : [nx / len, ny / len, nz / len];
  if (len < 1e-9) len = 1;
  // sign toward +Z so extrude keeps pointing the way it did before
  if (normal[2] < 0) normal = [-normal[0], -normal[1], -normal[2]];

  // u = world +X projected into the plane (or +Y if the plane is edge-on to X)
  const ref: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = ref[0] * normal[0] + ref[1] * normal[1] + ref[2] * normal[2];
  let u: Vec3 = [ref[0] - d * normal[0], ref[1] - d * normal[1], ref[2] - d * normal[2]];
  const ul = Math.hypot(u[0], u[1], u[2]) || 1;
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  // v = normal × u keeps the frame right-handed (CCW in u,v faces +normal)
  const v: Vec3 = [
    normal[1] * u[2] - normal[2] * u[1],
    normal[2] * u[0] - normal[0] * u[2],
    normal[0] * u[1] - normal[1] * u[0],
  ];
  return { origin, u, v, normal };
}

/** Project a 3D point onto the frame's (u, v) plane (origin-relative). */
export function projectToFrame(p: Vec3, f: PlaneFrame): P2 {
  const dx = p[0] - f.origin[0];
  const dy = p[1] - f.origin[1];
  const dz = p[2] - f.origin[2];
  return {
    x: dx * f.u[0] + dy * f.u[1] + dz * f.u[2],
    y: dx * f.v[0] + dy * f.v[1] + dz * f.v[2],
  };
}

/** Map an in-plane point (x,y) offset `w` along the normal back into 3D. */
export function placeInFrame(f: PlaneFrame, x: number, y: number, w: number): Vec3 {
  return [
    f.origin[0] + x * f.u[0] + y * f.v[0] + w * f.normal[0],
    f.origin[1] + x * f.u[1] + y * f.v[1] + w * f.normal[1],
    f.origin[2] + x * f.u[2] + y * f.v[2] + w * f.normal[2],
  ];
}
