import { useRef } from "react";
import type { TransformDTO, Uuid } from "@/types/core";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import { SetFlagsCommand, SetNodeDataCommand } from "@/core/history/commands/scene";
import { TransformDragSession } from "@/core/session/TransformDragSession";
import { useDocument } from "@/ui/hooks/DocumentContext";
import { useDocSlice } from "@/ui/hooks/useDocSlice";
import { Checkbox } from "@/ui/widgets/Checkbox";
import { NumberDrag } from "@/ui/widgets/NumberDrag";

const RAD = Math.PI / 180;

/** Attributes/inspector for the active selection: name, transform, primitive params. */
export function AttributesPanel() {
  const doc = useDocument();
  useDocSlice("scene");
  useDocSlice("selection");
  const id = doc.selection.active;
  if (!id || !doc.scene.has(id)) {
    return <div style={{ padding: 12, color: "var(--t-fg-dim)" }}>Nothing selected</div>;
  }
  return <NodeAttributes key={id} id={id} />;
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

  return (
    <div style={{ height: "100%", overflow: "auto", background: "var(--t-bg-panel)" }}>
      <div className="t-section">
        <div className="t-section-title">Object</div>
        <div className="t-row">
          <span className="t-row-label">Name</span>
          <span style={{ flex: 1 }}>{node.name}</span>
        </div>
        <div className="t-row">
          <span className="t-row-label">Visible</span>
          <Checkbox
            checked={node.visible}
            onChange={(v) => doc.history.run(new SetFlagsCommand(id, { visible: v }))}
          />
        </div>
      </div>

      <div className="t-section">
        <div className="t-section-title">Transform</div>
        {(["position", "rotation", "scale"] as const).map((field) => (
          <div className="t-row" key={field}>
            <span className="t-row-label">{field[0]!.toUpperCase() + field.slice(1)}</span>
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
      </div>

      {prim ? <PrimitiveParams id={id} prim={prim} /> : null}
    </div>
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
      doc.setNodeData(id, data, true); // final preview so command sees no-op execute
      doc.history.pushWithoutExecute(new SetNodeDataCommand(id, data, before, `Edit ${prim.type}`));
    } else {
      doc.setNodeData(id, data, true);
    }
  };

  return (
    <div className="t-section">
      <div className="t-section-title">{prim.type} parameters</div>
      {Object.entries(prim.params).map(([key, value]) => (
        <div className="t-row" key={key}>
          <span className="t-row-label">{key}</span>
          {typeof value === "boolean" ? (
            <Checkbox checked={value} onChange={(v) => setParam(key, v, true)} />
          ) : (
            <NumberDrag
              value={value}
              step={
                key.toLowerCase().includes("seg") || key.includes("subdiv") || key.includes("Rings")
                  ? 0.05
                  : 0.01
              }
              min={0}
              onChange={(v, committed) => setParam(key, v, committed)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
