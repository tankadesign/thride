import type { Vec3 } from "@/types/core";
import type { SplineData, SplinePointDTO, SplinePrimitive } from "@/types/geometry/spline";

/**
 * Pure builders that turn a parametric curve recipe into SplineData (bezier
 * points in the node's local XY plane; the helix uses Z). No Three, no DOM —
 * shared by the create commands and the live attribute editor. A planar curve
 * feeds extrude; the helix feeds sweep as a path.
 */
export function buildSplinePrimitive(prim: SplinePrimitive): SplineData {
  switch (prim.type) {
    case "circle":
      return circle(prim.radius);
    case "nside":
      return roundedPolygon(Math.max(2, Math.round(prim.sides)), prim.radius, frac(prim.rounding));
    case "star":
      return star(
        Math.max(2, Math.round(prim.points)),
        prim.innerRadius,
        prim.outerRadius,
        frac(prim.rounding),
      );
    case "helix":
      return helix(prim.radius, prim.height, prim.turns, Math.max(3, Math.round(prim.segments)));
  }
}

/** Slider (0–1000) → 0–1 fraction, clamped. */
function frac(rounding: number): number {
  return Math.max(0, Math.min(1, rounding / 1000));
}

const zero: Vec3 = [0, 0, 0];

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

/**
 * Regular polygon, corners rounded by `f` (0 = sharp, 1 ≈ circle). Each vertex
 * tangent is perpendicular to its radius; handle length grows with f up to the
 * exact circular-arc bezier length, so a fully rounded n-gon is a clean circle.
 */
function roundedPolygon(sides: number, radius: number, f: number): SplineData {
  const r = Math.max(1e-4, radius);
  const arcHandle = (4 / 3) * Math.tan(Math.PI / (2 * sides)) * r; // f=1 → circle
  const len = f * arcHandle;
  const points: SplinePointDTO[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const position: Vec3 = [r * Math.cos(a), r * Math.sin(a), 0];
    const t: Vec3 = [-Math.sin(a), Math.cos(a), 0]; // CCW tangent ⟂ radius
    points.push({
      position,
      outHandle: [t[0] * len, t[1] * len, 0],
      inHandle: [-t[0] * len, -t[1] * len, 0],
      mode: len > 1e-9 ? "smooth" : "linear",
    });
  }
  return { points, closed: true };
}

/** N-point star, alternating outer/inner radius, corners rounded by `f`. */
function star(pts: number, inner: number, outer: number, f: number): SplineData {
  const ri = Math.max(1e-4, inner);
  const ro = Math.max(1e-4, outer);
  const n = pts * 2;
  const points: SplinePointDTO[] = [];
  // handle length scales with the shorter radius and the corner step angle
  const base = (4 / 3) * Math.tan(Math.PI / n) * Math.min(ri, ro);
  const len = f * base;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = i % 2 === 0 ? ro : ri;
    const position: Vec3 = [r * Math.cos(a), r * Math.sin(a), 0];
    const t: Vec3 = [-Math.sin(a), Math.cos(a), 0];
    points.push({
      position,
      outHandle: [t[0] * len, t[1] * len, 0],
      inHandle: [-t[0] * len, -t[1] * len, 0],
      mode: len > 1e-9 ? "smooth" : "linear",
    });
  }
  return { points, closed: true };
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
