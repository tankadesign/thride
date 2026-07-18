import type { Vec3 } from "@/types/core";
import type { SplineData, SplinePointDTO, SplinePrimitive } from "@/types/geometry/spline";

/**
 * Pure builders that turn a parametric curve recipe into SplineData (bezier
 * points in the node's local XY plane; the helix uses Z). No Three, no DOM —
 * shared by the create commands and the live attribute editor. A planar curve
 * feeds extrude; the helix feeds sweep as a path.
 */
/** Corner turn angle (deg) above which "Round corners" fillets a vertex. */
const CORNER_THRESHOLD_DEG = 15;

export function buildSplinePrimitive(prim: SplinePrimitive): SplineData {
  switch (prim.type) {
    case "line":
      return line(prim.length);
    case "circle":
      return circle(prim.radius);
    case "nside": {
      const sides = Math.max(2, Math.round(prim.sides));
      return prim.roundCorners
        ? filletPolygon(polygonVerts(sides, prim.radius), frac(prim.rounding))
        : roundedPolygon(sides, prim.radius, frac(prim.rounding));
    }
    case "star": {
      const pts = Math.max(2, Math.round(prim.points));
      return prim.roundCorners
        ? filletPolygon(starVerts(pts, prim.innerRadius, prim.outerRadius), frac(prim.rounding))
        : star(pts, prim.innerRadius, prim.outerRadius, frac(prim.rounding));
    }
    case "helix":
      return helix(prim.radius, prim.height, prim.turns, Math.max(3, Math.round(prim.segments)));
  }
}

/** Slider (0–1000) → 0–1 fraction, clamped. */
function frac(rounding: number): number {
  return Math.max(0, Math.min(1, rounding / 1000));
}

const zero: Vec3 = [0, 0, 0];

/** Straight open segment of `length` along local X, centered on the origin. Two
 * linear anchors — a base for linear instancer rows (via a count distribution). */
function line(length: number): SplineData {
  const h = Math.max(1e-4, length) / 2;
  const points: SplinePointDTO[] = [
    { position: [-h, 0, 0], inHandle: zero, outHandle: zero, mode: "linear" },
    { position: [h, 0, 0], inHandle: zero, outHandle: zero, mode: "linear" },
  ];
  return { points, closed: false };
}

/** Exact circle from 4 cubic anchors (handle length k = 0.5523·r). */
function circle(radius: number): SplineData {
  const r = Math.max(1e-4, radius);
  const k = 0.5522847498 * r;
  const anchors: [Vec3, Vec3][] = [
    // [position, unit tangent (CCW)]
    [
      [r, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, r, 0],
      [-1, 0, 0],
    ],
    [
      [-r, 0, 0],
      [0, -1, 0],
    ],
    [
      [0, -r, 0],
      [1, 0, 0],
    ],
  ];
  const points: SplinePointDTO[] = anchors.map(([position, t]) => ({
    position,
    outHandle: [t[0] * k, t[1] * k, 0],
    inHandle: [-t[0] * k, -t[1] * k, 0],
    mode: "smooth",
  }));
  return { points, closed: true };
}

/** Corner positions of a regular polygon (CCW, first vertex on +X). */
function polygonVerts(sides: number, radius: number): Vec3[] {
  const r = Math.max(1e-4, radius);
  const out: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    out.push([r * Math.cos(a), r * Math.sin(a), 0]);
  }
  return out;
}

/** Corner positions of an N-point star, alternating outer/inner radius. */
function starVerts(pts: number, inner: number, outer: number): Vec3[] {
  const ri = Math.max(1e-4, inner);
  const ro = Math.max(1e-4, outer);
  const n = pts * 2;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = i % 2 === 0 ? ro : ri;
    out.push([r * Math.cos(a), r * Math.sin(a), 0]);
  }
  return out;
}

/**
 * Regular polygon whose whole outline bulges toward a circle as `f` grows
 * (0 = sharp, 1 = a true circle). Each vertex tangent is ⟂ its radius; handle
 * length reaches the exact circular-arc bezier length at f=1.
 */
function roundedPolygon(sides: number, radius: number, f: number): SplineData {
  const len = f * (4 / 3) * Math.tan(Math.PI / (2 * sides)) * Math.max(1e-4, radius);
  return radialTangentSpline(polygonVerts(sides, radius), len);
}

/** N-point star whose whole outline bulges toward round as `f` grows. */
function star(pts: number, inner: number, outer: number, f: number): SplineData {
  const base =
    (4 / 3) *
    Math.tan(Math.PI / (pts * 2)) *
    Math.min(Math.max(1e-4, inner), Math.max(1e-4, outer));
  return radialTangentSpline(starVerts(pts, inner, outer), f * base);
}

/** Place smooth handles of fixed length along each vertex's ⟂-radius tangent. */
function radialTangentSpline(verts: Vec3[], len: number): SplineData {
  const points: SplinePointDTO[] = verts.map((position) => {
    const rl = Math.hypot(position[0], position[1]) || 1;
    const t: Vec3 = [-position[1] / rl, position[0] / rl, 0]; // CCW tangent ⟂ radius
    return {
      position,
      outHandle: [t[0] * len, t[1] * len, 0],
      inHandle: [-t[0] * len, -t[1] * len, 0],
      mode: len > 1e-9 ? "smooth" : "linear",
    } satisfies SplinePointDTO;
  });
  return { points, closed: true };
}

/**
 * Round only the corners of a polygon (C4D "Round corners"): edges stay
 * straight, each vertex whose turn exceeds the threshold is replaced by two
 * tangent points joined by a fillet arc. `f` (0–1) sets the fillet size as a
 * fraction of the shorter adjoining edge's half-length.
 */
function filletPolygon(verts: Vec3[], f: number): SplineData {
  const n = verts.length;
  const threshold = (CORNER_THRESHOLD_DEG * Math.PI) / 180;
  const kappa = 0.5522847498;
  const points: SplinePointDTO[] = [];
  for (let i = 0; i < n; i++) {
    const prev = verts[(i - 1 + n) % n]!;
    const v = verts[i]!;
    const next = verts[(i + 1) % n]!;
    const inVec = sub(v, prev);
    const outVec = sub(next, v);
    const inLen = mag(inVec);
    const outLen = mag(outVec);
    const dirIn = scale(inVec, 1 / (inLen || 1));
    const dirOut = scale(outVec, 1 / (outLen || 1));
    const turn = Math.acos(Math.max(-1, Math.min(1, dot(dirIn, dirOut))));
    if (f <= 1e-6 || turn <= threshold) {
      points.push({ position: v, inHandle: zero, outHandle: zero, mode: "linear" });
      continue;
    }
    const d = f * 0.5 * Math.min(inLen, outLen); // fillet setback along each edge
    const p1 = sub(v, scale(dirIn, d)); // tangent point on the incoming edge
    const p2 = add(v, scale(dirOut, d)); // tangent point on the outgoing edge
    // straight edge in → arc out for p1; arc in → straight edge out for p2
    points.push({
      position: p1,
      inHandle: zero,
      outHandle: scale(dirIn, d * kappa),
      mode: "broken",
    });
    points.push({
      position: p2,
      inHandle: scale(dirOut, -d * kappa),
      outHandle: zero,
      mode: "broken",
    });
  }
  return { points, closed: true };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function mag(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/**
 * Open helix up the +Z axis: `segments` bezier anchors per turn, each with
 * tangents along the analytic derivative so few points still read smooth.
 */
function helix(radius: number, height: number, turns: number, segPerTurn: number): SplineData {
  const r = Math.max(1e-4, radius);
  const t = Math.max(0.01, turns);
  const total = Math.max(1, Math.round(segPerTurn * t));
  const dTheta = (t * Math.PI * 2) / total;
  const dz = height / total;
  const points: SplinePointDTO[] = [];
  for (let i = 0; i <= total; i++) {
    const a = i * dTheta;
    const position: Vec3 = [r * Math.cos(a), r * Math.sin(a), (i / total) * height];
    // derivative wrt step: tangent for a smooth cubic (Δ/3 handle length)
    const deriv: Vec3 = [-r * Math.sin(a) * dTheta, r * Math.cos(a) * dTheta, dz];
    const out: Vec3 = [deriv[0] / 3, deriv[1] / 3, deriv[2] / 3];
    points.push({
      position,
      outHandle: i === total ? zero : out,
      inHandle: i === 0 ? zero : [-out[0], -out[1], -out[2]],
      mode: "smooth",
    });
  }
  return { points, closed: false };
}
