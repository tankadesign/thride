import type { SplineData } from "@/types/geometry/spline";
import { HEMesh } from "@/geometry/kernel/HEMesh";
import { sampleSpline2D } from "@/geometry/splines/eval";

export interface SplineExtrudeParams {
  depth: number;
  heightSegments: number;
  bevelSize: number;
  bevelSegments: number;
  caps: boolean;
}

export const defaultSplineExtrudeParams = (): SplineExtrudeParams => ({
  depth: 0.5,
  heightSegments: 1,
  bevelSize: 0,
  bevelSegments: 2,
  caps: true,
});

interface P2 {
  x: number;
  y: number;
}

/**
 * The Spline-app signature move: child spline in → extruded mesh out, as a
 * kernel HEMesh (n-gon caps, quad walls) so the result stays boolean-able
 * and convertible. Closed profiles get caps and an optional rounded bevel
 * (quarter-arc rings at both ends, inward miter offset); open profiles
 * extrude as a ribbon. Returns null when the profile is degenerate.
 */
export function buildSplineExtrude(spline: SplineData, params: SplineExtrudeParams): HEMesh | null {
  const profile = dedupe(sampleSpline2D(spline, 24));
  if (profile.length < (spline.closed ? 3 : 2)) return null;
  const depth = Math.max(1e-4, params.depth);
  // ?? 1 keeps projects saved before height segments existed valid
  const heightSegs = Math.max(1, Math.round(params.heightSegments ?? 1));

  if (!spline.closed) return buildRibbon(profile, depth, heightSegs);

  if (area(profile) < 0) profile.reverse(); // CCW so inward offsets shrink

  // bevel: clamp so opposing rings can never cross through the middle
  const segs = Math.max(1, Math.round(params.bevelSegments));
  const b = Math.max(0, Math.min(params.bevelSize, depth / 2 - 1e-4));

  // ring stack bottom→top: [inset, z][]
  const rings: [number, number][] = [];
  if (b > 0) {
    // bottom quarter-arc: z 0→b
    for (let k = 0; k <= segs; k++) {
      const phi = (k / segs) * (Math.PI / 2);
      rings.push([b * (1 - Math.sin(phi)), b * (1 - Math.cos(phi))]);
    }
    // straight wall between the arcs, split into heightSegs (interior rings)
    const wall = depth - 2 * b;
    for (let k = 1; k < heightSegs; k++) rings.push([0, b + (k / heightSegs) * wall]);
    // top quarter-arc: z depth-b→depth
    for (let k = segs; k >= 0; k--) {
      const phi = (k / segs) * (Math.PI / 2);
      rings.push([b * (1 - Math.sin(phi)), depth - b * (1 - Math.cos(phi))]);
    }
  } else {
    for (let k = 0; k <= heightSegs; k++) rings.push([0, (k / heightSegs) * depth]);
  }

  const n = profile.length;
  const positions: number[] = [];
  for (const [inset, z] of rings) {
    const ring = inset > 0 ? offsetInward(profile, inset) : profile;
    for (const p of ring) positions.push(p.x, p.y, z);
  }

  const faces: number[][] = [];
  const at = (ring: number, i: number) => ring * n + i;
  // walls between consecutive rings (outward-facing: CCW profile, +Z up)
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      faces.push([at(r, i), at(r, j), at(r + 1, j), at(r + 1, i)]);
    }
  }
  if (params.caps) {
    // bottom cap faces -Z (profile order reversed), top cap faces +Z
    faces.push([...Array(n).keys()].map((i) => at(0, n - 1 - i)));
    faces.push([...Array(n).keys()].map((i) => at(rings.length - 1, i)));
  }
  const faceUVs = faces.map((f) => new Array(f.length * 2).fill(0));
  try {
    return HEMesh.fromPolygons({ positions, faces, faceUVs });
  } catch {
    return null; // degenerate profile (self-intersecting offset etc.)
  }
}

/** Open profile: a ribbon of heightSegs stacked rings (open, no caps). */
function buildRibbon(profile: P2[], depth: number, heightSegs: number): HEMesh | null {
  const n = profile.length;
  const positions: number[] = [];
  for (let r = 0; r <= heightSegs; r++) {
    const z = (r / heightSegs) * depth;
    for (const p of profile) positions.push(p.x, p.y, z);
  }
  const faces: number[][] = [];
  for (let r = 0; r < heightSegs; r++) {
    const lo = r * n;
    const hi = (r + 1) * n;
    for (let i = 0; i < n - 1; i++) {
      faces.push([lo + i, lo + i + 1, hi + i + 1, hi + i]);
    }
  }
  const faceUVs = faces.map(() => [0, 0, 1, 0, 1, 1, 0, 1]);
  try {
    return HEMesh.fromPolygons({ positions, faces, faceUVs });
  } catch {
    return null;
  }
}

/** Signed area (positive = CCW). */
function area(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Drop consecutive duplicates (closed splines repeat corner samples). */
function dedupe(pts: P2[]): P2[] {
  const out: P2[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-7) continue;
    out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && Math.hypot(first.x - last.x, first.y - last.y) < 1e-7) {
    out.pop();
  }
  return out;
}

/**
 * Inward miter offset of a CCW polygon: each vertex moves along the
 * bisector of its adjacent edge normals; the miter factor is clamped so
 * near-collinear spikes don't explode.
 */
function offsetInward(pts: P2[], d: number): P2[] {
  const n = pts.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;
    // inward (left) normals of the two edges around the vertex
    const n1 = leftNormal(prev, cur);
    const n2 = leftNormal(cur, next);
    let bx = n1.x + n2.x;
    let by = n1.y + n2.y;
    const len = Math.hypot(bx, by);
    if (len < 1e-9) {
      bx = n2.x;
      by = n2.y;
    } else {
      bx /= len;
      by /= len;
    }
    // miter length = d / cos(half angle); clamp at 4× to tame spikes
    const cosHalf = Math.max(0.25, bx * n2.x + by * n2.y);
    const m = d / cosHalf;
    out.push({ x: cur.x + bx * m, y: cur.y + by * m });
  }
  return out;
}

function leftNormal(a: P2, b: P2): P2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: -dy / l, y: dx / l };
}
