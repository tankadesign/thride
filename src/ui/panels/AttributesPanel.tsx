import { useEffect, useRef } from "react";
import type { ComponentMode, TransformDTO, Uuid } from "@/types/core";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import { paramMeta, primitiveDefaults, visibleParams } from "@/types/geometry/primitives";
import { LIGHT_LABELS, type LightDataDTO, SHADOW_CAPABLE } from "@/types/core/light";
import type { GeneratorDescriptor } from "@/generators/graph";
import type { SplinePrimitive } from "@/types/geometry/spline";
import { buildSplinePrimitive } from "@/geometry/splines/primitives";
import { ComponentTransformSession } from "@/geometry/commands/meshEdit";
import { vertexCentroid, vertexExtents, vertsForSelection } from "@/geometry/kernel/components";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import {
  RenameNodeCommand,
  SetFlagsCommand,
  SetNodeDataCommand,
  SetTransformCommand,
} from "@/core/history/commands/scene";
import { TransformDragSession } from "@/core/session/TransformDragSession";
import { appStore, useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { useSelectionInfo } from "@/ui/hooks/doc/selection";
import { targetRotationBakerAtom } from "@/ui/hooks/editor/viewport";
import { NumberDrag } from "@/ui/widgets/NumberDrag";

const RAD = Math.PI / 180;

const MODE_TITLE: Record<ComponentMode, string> = {
  point: "Points",
  edge: "Edges",
  polygon: "Polygons",
};

/**
 * Attributes/inspector. Object mode shows the node's settings; component
 * modes lock the panel to that mode's selection (XYZ/WHD only) and retitle
 * the dock tab to Points / Edges / Polygons.
 */
export function AttributesPanel({ panelApi }: { panelApi?: { setTitle(title: string): void } }) {
  const doc = useDocument();
  useSliceVersion("scene");
  const { active, editMode } = useSelectionInfo();
  const componentMode =
    editMode === "point" || editMode === "edge" || editMode === "polygon" ? editMode : null;
  const title = componentMode ? MODE_TITLE[componentMode] : "Attributes";
  useEffect(() => {
    panelApi?.setTitle(title);
  }, [panelApi, title]);

  if (componentMode) {
    const meshRef =
      active && doc.scene.has(active)
        ? (doc.scene.mustGet(active).data?.mesh as { id: Uuid } | undefined)
        : undefined;
    if (!active || !meshRef) {
      return (
        <div className="h-full bg-base-100 p-3 text-xs opacity-50">No editable mesh selected</div>
      );
    }
    return (
      <div className="h-full overflow-auto bg-base-100 text-xs">
        <ComponentSection id={active} meshId={meshRef.id} mode={componentMode} />
      </div>
    );
  }

  if (!active || !doc.scene.has(active)) {
    return <div className="h-full bg-base-100 p-3 text-xs opacity-50">Nothing selected</div>;
  }
  return <NodeAttributes key={active} id={active} />;
}

function NodeAttributes({ id }: { id: Uuid }) {
  const doc = useDocument();
  const node = doc.scene.mustGet(id);
  const scrubbing = useRef(false);

  /** NumberDrag scrubs stream (committed=false…true); route through a session. */
  const setTransform = (mutate: (t: TransformDTO) => void, committed: boolean) => {
    if (!scrubbing.current) {
      doc.sessions.start(new TransformDragSession([id]));
      scrubbing.current = true;
    }
    const t = structuredClone(doc.scene.mustGet(id).transform);
    mutate(t);
    doc.sessions.update(new Map([[id, t]]));
    if (committed) {
      doc.sessions.commit();
      scrubbing.current = false;
    }
  };

  const t = node.transform;
  const axes = ["X", "Y", "Z"] as const;
  const prim = node.data?.primitive as PrimitiveDescriptor | undefined;
  const splinePrim = node.data?.splinePrimitive as SplinePrimitive | undefined;
  const meshRef = node.data?.mesh as { id: Uuid } | undefined;
  const light = node.data?.light as LightDataDTO | undefined;
  const generator = node.data?.generator as GeneratorDescriptor | undefined;

  return (
    <div className="h-full overflow-auto bg-base-100 text-xs">
      <fieldset className="fieldset border-b border-base-200 px-2 py-1.5">
        <legend className="fieldset-legend py-1 text-[10px] uppercase opacity-60">Object</legend>
        <div className="grid grid-cols-[64px_1fr] items-center gap-1">
          <span className="opacity-60">Name</span>
          <input
            key={node.name}
            className="input input-ghost input-xs w-full"
            defaultValue={node.name}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== node.name) {
                doc.history.run(new RenameNodeCommand(id, e.target.value));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              e.stopPropagation();
            }}
          />
          <span className="opacity-60">Visible</span>
          <input
            type="checkbox"
            className="toggle toggle-xs"
            checked={node.visible}
            onChange={(e) =>
              doc.history.run(new SetFlagsCommand(id, { visible: e.target.checked }))
            }
          />
        </div>
      </fieldset>

      <fieldset className="fieldset border-b border-base-200 px-2 py-1.5">
        <legend className="fieldset-legend py-1 text-[10px] uppercase opacity-60">Transform</legend>
        {(["position", "rotation", "scale"] as const).map((field) => (
          <div className="grid grid-cols-[64px_1fr_1fr_1fr] items-center gap-1" key={field}>
            <span className="capitalize opacity-60">{field}</span>
            {axes.map((axis, i) => (
              <NumberDrag
                key={axis}
                label={axis}
                step={field === "rotation" ? 0.5 : field === "scale" ? 0.005 : 0.01}
                value={field === "rotation" ? t[field][i]! / RAD : t[field][i]!}
                onChange={(v, committed) =>
                  setTransform((tt) => {
                    tt[field][i] = field === "rotation" ? v * RAD : v;
                  }, committed)
                }
              />
            ))}
          </div>
        ))}
      </fieldset>

      {prim ? <PrimitiveParams id={id} prim={prim} /> : null}
      {splinePrim ? <SplinePrimitiveParams id={id} prim={splinePrim} /> : null}
      {generator ? <GeneratorParams id={id} gen={generator} /> : null}
      {meshRef ? <MeshInfo meshId={meshRef.id} /> : null}
      {light ? <LightParams id={id} light={light} /> : null}
      {node.kind === "light" || node.kind === "camera" ? <TargetSelector id={id} /> : null}
    </div>
  );
}

interface ComponentScrub {
  indices: number[];
  begin: Float32Array; // packed xyz at scrub start
  centroid: [number, number, number];
  extent: [number, number, number];
}

/**
 * Numeric editing for the current component selection (object-space coords).
 * The selection acts as ONE: XYZ shows a single point's exact position or
 * the selection centroid (edits translate rigidly); W/H/D shows the
 * selection's bounding box (edits scale about the centroid — typing 0
 * flattens the selection onto that axis). One undo step per edit/scrub;
 * all math runs off a scrub-start snapshot so repeated keystrokes and
 * degenerate extents stay exact.
 */
function ComponentSection({ id, meshId, mode }: { id: Uuid; meshId: Uuid; mode: ComponentMode }) {
  const doc = useDocument();
  const scrub = useRef<ComponentScrub | null>(null);
  const mesh = meshRegistry.get(meshId);
  const sel = mesh ? doc.selection.componentsFor(id, mode) : undefined;
  const valid = mesh && sel && sel.topologyVersion === mesh.topologyVersion ? sel : null;
  const count = valid?.bits.count ?? 0;
  if (!mesh) return null;
  const verts = valid ? vertsForSelection(mesh, mode, valid.bits) : [];
  const centroid = vertexCentroid(mesh, verts);
  const extent = vertexExtents(mesh, verts);

  const beginScrub = (label: string): ComponentScrub => {
    if (scrub.current) return scrub.current;
    const begin = new Float32Array(verts.length * 3);
    for (let i = 0; i < verts.length; i++) {
      for (let a = 0; a < 3; a++) begin[i * 3 + a] = mesh.vPos[verts[i]! * 3 + a]!;
    }
    scrub.current = { indices: verts, begin, centroid, extent };
    doc.sessions.start(new ComponentTransformSession(id, meshId, verts, label));
    return scrub.current;
  };

  const finish = (committed: boolean) => {
    if (committed) {
      doc.sessions.commit();
      scrub.current = null;
    }
  };

  /** Translate rigidly so the centroid's `axis` lands on the typed value. */
  const setAxis = (axis: 0 | 1 | 2, v: number, committed: boolean) => {
    if (verts.length === 0) return;
    const s = beginScrub("Move Components");
    const delta = v - s.centroid[axis];
    const out = new Float32Array(s.begin.length);
    for (let i = 0; i < s.indices.length; i++) {
      for (let a = 0; a < 3; a++) {
        out[i * 3 + a] = s.begin[i * 3 + a]! + (a === axis ? delta : 0);
      }
    }
    doc.sessions.update(out);
    finish(committed);
  };

  /** Scale about the centroid so the bbox `axis` extent hits the typed value. */
  const setSize = (axis: 0 | 1 | 2, v: number, committed: boolean) => {
    if (verts.length === 0) return;
    const s = beginScrub("Scale Components");
    const base = s.extent[axis];
    // a degenerate (flat) axis has no direction to expand along — no-op;
    // 0 / base flattens the selection onto the centroid plane exactly
    const ratio = base < 1e-9 ? 1 : Math.max(0, v) / base;
    const out = new Float32Array(s.begin.length);
    for (let i = 0; i < s.indices.length; i++) {
      for (let a = 0; a < 3; a++) {
        const p = s.begin[i * 3 + a]!;
        out[i * 3 + a] = a === axis ? s.centroid[a]! + (p - s.centroid[a]!) * ratio : p;
      }
    }
    doc.sessions.update(out);
    finish(committed);
  };

  return (
    <fieldset className="fieldset border-b border-base-200 px-2 py-1.5">
      <legend className="fieldset-legend py-1 text-[10px] uppercase opacity-60">
        {count} Selected
      </legend>
      {count === 0 ? (
        <p className="opacity-50">Nothing selected — click components in the viewport.</p>
      ) : (
        <>
          <div className="grid grid-cols-[64px_1fr_1fr_1fr] items-center gap-1">
            <span className="opacity-60">{verts.length > 1 ? "Centroid" : "Position"}</span>
            {([0, 1, 2] as const).map((axis) => (
              <NumberDrag
                key={axis}
                label={"XYZ"[axis]}
                step={0.01}
                value={centroid[axis]}
                onChange={(v, committed) => setAxis(axis, v, committed)}
              />
            ))}
          </div>
          {verts.length > 1 ? (
            <div className="grid grid-cols-[64px_1fr_1fr_1fr] items-center gap-1">
              <span className="opacity-60">Size</span>
              {([0, 1, 2] as const).map((axis) => (
                <NumberDrag
                  key={axis}
                  label={"WHD"[axis]}
                  step={0.01}
                  min={0}
                  value={extent[axis]}
                  onChange={(v, committed) => setSize(axis, v, committed)}
                />
              ))}
            </div>
          ) : null}
        </>
      )}
    </fieldset>
  );
}

/** Light payload editor: color, intensity, shadows, type-specific params. */
function LightParams({ id, light }: { id: Uuid; light: LightDataDTO }) {
  const doc = useDocument();
  const scrub = useRef<{ before: Record<string, unknown> } | null>(null);

  const setLight = (patch: Partial<LightDataDTO>, committed: boolean) => {
    const node = doc.scene.mustGet(id);
    scrub.current ??= { before: structuredClone(node.data!) };
    const data = structuredClone(node.data!);
    data.light = { ...(data.light as LightDataDTO), ...patch };
    if (committed) {
      const before = scrub.current.before;
      scrub.current = null;
      doc.setNodeData(id, data, true);
      doc.history.pushWithoutExecute(new SetNodeDataCommand(id, data, before, "Edit Light"));
    } else {
      doc.setNodeData(id, data, true);
    }
  };

  const numeric = (label: string, key: keyof LightDataDTO, step = 0.02, max?: number) => (
    <div className="grid grid-cols-[64px_1fr] items-center gap-1" key={key}>
      <span className="opacity-60">{label}</span>
      <NumberDrag
        value={(light[key] as number) ?? 0}
        step={step}
        min={0}
        max={max}
        onChange={(v, committed) => setLight({ [key]: v }, committed)}
      />
    </div>
  );

  return (
    <fieldset className="fieldset border-b border-base-200 px-2 py-1.5">
      <legend className="fieldset-legend py-1 text-[10px] uppercase opacity-60">
        {LIGHT_LABELS[light.type]} Light
      </legend>
      <div className="grid grid-cols-[64px_1fr] items-center gap-1">
        <span className="opacity-60">Color</span>
        <input
          type="color"
          className="h-6 w-12 cursor-pointer rounded border border-base-300 bg-base-100"
          value={light.color}
          onChange={(e) => setLight({ color: e.target.value }, true)}
        />
      </div>
      {numeric("Intensity", "intensity", 0.05)}
      {light.type === "spot" ? numeric("Angle", "angle", 0.005, Math.PI / 2) : null}
      {light.type === "spot" ? numeric("Penumbra", "penumbra", 0.005, 1) : null}
      {light.type === "area" ? numeric("Width", "width") : null}
      {light.type === "area" ? numeric("Height", "height") : null}
      {light.type === "hemisphere" ? (
        <div className="grid grid-cols-[64px_1fr] items-center gap-1">
          <span className="opacity-60">Ground</span>
          <input
            type="color"
            className="h-6 w-12 cursor-pointer rounded border border-base-300 bg-base-100"
            value={light.groundColor ?? "#443c30"}
            onChange={(e) => setLight({ groundColor: e.target.value }, true)}
          />
        </div>
      ) : null}
      {SHADOW_CAPABLE.has(light.type) ? (
        <div className="grid grid-cols-[64px_1fr] items-center gap-1">
          <span className="opacity-60">Shadows</span>
          <input
            type="checkbox"
            className="toggle toggle-xs"
            checked={light.castShadow ?? true}
            onChange={(e) => setLight({ castShadow: e.target.checked }, true)}
          />
        </div>
      ) : null}
    </fieldset>
  );
}

/** Aim target: any other object controls this node's rotation. */
function TargetSelector({ id }: { id: Uuid }) {
  const doc = useDocument();
  const node = doc.scene.mustGet(id);
  const target = (node.data?.target as Uuid | undefined) ?? "";
  const candidates = doc.scene.toDTO().filter((n) => n.id !== id);

  const setTarget = (value: string) => {
    const before = structuredClone(node.data ?? {});
    const data = structuredClone(node.data ?? {});
    if (value) {
      data.target = value;
      doc.history.run(new SetNodeDataCommand(id, data, before, "Set Target"));
      return;
    }
    // Clearing a target: bake the orientation the object is CURRENTLY showing
    // (from following the target) into its transform so it keeps its PSR
    // instead of snapping back to the pre-target rotation. Position/scale are
    // untouched — a look-at constraint only ever drove rotation.
    delete data.target;
    const baked = appStore.get(targetRotationBakerAtom)?.bake(id) ?? null;
    if (!baked) {
      doc.history.run(new SetNodeDataCommand(id, data, before, "Clear Target"));
      return;
    }
    const beforeT = structuredClone(node.transform);
    const afterT: TransformDTO = { ...structuredClone(node.transform), rotation: baked };
    doc.history.transact("Clear Target", () => {
      doc.history.run(new SetTransformCommand(id, afterT, beforeT));
      doc.history.run(new SetNodeDataCommand(id, data, before, "Clear Target"));
    });
  };

  return (
    <fieldset className="fieldset px-2 py-1.5">
      <legend className="fieldset-legend py-1 text-[10px] uppercase opacity-60">Target</legend>
      <select
        className="select select-xs w-full"
        value={target as string}
        onChange={(e) => setTarget(e.target.value)}
      >
        <option value="">None</option>
        {candidates.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>
    </fieldset>
  );
}

function MeshInfo({ meshId }: { meshId: Uuid }) {
  const mesh = meshRegistry.get(meshId);
  return (
    <fieldset className="fieldset px-2 py-1.5">
      <legend className="fieldset-legend py-1 text-[10px] uppercase opacity-60">
        Editable Mesh
      </legend>
      {mesh ? (
        <div className="flex gap-2">
          <span className="badge badge-xs badge-ghost">{mesh.vCount} pts</span>
          <span className="badge badge-xs badge-ghost">{mesh.edgeCount} edges</span>
          <span className="badge badge-xs badge-ghost">{mesh.fCount} polys</span>
        </div>
      ) : (
        <span className="text-error">mesh data missing</span>
      )}
    </fieldset>
  );
}

/** Generator parameter sliders (Spline Extrude: live depth/bevel/caps). */
function GeneratorParams({ id, gen }: { id: Uuid; gen: GeneratorDescriptor }) {
  const doc = useDocument();
  const scrub = useRef<{ before: Record<string, unknown> } | null>(null);

  const setParam = (key: string, value: number | boolean | string, committed: boolean) => {
    const node = doc.scene.mustGet(id);
    scrub.current ??= { before: structuredClone(node.data!) };
    const data = structuredClone(node.data!);
    (data.generator as unknown as { params: Record<string, unknown> }).params[key] = value;
    if (committed) {
      const before = scrub.current.before;
      scrub.current = null;
      doc.setNodeData(id, data, true);
      doc.history.pushWithoutExecute(new SetNodeDataCommand(id, data, before, "Edit Generator"));
    } else {
      doc.setNodeData(id, data, true);
    }
  };

  if (gen.type === "boolean") {
    return (
      <fieldset className="fieldset px-2 py-1.5">
        <legend className="fieldset-legend py-1 text-[10px] uppercase opacity-60">Boolean</legend>
        <div className="grid grid-cols-[64px_1fr] items-center gap-1">
          <span className="opacity-60">Operation</span>
          <select
            className="select select-xs"
            value={gen.params.op}
            onChange={(e) => setParam("op", e.target.value, true)}
          >
            <option value="union">Union (A ∪ B)</option>
            <option value="subtract">Subtract (A − B)</option>
            <option value="intersect">Intersect (A ∩ B)</option>
          </select>
        </div>
        <p className="mt-1 text-[10px] opacity-50">First two mesh children are A and B.</p>
      </fieldset>
    );
  }

  if (gen.type === "sweep") {
    const sp = gen.params as unknown as Record<string, number>;
    const sweepRows = [
      { key: "pathSegments", label: "Path Segs", min: 2, max: 512 },
      { key: "profileSegments", label: "Profile Segs", min: 3, max: 256 },
    ];
    return (
      <fieldset className="fieldset px-2 py-1.5">
        <legend className="fieldset-legend py-1 text-[10px] uppercase opacity-60">Sweep</legend>
        {sweepRows.map((row) => (
          <div className="grid grid-cols-[64px_1fr] items-center gap-1" key={row.key}>
            <span className="truncate opacity-60" title={row.label}>
              {row.label}
            </span>
            <NumberDrag
              value={sp[row.key] ?? 0}
              step={1}
              integer
              min={row.min}
              max={row.max}
              onChange={(v, committed) => setParam(row.key, v, committed)}
            />
          </div>
        ))}
        <p className="mt-1 text-[10px] opacity-50">Children: 1st = profile, 2nd = path.</p>
      </fieldset>
    );
  }
  const p = gen.params as unknown as Record<string, number | boolean>;
  const rows: { key: string; label: string; int?: boolean; min?: number; max?: number }[] = [
    { key: "depth", label: "Depth", min: 0.001 },
    { key: "heightSegments", label: "Height Segs", int: true, min: 1, max: 64 },
    { key: "bevelSize", label: "Bevel Size", min: 0 },
    { key: "bevelSegments", label: "Bevel Segs", int: true, min: 1, max: 8 },
  ];
  return (
    <fieldset className="fieldset px-2 py-1.5">
      <legend className="fieldset-legend py-1 text-[10px] uppercase opacity-60">
        Spline Extrude
      </legend>
      {rows.map((row) => (
        <div className="grid grid-cols-[64px_1fr] items-center gap-1" key={row.key}>
          <span className="truncate opacity-60" title={row.label}>
            {row.label}
          </span>
          <NumberDrag
            value={(p[row.key] as number) ?? 0}
            step={row.int ? 0.08 : 0.005}
            integer={row.int}
            min={row.min}
            max={row.max}
            onChange={(v, committed) => setParam(row.key, v, committed)}
          />
        </div>
      ))}
      <div className="grid grid-cols-[64px_1fr] items-center gap-1">
        <span className="opacity-60">Caps</span>
        <input
          type="checkbox"
          className="toggle toggle-xs"
          checked={(p.caps as boolean) ?? true}
          onChange={(e) => setParam("caps", e.target.checked, true)}
        />
      </div>
    </fieldset>
  );
}

interface SplinePrimRow {
  key: string;
  label: string;
  int?: boolean;
  min?: number;
  max?: number;
  step?: number;
}

const SPLINE_PRIM_ROWS: Record<SplinePrimitive["type"], SplinePrimRow[]> = {
  circle: [{ key: "radius", label: "Radius", min: 0.001 }],
  nside: [
    { key: "sides", label: "Sides", int: true, min: 2, max: 1000, step: 1 },
    { key: "radius", label: "Radius", min: 0.001 },
    { key: "rounding", label: "Rounding", int: true, min: 0, max: 1000, step: 5 },
  ],
  star: [
    { key: "points", label: "Points", int: true, min: 2, max: 1000, step: 1 },
    { key: "innerRadius", label: "Inner R", min: 0.001 },
    { key: "outerRadius", label: "Outer R", min: 0.001 },
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
function SplinePrimitiveParams({ id, prim }: { id: Uuid; prim: SplinePrimitive }) {
  const doc = useDocument();
  const scrub = useRef<{ before: Record<string, unknown> } | null>(null);

  const setParam = (key: string, value: number, committed: boolean) => {
    const node = doc.scene.mustGet(id);
    scrub.current ??= { before: structuredClone(node.data!) };
    const data = structuredClone(node.data!);
    const recipe = data.splinePrimitive as unknown as Record<string, number | string>;
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

  const values = prim as unknown as Record<string, number>;
  return (
    <fieldset className="fieldset px-2 py-1.5">
      <legend className="fieldset-legend py-1 text-[10px] uppercase opacity-60">
        {prim.type} parameters
      </legend>
      {SPLINE_PRIM_ROWS[prim.type].map((row) => (
        <div className="grid grid-cols-[64px_1fr] items-center gap-1" key={row.key}>
          <span className="truncate opacity-60" title={row.label}>
            {row.label}
          </span>
          <NumberDrag
            value={values[row.key] ?? 0}
            step={row.step ?? (row.int ? 0.08 : 0.01)}
            integer={row.int}
            min={row.min}
            max={row.max}
            onChange={(v, committed) => setParam(row.key, v, committed)}
          />
        </div>
      ))}
    </fieldset>
  );
}

function PrimitiveParams({ id, prim }: { id: Uuid; prim: PrimitiveDescriptor }) {
  const doc = useDocument();
  const scrub = useRef<{ before: Record<string, unknown> } | null>(null);

  const setParam = (key: string, value: number | boolean, committed: boolean) => {
    const node = doc.scene.mustGet(id);
    scrub.current ??= { before: structuredClone(node.data!) };
    const data = structuredClone(node.data!);
    const primData = data.primitive as unknown as { params: Record<string, unknown> };
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
    <fieldset className="fieldset px-2 py-1.5">
      <legend className="fieldset-legend py-1 text-[10px] uppercase opacity-60">
        {prim.type} parameters
      </legend>
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
            <div className="grid grid-cols-[64px_1fr] items-center gap-1" key={key}>
              <span className="truncate opacity-60" title={label}>
                {label}
              </span>
              <input
                type="checkbox"
                className="toggle toggle-xs"
                checked={value}
                onChange={(e) => setParam(key, e.target.checked, true)}
              />
            </div>
          );
        }
        if (typeof value !== "number") return null;
        return (
          <div className="grid grid-cols-[64px_1fr] items-center gap-1" key={key}>
            <span className="truncate opacity-60" title={label}>
              {label}
            </span>
            <NumberDrag
              value={value}
              step={meta.int ? 0.08 : 0.01}
              integer={meta.int}
              min={meta.min}
              max={meta.max}
              onChange={(v, committed) => setParam(key, v, committed)}
            />
          </div>
        );
      })}
    </fieldset>
  );
}
