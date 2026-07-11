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
