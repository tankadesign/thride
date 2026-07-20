import type { PolygonMeshData } from "@/types/geometry/mesh";
import type {
  CapsuleParams,
  ConeParams,
  CylinderParams,
  SphereParams,
  TorusParams,
} from "@/types/geometry/primitives";

interface ProfilePoint {
  r: number;
  y: number;
  v: number; // uv along profile (1 at top, 0 at bottom)
}

interface LatheOptions {
  segments: number;
  topPole?: number; // apex y above the first ring
  bottomPole?: number; // apex y below the last ring
  topCap?: boolean; // flat n-gon on the first ring
  bottomCap?: boolean;
}

/**
 * Revolve a top→bottom profile around Y. Shared by sphere, cylinder, cone
 * and capsule so the winding math lives exactly once (see basic.ts header).
 */
function lathe(profile: ProfilePoint[], opts: LatheOptions): PolygonMeshData {
  const N = Math.max(3, Math.round(opts.segments));
  const positions: number[] = [];
  const faces: number[][] = [];
  const faceUVs: number[][] = [];

  const ringStart: number[] = [];
  for (const p of profile) {
    ringStart.push(positions.length / 3);
    for (let k = 0; k < N; k++) {
      const phi = (k / N) * Math.PI * 2;
      positions.push(p.r * Math.cos(phi), p.y, p.r * Math.sin(phi));
    }
  }
  const rv = (i: number, k: number) => ringStart[i]! + (k % N);
  const u = (k: number) => k / N; // k may be N at the seam → u=1 (per-corner UVs)

  // side quads
  for (let i = 0; i < profile.length - 1; i++) {
    const va = profile[i]!.v;
    const vb = profile[i + 1]!.v;
    for (let k = 0; k < N; k++) {
      faces.push([rv(i, k), rv(i, k + 1), rv(i + 1, k + 1), rv(i + 1, k)]);
      faceUVs.push([u(k), va, u(k + 1), va, u(k + 1), vb, u(k), vb]);
    }
  }

  if (opts.topPole !== undefined) {
    const apex = positions.length / 3;
    positions.push(0, opts.topPole, 0);
    for (let k = 0; k < N; k++) {
      faces.push([apex, rv(0, k + 1), rv(0, k)]);
      faceUVs.push([u(k) + 0.5 / N, 1, u(k + 1), profile[0]!.v, u(k), profile[0]!.v]);
    }
  } else if (opts.topCap) {
    const loop: number[] = [];
    const uvs: number[] = [];
    for (let k = N - 1; k >= 0; k--) {
      loop.push(rv(0, k));
      const phi = (k / N) * Math.PI * 2;
      uvs.push(0.5 + Math.cos(phi) / 2, 0.5 + Math.sin(phi) / 2);
    }
    faces.push(loop);
    faceUVs.push(uvs);
  }

  const L = profile.length - 1;
  if (opts.bottomPole !== undefined) {
    const apex = positions.length / 3;
    positions.push(0, opts.bottomPole, 0);
    for (let k = 0; k < N; k++) {
      faces.push([apex, rv(L, k), rv(L, k + 1)]);
      faceUVs.push([u(k) + 0.5 / N, 0, u(k), profile[L]!.v, u(k + 1), profile[L]!.v]);
    }
  } else if (opts.bottomCap) {
    const loop: number[] = [];
    const uvs: number[] = [];
    for (let k = 0; k < N; k++) {
      loop.push(rv(L, k));
      const phi = (k / N) * Math.PI * 2;
      uvs.push(0.5 + Math.cos(phi) / 2, 0.5 - Math.sin(phi) / 2);
    }
    faces.push(loop);
    faceUVs.push(uvs);
  }

  return { positions, faces, faceUVs };
}

/** Standard (lathe) sphere; Icosa mode dispatches to buildIcosphere upstream. */
export function buildSphere(params: SphereParams): PolygonMeshData {
  const { radius, segments } = params;
  const R = Math.max(3, Math.round(params.rings));
  const profile: ProfilePoint[] = [];
  if (params.hemisphere) {
    // top half: pole → equator; open at the equator unless filled — the
    // fill is a bottomPole AT the equator plane (y=0), i.e. a center-point
    // fan cap (same convention as the disc primitive)
    for (let i = 1; i <= R; i++) {
      const theta = (i / R) * (Math.PI / 2);
      profile.push({ r: radius * Math.sin(theta), y: radius * Math.cos(theta), v: 1 - i / R });
    }
    return lathe(profile, {
      segments,
      topPole: radius,
      bottomPole: params.filled ? 0 : undefined,
    });
  }
  for (let i = 1; i < R; i++) {
    const theta = (i / R) * Math.PI;
    profile.push({ r: radius * Math.sin(theta), y: radius * Math.cos(theta), v: 1 - i / R });
  }
  return lathe(profile, { segments, topPole: radius, bottomPole: -radius });
}

export function buildCylinder(params: CylinderParams): PolygonMeshData {
  const { radiusTop, radiusBottom, height, segments, capped } = params;
  const hs = Math.max(1, Math.round(params.heightSegments ?? 1));
  const h = height / 2;
  const profile: ProfilePoint[] = [];
  // rings top→bottom, linearly interpolated across `hs` height bands. A
  // zero-radius end is the pole (added by lathe), so it's skipped as a ring.
  const first = radiusTop > 0 ? 0 : 1;
  const last = radiusBottom > 0 ? hs : hs - 1;
  for (let i = first; i <= last; i++) {
    const t = i / hs; // 0 top → 1 bottom
    profile.push({
      r: radiusTop + (radiusBottom - radiusTop) * t,
      y: h - height * t,
      v: 1 - t,
    });
  }
  if (profile.length === 0) throw new Error("cylinder: both radii are zero");
  return lathe(profile, {
    segments,
    topPole: radiusTop <= 0 ? h : undefined,
    bottomPole: radiusBottom <= 0 ? -h : undefined,
    topCap: capped && radiusTop > 0,
    bottomCap: capped && radiusBottom > 0,
  });
}

export function buildCone({ radius, height, segments, capped }: ConeParams): PolygonMeshData {
  return buildCylinder({ radiusTop: 0, radiusBottom: radius, height, segments, capped });
}

export function buildCapsule({
  radius,
  height,
  segments,
  capRings,
}: CapsuleParams): PolygonMeshData {
  const rings = Math.max(2, Math.round(capRings));
  const h = height / 2;
  const profile: ProfilePoint[] = [];
  for (let i = 1; i <= rings; i++) {
    const theta = (i / rings) * (Math.PI / 2);
    profile.push({
      r: radius * Math.sin(theta),
      y: h + radius * Math.cos(theta),
      v: 1 - (0.25 * i) / rings,
    });
  }
  for (let i = 0; i < rings; i++) {
    const theta = Math.PI / 2 + (i / rings) * (Math.PI / 2);
    profile.push({
      r: radius * Math.sin(theta),
      y: -h + radius * Math.cos(theta),
      v: 0.25 + (0.25 * i) / rings,
    });
  }
  return lathe(profile, { segments, topPole: h + radius, bottomPole: -h - radius });
}

export function buildTorus({ radius, tube, segments, tubeSegments }: TorusParams): PolygonMeshData {
  const N = Math.max(3, Math.round(segments));
  const M = Math.max(3, Math.round(tubeSegments));
  const positions: number[] = [];
  for (let i = 0; i < N; i++) {
    const uAng = (i / N) * Math.PI * 2;
    for (let j = 0; j < M; j++) {
      const vAng = (j / M) * Math.PI * 2;
      const rr = radius + tube * Math.cos(vAng);
      positions.push(rr * Math.cos(uAng), tube * Math.sin(vAng), rr * Math.sin(uAng));
    }
  }
  const v = (i: number, j: number) => (i % N) * M + (j % M);
  const faces: number[][] = [];
  const faceUVs: number[][] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      faces.push([v(i, j), v(i, j + 1), v(i + 1, j + 1), v(i + 1, j)]);
      const u0 = i / N;
      const u1 = (i + 1) / N;
      const w0 = j / M;
      const w1 = (j + 1) / M;
      faceUVs.push([u0, w0, u0, w1, u1, w1, u1, w0]);
    }
  }
  return { positions, faces, faceUVs };
}
