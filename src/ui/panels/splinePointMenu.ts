import type { MenuEntry } from "@/ui/hooks/editor/shell";
import {
  breakAngle,
  equalAngle,
  equalLength,
  toCurve,
  toLinear,
  zeroYAngle,
} from "@/geometry/splines/ops";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";

/**
 * C4D-style tangent ops for spline point editing, surfaced in the point-mode
 * right-click context menu (they used to live in a floating viewport panel).
 * Each acts on the currently selected points via {@link ViewportSystem.splineEdit}.
 */
const TANGENT_OPS = [
  { label: "Linear", run: toLinear },
  { label: "Curve", run: toCurve },
  { label: "Break", run: breakAngle },
  { label: "Equal Angle", run: equalAngle },
  { label: "Equal Length", run: equalLength },
  { label: "0° Y", run: zeroYAngle },
] as const;

/**
 * The tangent-op context-menu entries when a spline is being point-edited, or
 * null when the active node isn't a spline in point mode. The ops apply to the
 * selected points and are disabled when none are selected.
 */
export function buildSplinePointMenu(vs: ViewportSystem): MenuEntry[] | null {
  const ctx = vs.splineEdit.context();
  if (!ctx) return null;
  const selCount = vs.splineEdit.selectedIndices(ctx).length;
  return TANGENT_OPS.map((op) => ({
    label: op.label,
    disabled: selCount === 0,
    run: () => vs.splineEdit.applyOp(op.run, op.label),
  }));
}
