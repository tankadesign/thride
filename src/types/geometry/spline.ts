import type { Vec3 } from "@/types/core";

/**
 * Tangent linkage of a spline point:
 * - `smooth`: in/out handles stay collinear (opposite directions); lengths
 *   are independent. Dragging one handle rotates the other.
 * - `broken`: handles are fully independent (a corner between two curves).
 * - `linear`: both handles are zero — straight segments into and out of the
 *   point. Dragging a handle out of a linear point promotes it to smooth.
 */
export type TangentMode = "smooth" | "broken" | "linear";

/**
 * One bezier anchor. Positions are NODE-LOCAL; the node transform is the
 * work plane the spline was drawn on (local XY = the plane, +Z = its
 * normal), so a pen that writes z=0 draws "in 2D but in perspective".
 * Handles are offsets RELATIVE to `position` (move a point, its tangents
 * ride along).
 */
export interface SplinePointDTO {
  position: Vec3;
  inHandle: Vec3;
  outHandle: Vec3;
  mode: TangentMode;
}

/** The document payload of a spline node (`node.data.spline`). */
export interface SplineData {
  points: SplinePointDTO[];
  closed: boolean;
}

export const emptySpline = (): SplineData => ({ points: [], closed: false });

/**
 * Parametric curve recipe stored alongside `spline` on a primitive spline
 * node (`node.data.splinePrimitive`). Editing a param rebuilds `spline`'s
 * points; the node stays a first-class spline (renders, feeds extrude/sweep).
 * `rounding` sliders are 0–1000 and read as a 0–1 fraction (value / 1000).
 */
export type SplinePrimitive =
  | { type: "line"; length: number }
  | { type: "circle"; radius: number }
  | { type: "nside"; sides: number; radius: number; rounding: number; roundCorners: boolean }
  | {
      type: "star";
      points: number;
      innerRadius: number;
      outerRadius: number;
      rounding: number;
      roundCorners: boolean;
    }
  | { type: "helix"; radius: number; height: number; turns: number; segments: number };

export type SplinePrimitiveType = SplinePrimitive["type"];

export const defaultSplinePrimitive = (type: SplinePrimitiveType): SplinePrimitive => {
  switch (type) {
    case "line":
      return { type, length: 5 };
    case "circle":
      return { type, radius: 1 };
    case "nside":
      return { type, sides: 6, radius: 1, rounding: 0, roundCorners: false };
    case "star":
      return {
        type,
        points: 5,
        innerRadius: 0.5,
        outerRadius: 1,
        rounding: 0,
        roundCorners: false,
      };
    case "helix":
      return { type, radius: 1, height: 2, turns: 3, segments: 16 };
  }
};
