import type { SplineData } from "@/types/geometry/spline";
import { SetNodeDataCommand } from "@/core/history/commands/scene";
import {
  breakAngle,
  equalAngle,
  equalLength,
  setClosed,
  toCurve,
  toLinear,
  zeroYAngle,
} from "@/geometry/splines/ops";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { useSelectionInfo } from "@/ui/hooks/doc/selection";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";

/**
 * Floating tangent toolbox for spline point editing (C4D-style): point-type
 * conversions (Linear / Curve), tangent link controls (Break / Equal Angle /
 * Equal Length / 0° Y) and the open-closed toggle. Shown in point mode when
 * the active node is a spline.
 */
export function SplinePointPanel({ vs }: { vs: ViewportSystem }) {
  const doc = useDocument();
  useSliceVersion("scene");
  useSliceVersion("selection");
  const { editMode } = useSelectionInfo();

  const active = doc.selection.active;
  const node = active && doc.scene.has(active) ? doc.scene.mustGet(active) : null;
  const data = (node?.data?.spline as SplineData | undefined) ?? null;
  if (editMode !== "point" || !node || node.kind !== "spline" || !data) return null;

  const ctx = vs.splineEdit.context();
  const selCount = ctx ? vs.splineEdit.selectedIndices(ctx).length : 0;

  const ops: {
    label: string;
    tip: string;
    run: (d: SplineData, s: readonly number[]) => SplineData;
  }[] = [
    { label: "Linear", tip: "Corner points — straight in and out", run: toLinear },
    { label: "Curve", tip: "Auto-smooth tangents (Catmull-Rom)", run: toCurve },
    { label: "Break", tip: "Unlink the two handles", run: breakAngle },
    { label: "Equal Angle", tip: "Re-align handles collinear (keep lengths)", run: equalAngle },
    { label: "Equal Length", tip: "Both handles take the average length", run: equalLength },
    { label: "0° Y", tip: "Flatten tangents horizontal in the plane", run: zeroYAngle },
  ];

  const toggleClosed = () => {
    const after = setClosed(data, !data.closed);
    doc.history.run(
      new SetNodeDataCommand(
        node.id,
        { ...node.data, spline: after },
        { ...node.data, spline: data },
        after.closed ? "Close Spline" : "Open Spline",
        false,
      ),
    );
  };

  return (
    <div className="absolute top-2 left-2 z-10 w-56 rounded-box border border-base-300 bg-base-200/95 p-2 shadow-lg backdrop-blur">
      <div className="mb-1.5 flex items-center px-0.5">
        <span className="flex-1 font-semibold text-[11px] opacity-70">
          Spline · {selCount} point{selCount === 1 ? "" : "s"}
        </span>
        <label className="label cursor-pointer gap-1 p-0 text-[10px] opacity-80">
          Closed
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={data.closed}
            onChange={toggleClosed}
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {ops.map((op) => (
          <button
            key={op.label}
            type="button"
            className="btn btn-xs tooltip tooltip-bottom"
            data-tip={op.tip}
            disabled={selCount === 0}
            onClick={() => vs.splineEdit.applyOp(op.run, op.label)}
          >
            {op.label}
          </button>
        ))}
      </div>
    </div>
  );
}
