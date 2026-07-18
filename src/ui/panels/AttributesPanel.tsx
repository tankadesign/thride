import { useEffect, useRef } from "react";
import type {
  ComponentMode,
  NodeKind,
  PlanarReflectionDTO,
  TransformDTO,
  Uuid,
} from "@/types/core";
import { defaultPlanarReflection } from "@/types/core";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import { paramMeta, primitiveDefaults, visibleParams } from "@/types/geometry/primitives";
import {
  LIGHT_LABELS,
  type LightDataDTO,
  SHADOW_CAPABLE,
  type ShadowResolution,
} from "@/types/core/light";
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
import { IconCaretDown } from "@/icons";
import { appStore, useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { useSelectionInfo } from "@/ui/hooks/doc/selection";
import { targetRotationBakerAtom } from "@/ui/hooks/editor/viewport";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { ColorPicker } from "../widgets/ColorPicker";

const RAD = Math.PI / 180;

const MODE_TITLE: Record<ComponentMode, string> = {
  point: "Points",
  edge: "Edges",
  polygon: "Polygons",
};

/** Node kinds that render as triangle meshes and can take a library material. */
const MATERIAL_CAPABLE = new Set<NodeKind>(["mesh", "generator"]);

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
      <fieldset className="fieldset border-b border-base-200 px-2 pt-1.5 pb-6">
        <legend className="fieldset-legend py-2 text-[10px] uppercase opacity-60">Object</legend>
        <div className="grid grid-cols-[96px_1fr] items-center gap-1">
          <span className="opacity-60">Name</span>
          <input
            key={node.name}
            className="input input-sm w-full transition-colors ease-out duration-300 focus:input-primary outline-none focus:text-primary selection:bg-primary/30"
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
        </div>
        <div className="grid grid-cols-[96px_1fr] items-center gap-1 pt-2">
          <span className="opacity-60">Visible</span>
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={node.visible}
            onChange={(e) =>
              doc.history.run(new SetFlagsCommand(id, { visible: e.target.checked }))
            }
          />
        </div>
      </fieldset>

      <fieldset className="fieldset border-b border-base-200 px-2 pt-1.5 pb-6">
        <legend className="fieldset-legend py-2 text-[10px] uppercase opacity-60">Transform</legend>
        {(["position", "rotation", "scale"] as const).map((field) => (
          <div className="grid grid-cols-[96px_1fr_1fr_1fr] items-center gap-1" key={field}>
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
      {MATERIAL_CAPABLE.has(node.kind) ? <MaterialSelector id={id} /> : null}
      {MATERIAL_CAPABLE.has(node.kind) ? (
        <PlanarReflectionSection
          id={id}
          planar={node.data?.planar as PlanarReflectionDTO | undefined}
        />
      ) : null}
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
    <fieldset className="fieldset border-b border-base-200 px-2 pt-1.5 pb-6">
      <legend className="fieldset-legend py-2 text-[10px] uppercase opacity-60">
        {count} Selected
      </legend>
      {count === 0 ? (
        <p className="opacity-50">Nothing selected — click components in the viewport.</p>
      ) : (
        <>
          <div className="grid grid-cols-[96px_1fr_1fr_1fr] items-center gap-1">
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
            <>
              <div className="grid grid-cols-[96px_1fr_1fr_1fr] items-center gap-1">
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
            </>
          ) : null}
        </>
      )}
    </fieldset>
  );
}

/** Light payload editor: color, intensity, shadows, type-specific params. */
/**
 * Planar (mirrored-camera) reflection on a flat surface — exact mirror that
 * shows occluded geometry (unlike SSR). Per-object; the mirror plane passes
 * through the object origin along the chosen local axis.
 */
function PlanarReflectionSection({ id, planar }: { id: Uuid; planar?: PlanarReflectionDTO }) {
  const doc = useDocument();
  const scrub = useRef<{ before: Record<string, unknown> } | null>(null);

  const setPlanar = (patch: Partial<PlanarReflectionDTO> | null, committed: boolean) => {
    const node = doc.scene.mustGet(id);
    scrub.current ??= { before: structuredClone(node.data ?? {}) };
    const data = structuredClone(node.data ?? {});
    if (patch === null) delete data.planar;
    else data.planar = { ...defaultPlanarReflection(), ...(data.planar ?? {}), ...patch };
    if (committed) {
      const before = scrub.current.before;
      scrub.current = null;
      doc.setNodeData(id, data, true);
      doc.history.pushWithoutExecute(new SetNodeDataCommand(id, data, before, "Planar Reflection"));
    } else {
      doc.setNodeData(id, data, true);
    }
  };

  return (
    <>
      <div className="divider my-0 h-3"></div>
      <fieldset className="fieldset border-b border-base-200 px-2 pt-1.5 pb-6">
        <legend className="fieldset-legend py-2 text-[10px] uppercase opacity-60">
          Planar Reflection
        </legend>
        <div className="grid grid-cols-[96px_1fr] items-center gap-1">
          <span className="opacity-60">Enabled</span>
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={!!planar}
            onChange={(e) => setPlanar(e.target.checked ? {} : null, true)}
          />
          {planar ? (
            <>
              <span className="opacity-60">Axis</span>
              <select
                className="select select-md w-full"
                value={planar.axis}
                onChange={(e) =>
                  setPlanar({ axis: e.target.value as PlanarReflectionDTO["axis"] }, true)
                }
              >
                <option value="y">Y (floor)</option>
                <option value="x">X (wall)</option>
                <option value="z">Z (wall)</option>
              </select>
              <span className="opacity-60">Strength</span>
              <NumberDrag
                value={planar.strength}
                step={0.02}
                min={0}
                max={1}
                onChange={(v, committed) => setPlanar({ strength: v }, committed)}
              />
              <span className="opacity-60">Resolution</span>
              <NumberDrag
                value={planar.resolution}
                step={0.05}
                min={0.25}
                max={1}
                onChange={(v, committed) => setPlanar({ resolution: v }, committed)}
              />
            </>
          ) : null}
        </div>
      </fieldset>
    </>
  );
}

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
    <div className="grid grid-cols-[96px_1fr] items-center gap-1" key={key}>
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
    <fieldset className="fieldset border-b border-base-200 px-2 pt-1.5 pb-6">
      <legend className="fieldset-legend py-2 text-[10px] uppercase opacity-60">
        {LIGHT_LABELS[light.type]} Light
      </legend>
      <div className="grid grid-cols-[96px_1fr] items-center gap-1">
        <span className="opacity-60">Color</span>
        <span
          className="block w-10 h-10 rounded-full outline-transparent outline-offset-1 has-[input:focus]:outline-1 has-[input:focus]:outline-primary"
          style={{ backgroundColor: light.color }}
        >
          <ColorPicker
            color={light.color}
            onChange={(e) => setLight({ color: e.target.value }, true)}
          />
        </span>
      </div>
      {numeric("Intensity", "intensity", 0.05)}
      {light.type === "spot" ? numeric("Angle", "angle", 0.005, Math.PI / 2) : null}
      {light.type === "spot" ? numeric("Penumbra", "penumbra", 0.005, 1) : null}
      {light.type === "area" ? numeric("Width", "width") : null}
      {light.type === "area" ? numeric("Height", "height") : null}
      {light.type === "hemisphere" ? (
        <div className="grid grid-cols-[96px_1fr] items-center gap-1">
          <span className="opacity-60">Ground</span>
          <ColorPicker
            color={light.groundColor ?? "#443c30"}
            onChange={(e) => setLight({ groundColor: e.target.value }, true)}
          />
        </div>
      ) : null}
      {SHADOW_CAPABLE.has(light.type) ? (
        <div className="grid grid-cols-[96px_1fr] items-center gap-1">
          <span className="opacity-60">Shadows</span>
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={light.castShadow ?? true}
            onChange={(e) => setLight({ castShadow: e.target.checked }, true)}
          />
        </div>
      ) : null}
      {SHADOW_CAPABLE.has(light.type) && (light.castShadow ?? true) ? (
        <>
          <div className="grid grid-cols-[96px_1fr] items-center gap-1">
            <span className="opacity-60">Quality</span>
            <select
              className="select select-md"
              value={light.shadowResolution ?? "normal"}
              onChange={(e) =>
                setLight({ shadowResolution: e.target.value as ShadowResolution }, true)
              }
            >
              <option value="low">Low (1k)</option>
              <option value="normal">Normal (2k)</option>
              <option value="high">High (4k)</option>
            </select>
          </div>
          {numeric("Blur", "shadowBlur", 0.1, 20)}
          {numeric("Size", "shadowSize", 0.5, 400)}
        </>
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
    <fieldset className="fieldset px-2 pt-1.5 pb-6">
      <legend className="fieldset-legend py-2 text-[10px] uppercase opacity-60">Target</legend>
      <select
        className="select select-md w-full"
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

/** Color chip for a material: base color fill with a subtle white ring (12px radius). */
function Swatch({ color }: { color: string }) {
  return (
    <span className="relative overflow-hidden rounded-full inline-block">
      <span
        className="block shrink-0 border border-white/30"
        style={{ width: "14px", height: "14px", backgroundColor: color }}
      />
      <span className="absolute block w-4 h-4 left-1 -top-0.5 inset-0 rounded-full bg-radial from-white/60 to-white/0" />
    </span>
  );
}

/**
 * Assign a library material to a triangle-mesh object (or None to unset).
 * Custom dropdown (not a native select) so each entry can show the material's
 * base-color swatch. One undo step per change; a dangling id reads as None.
 */
function MaterialSelector({ id }: { id: Uuid }) {
  const doc = useDocument();
  useSliceVersion("materials"); // re-render on library add/rename/recolor
  const node = doc.scene.mustGet(id);
  const materials = doc.materials.all();
  const currentId = node.data?.material as Uuid | undefined;
  const current = currentId ? doc.materials.get(currentId) : undefined;

  const assign = (matId: Uuid | null) => {
    const before = structuredClone(node.data ?? {});
    const data = structuredClone(node.data ?? {});
    if (matId) data.material = matId;
    else delete data.material;
    doc.history.run(
      new SetNodeDataCommand(id, data, before, matId ? "Assign Material" : "Clear Material"),
    );
    (document.activeElement as HTMLElement | null)?.blur(); // close the dropdown
  };

  return (
    <fieldset className="fieldset border-b border-base-200 px-2 pt-1.5 pb-6">
      <div className="fieldset-legend py-2 inline-block text-[10px] uppercase opacity-60">
        Material
      </div>
      {/* opens upward: the Material section sits at the panel bottom, and the
          panel's overflow would otherwise clip a downward menu off-screen */}
      <div className="dropdown dropdown-top w-full">
        <div
          tabIndex={0}
          role="button"
          className="btn btn-md btn-block justify-between font-normal border-base-content/20 bg-transparent"
        >
          <span className="flex min-w-0 items-center gap-2 py-4">
            {current ? <Swatch color={current.color} /> : null}
            <span className="truncate">{current ? current.name : "None"}</span>
          </span>
          <IconCaretDown size={12} className="opacity-50" />
        </div>
        <ul
          tabIndex={0}
          className="dropdown-content menu menu-xs z-10 mt-1 max-h-60 w-full flex-nowrap overflow-auto rounded-box border border-base-300 bg-base-200 shadow-lg"
        >
          <li>
            <button type="button" className={current ? "" : "active"} onClick={() => assign(null)}>
              None
            </button>
          </li>
          {materials.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className={m.id === currentId ? "active" : ""}
                onClick={() => assign(m.id)}
              >
                <Swatch color={m.color} />
                <span className="truncate">{m.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </fieldset>
  );
}

function MeshInfo({ meshId }: { meshId: Uuid }) {
  const mesh = meshRegistry.get(meshId);
  return (
    <fieldset className="fieldset px-2 pt-1.5 pb-6">
      <legend className="fieldset-legend py-2 text-[10px] uppercase opacity-60">
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
      <fieldset className="fieldset px-2 pt-1.5 pb-6">
        <legend className="fieldset-legend py-2 text-[10px] uppercase opacity-60">Boolean</legend>
        <div className="grid grid-cols-[96px_1fr] items-center gap-1">
          <span className="opacity-60">Operation</span>
          <select
            className="select select-md"
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
    const sp = gen.params as unknown as {
      pathSegments: number;
      profileSegments?: number;
      rotation?: number;
      usePathPoints?: boolean;
      invertNormals?: boolean;
    };
    const usePathPoints = sp.usePathPoints ?? true;
    return (
      <fieldset className="fieldset px-2 pt-1.5 pb-6">
        <legend className="fieldset-legend py-2 text-[10px] uppercase opacity-60">Sweep</legend>
        <div className="grid grid-cols-[96px_1fr] items-center gap-1">
          <span className="opacity-60">Rotation</span>
          <NumberDrag
            value={sp.rotation ?? 0}
            step={1}
            min={-360}
            max={360}
            onChange={(v, committed) => setParam("rotation", v, committed)}
          />
        </div>
        <div className="grid grid-cols-[96px_1fr] items-center gap-1">
          <span className="truncate opacity-60" title="Profile Segs">
            Profile Segs
          </span>
          <NumberDrag
            value={sp.profileSegments ?? 12}
            step={1}
            integer
            min={1}
            max={64}
            onChange={(v, committed) => setParam("profileSegments", v, committed)}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="opacity-60">Use path points</span>
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={usePathPoints}
            onChange={(e) => setParam("usePathPoints", e.target.checked, true)}
          />
        </div>
        {usePathPoints ? null : (
          <div className="grid grid-cols-[96px_1fr] items-center gap-1">
            <span className="truncate opacity-60" title="Path Segs">
              Path Segs
            </span>
            <NumberDrag
              value={sp.pathSegments ?? 48}
              step={1}
              integer
              min={2}
              max={512}
              onChange={(v, committed) => setParam("pathSegments", v, committed)}
            />
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="opacity-60">Invert Normals</span>
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={sp.invertNormals ?? false}
            onChange={(e) => setParam("invertNormals", e.target.checked, true)}
          />
        </div>
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
    <fieldset className="fieldset px-2 pt-1.5 pb-6">
      <legend className="fieldset-legend py-2 text-[10px] uppercase opacity-60">
        Spline Extrude
      </legend>
      {rows.map((row) => (
        <div className="grid grid-cols-[96px_1fr] items-center gap-1" key={row.key}>
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
      <div className="grid grid-cols-[96px_1fr] items-center gap-1">
        <span className="opacity-60">Caps</span>
        <input
          type="checkbox"
          className="toggle toggle-sm"
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
  bool?: boolean;
}

const SPLINE_PRIM_ROWS: Record<SplinePrimitive["type"], SplinePrimRow[]> = {
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
function SplinePrimitiveParams({ id, prim }: { id: Uuid; prim: SplinePrimitive }) {
  const doc = useDocument();
  const scrub = useRef<{ before: Record<string, unknown> } | null>(null);

  const setParam = (key: string, value: number | boolean, committed: boolean) => {
    const node = doc.scene.mustGet(id);
    scrub.current ??= { before: structuredClone(node.data!) };
    const data = structuredClone(node.data!);
    const recipe = data.splinePrimitive as unknown as Record<string, number | string | boolean>;
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
    <fieldset className="fieldset px-2 pt-1.5 pb-6">
      <legend className="fieldset-legend py-2 text-[10px] uppercase opacity-60">
        {prim.type} parameters
      </legend>
      {SPLINE_PRIM_ROWS[prim.type].map((row) => (
        <div className="grid grid-cols-[96px_1fr] items-center gap-1" key={row.key}>
          <span className="truncate opacity-60" title={row.label}>
            {row.label}
          </span>
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
    <fieldset className="fieldset px-2 pt-1.5 pb-6">
      <legend className="fieldset-legend py-2 text-[10px] uppercase opacity-60">
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
            <div className="grid grid-cols-[96px_1fr] items-center gap-1" key={key}>
              <span className="truncate opacity-60 capitalize" title={label}>
                {label}
              </span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={value}
                onChange={(e) => setParam(key, e.target.checked, true)}
              />
            </div>
          );
        }
        if (typeof value !== "number") return null;
        return (
          <div className="grid grid-cols-[96px_1fr] items-center gap-1" key={key}>
            <span className="truncate opacity-60 capitalize" title={label}>
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
