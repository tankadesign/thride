import { useRef } from "react";
import type { TransformDTO, Uuid } from "@/types/core";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import { paramMeta } from "@/types/geometry/primitives";
import { LIGHT_LABELS, type LightDataDTO, SHADOW_CAPABLE } from "@/types/core/light";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import {
  RenameNodeCommand,
  SetFlagsCommand,
  SetNodeDataCommand,
} from "@/core/history/commands/scene";
import { TransformDragSession } from "@/core/session/TransformDragSession";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { useSelectionInfo } from "@/ui/hooks/doc/selection";
import { NumberDrag } from "@/ui/widgets/NumberDrag";

const RAD = Math.PI / 180;

/** Attributes/inspector for the active selection: name, transform, primitive params. */
export function AttributesPanel() {
  const doc = useDocument();
  useSliceVersion("scene");
  const { active } = useSelectionInfo();
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
  const meshRef = node.data?.mesh as { id: Uuid } | undefined;
  const light = node.data?.light as LightDataDTO | undefined;

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
      {meshRef ? <MeshInfo meshId={meshRef.id} /> : null}
      {light ? <LightParams id={id} light={light} /> : null}
      {node.kind === "light" || node.kind === "camera" ? <TargetSelector id={id} /> : null}
    </div>
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
    if (value) data.target = value;
    else delete data.target;
    doc.history.run(new SetNodeDataCommand(id, data, before, "Set Target"));
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
      <p className="pt-1 opacity-50">Point/edge/polygon editing arrives with M1.</p>
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
      {Object.entries(prim.params).map(([key, value]) => {
        if (typeof value === "boolean") {
          return (
            <div className="grid grid-cols-[64px_1fr] items-center gap-1" key={key}>
              <span className="truncate opacity-60">{key}</span>
              <input
                type="checkbox"
                className="toggle toggle-xs"
                checked={value}
                onChange={(e) => setParam(key, e.target.checked, true)}
              />
            </div>
          );
        }
        const meta = paramMeta(key);
        return (
          <div className="grid grid-cols-[64px_1fr] items-center gap-1" key={key}>
            <span className="truncate opacity-60">{key}</span>
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
