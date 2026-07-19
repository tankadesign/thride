import { useRef } from "react";
import type { Uuid } from "@/types/core";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import { paramMeta, primitiveDefaults, visibleParams } from "@/types/geometry/primitives";
import type { SplineData, SplinePrimitive } from "@/types/geometry/spline";
import { buildSplinePrimitive } from "@/geometry/splines/primitives";
import { setClosed } from "@/geometry/splines/ops";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { SetNodeDataCommand } from "@/core/history/commands/scene";
import { useDocument } from "@/ui/hooks/doc/document";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { Field, Section } from "@/ui/widgets/inspector";

/**
 * Spline-level attributes shared by every spline (parametric or hand-drawn) —
 * currently just the open/closed toggle, which used to live in the floating
 * point-edit panel. Sits right after Transform. Preserves the recipe on
 * parametric splines (no detach); a later param edit re-derives closedness.
 */
export function SplineSection({ id, data }: { id: Uuid; data: SplineData }) {
  const doc = useDocument();
  const toggleClosed = () => {
    const node = doc.scene.mustGet(id);
    const after = setClosed(data, !data.closed);
    doc.history.run(
      new SetNodeDataCommand(
        id,
        { ...node.data, spline: after },
        { ...node.data, spline: data },
        after.closed ? "Close Spline" : "Open Spline",
        false,
      ),
    );
  };
  return (
    <Section title="Spline">
      <Field label="Closed">
        <input
          type="checkbox"
          className="toggle toggle-sm justify-self-start"
          checked={data.closed}
          onChange={toggleClosed}
        />
      </Field>
    </Section>
  );
}

interface SplinePrimRow {
  key: string;
  label: string;
  int?: boolean;
  min?: number;
  max?: number;
  step?: number;
  bool?: boolean;
}

const SPLINE_PRIM_ROWS: Record<SplinePrimitive["type"], SplinePrimRow[]> = {
  line: [{ key: "length", label: "Length", min: 0.001 }],
  circle: [{ key: "radius", label: "Radius", min: 0.001 }],
  nside: [
    { key: "sides", label: "Sides", int: true, min: 2, max: 1000, step: 1 },
    { key: "radius", label: "Radius", min: 0.001 },
    { key: "roundCorners", label: "Round Corners", bool: true },
    { key: "rounding", label: "Rounding", int: true, min: 0, max: 1000, step: 5 },
  ],
  star: [
    { key: "points", label: "Points", int: true, min: 2, max: 1000, step: 1 },
    { key: "innerRadius", label: "Inner R", min: 0.001 },
    { key: "outerRadius", label: "Outer R", min: 0.001 },
    { key: "roundCorners", label: "Round Corners", bool: true },
    { key: "rounding", label: "Rounding", int: true, min: 0, max: 1000, step: 5 },
  ],
  helix: [
    { key: "radius", label: "Radius", min: 0.001 },
    { key: "height", label: "Height", min: 0 },
    { key: "turns", label: "Turns", min: 0.01 },
    { key: "segments", label: "Seg/Turn", int: true, min: 3, max: 256, step: 0.5 },
  ],
};

/** Live editor for a parametric curve primitive — each change rebuilds the spline points. */
export function SplinePrimitiveParams({ id, prim }: { id: Uuid; prim: SplinePrimitive }) {
  const doc = useDocument();
  const scrub = useRef<{ before: Record<string, unknown> } | null>(null);

  const setParam = (key: string, value: number | boolean, committed: boolean) => {
    const node = doc.scene.mustGet(id);
    scrub.current ??= { before: structuredClone(node.data!) };
    const data = structuredClone(node.data!);
    const recipe = data.splinePrimitive as Record<string, number | string | boolean>;
    recipe[key] = value;
    // rebuild the baked points from the new recipe so every consumer updates
    data.spline = buildSplinePrimitive(recipe as unknown as SplinePrimitive);
    if (committed) {
      const before = scrub.current.before;
      scrub.current = null;
      doc.setNodeData(id, data, true);
      doc.history.pushWithoutExecute(new SetNodeDataCommand(id, data, before, `Edit ${prim.type}`));
    } else {
      doc.setNodeData(id, data, true);
    }
  };

  const values = prim as unknown as Record<string, number | boolean>;
  return (
    <Section title={`${prim.type} parameters`} bordered={false}>
      {SPLINE_PRIM_ROWS[prim.type].map((row) => (
        <Field label={row.label} key={row.key}>
          {row.bool ? (
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={Boolean(values[row.key])}
              onChange={(e) => setParam(row.key, e.target.checked, true)}
            />
          ) : (
            <NumberDrag
              value={(values[row.key] as number) ?? 0}
              step={row.step ?? (row.int ? 0.08 : 0.01)}
              integer={row.int}
              min={row.min}
              max={row.max}
              onChange={(v, committed) => setParam(row.key, v, committed)}
            />
          )}
        </Field>
      ))}
    </Section>
  );
}

export function PrimitiveParams({ id, prim }: { id: Uuid; prim: PrimitiveDescriptor }) {
  const doc = useDocument();
  const scrub = useRef<{ before: Record<string, unknown> } | null>(null);

  const setParam = (key: string, value: number | boolean, committed: boolean) => {
    const node = doc.scene.mustGet(id);
    scrub.current ??= { before: structuredClone(node.data!) };
    const data = structuredClone(node.data!);
    const primData = data.primitive as { params: Record<string, unknown> };
    primData.params[key] = value;
    if (committed) {
      const before = scrub.current.before;
      scrub.current = null;
      doc.setNodeData(id, data, true); // final preview; command records without re-executing
      doc.history.pushWithoutExecute(new SetNodeDataCommand(id, data, before, `Edit ${prim.type}`));
    } else {
      doc.setNodeData(id, data, true);
    }
  };

  return (
    <Section title={`${prim.type} parameters`} bordered={false}>
      {/* mode-aware key list; defaults merged under stored params so params
          added after a node was saved still show up */}
      {visibleParams(prim).map((key) => {
        const merged = { ...primitiveDefaults[prim.type], ...prim.params } as Record<
          string,
          number | boolean
        >;
        const value = merged[key];
        const meta = paramMeta(key, prim.type);
        const label = meta.label ?? key;
        if (typeof value === "boolean") {
          return (
            <Field label={label} key={key}>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={value}
                onChange={(e) => setParam(key, e.target.checked, true)}
              />
            </Field>
          );
        }
        if (typeof value !== "number") return null;
        return (
          <Field label={label} key={key}>
            <NumberDrag
              value={value}
              step={meta.int ? 0.08 : 0.01}
              integer={meta.int}
              min={meta.min}
              max={meta.max}
              onChange={(v, committed) => setParam(key, v, committed)}
            />
          </Field>
        );
      })}
    </Section>
  );
}

export function MeshInfo({ meshId }: { meshId: Uuid }) {
  const mesh = meshRegistry.get(meshId);
  return (
    <Section title="Editable Mesh" bordered={false}>
      {mesh ? (
        <div className="flex gap-2">
          <span className="badge badge-xs badge-ghost">{mesh.vCount} pts</span>
          <span className="badge badge-xs badge-ghost">{mesh.edgeCount} edges</span>
          <span className="badge badge-xs badge-ghost">{mesh.fCount} polys</span>
        </div>
      ) : (
        <span className="text-error">mesh data missing</span>
      )}
    </Section>
  );
}
