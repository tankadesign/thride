import { useRef } from "react";
import { UpdateMaterialCommand } from "@/core";
import {
  BLEND_MODES,
  GRAPH_NODE_DEFS,
  type GraphNode,
  type GraphNodeKind,
  type MaterialDTO,
  type Uuid,
} from "@/types/core";
import { NOISE_DEFS, noiseDef } from "@/materials/noises";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { Field, Section } from "@/ui/widgets/inspector";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { RampEditor } from "@/ui/panels/materialEditor/RampEditor";

/**
 * Attributes editor for a material graph node (E7). The node editor handles
 * wiring only; every value — the shape-selecting dropdowns (structural), numeric
 * params (live uniforms), colours, and the ramp — is edited here with the same
 * inspector widgets and scrub-then-commit history pattern as the rest of the
 * panel. Reached by double-clicking a node in the node editor.
 */

/** Option list for a node's select (noise ids / blend modes / literal). */
function selectOptions(
  kind: GraphNodeKind,
  key: string,
  literal: { value: string; label: string }[],
) {
  if (kind === "noise") return NOISE_DEFS.map((d) => ({ value: d.id, label: d.label }));
  if (key === "blend") return BLEND_MODES.map((b) => ({ value: b.mode, label: b.label }));
  return literal;
}

export function GraphNodeAttributes({ materialId, nodeId }: { materialId: Uuid; nodeId: string }) {
  const doc = useDocument();
  useSliceVersion("materials");
  const scrub = useRef<{ before: MaterialDTO } | null>(null);

  const mat = doc.materials.get(materialId);
  const node = mat?.graph?.nodes.find((n) => n.id === nodeId);
  if (!mat || !node) {
    return <div className="h-full bg-base-100 p-3 text-xs opacity-50">Node not found.</div>;
  }
  const def = GRAPH_NODE_DEFS[node.kind];

  /** Patch this node; `committed` false = live scrub, true = one undo step. */
  const setNode = (patch: (n: GraphNode) => void, committed: boolean) => {
    const cur = doc.materials.get(materialId);
    if (!cur?.graph) return;
    scrub.current ??= { before: structuredClone(cur) };
    const nodes = cur.graph.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const copy = structuredClone(n);
      patch(copy);
      return copy;
    });
    const after = { ...cur, graph: { ...cur.graph, nodes } };
    doc.updateMaterial(after, !committed);
    if (committed) {
      const before = scrub.current.before;
      scrub.current = null;
      doc.history.pushWithoutExecute(new UpdateMaterialCommand(before, after, "Edit Node"));
    }
  };

  const numeric =
    node.kind === "noise" ? (noiseDef(node.select?.noise ?? "perlin")?.params ?? []) : def.params;
  const empty =
    def.selects.length === 0 && numeric.length === 0 && def.colors.length === 0 && !def.hasRamp;

  return (
    <div className="h-full overflow-auto bg-base-100 text-xs py-2">
      <Section title={`${def.label} Node`} bordered={false}>
        {def.selects.map((sel) => {
          const options = selectOptions(node.kind, sel.key, sel.options);
          const value = node.select?.[sel.key] ?? options[0]?.value ?? "";
          return (
            <Field key={sel.key} label={sel.label}>
              <select
                className="select select-sm w-full"
                value={value}
                onChange={(e) =>
                  setNode((n) => {
                    n.select = { ...n.select, [sel.key]: e.target.value };
                  }, true)
                }
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          );
        })}

        {numeric.map((p) => (
          <Field key={p.key} label={p.label}>
            <NumberDrag
              value={node.params?.[p.key] ?? p.default ?? 0}
              min={p.min}
              max={p.max}
              step={p.step}
              onChange={(v, committed) =>
                setNode((n) => {
                  n.params = { ...n.params, [p.key]: v };
                }, committed)
              }
            />
          </Field>
        ))}

        {def.colors.map((c) => (
          <Field key={c.key} label={c.label}>
            <input
              type="color"
              className="h-7 w-full cursor-pointer rounded border border-base-300 bg-transparent"
              value={node.colors?.[c.key] ?? "#808080"}
              onChange={(e) =>
                setNode((n) => {
                  n.colors = { ...n.colors, [c.key]: e.target.value };
                }, false)
              }
              onBlur={(e) =>
                setNode((n) => {
                  n.colors = { ...n.colors, [c.key]: e.target.value };
                }, true)
              }
            />
          </Field>
        ))}

        {def.hasRamp && node.ramp ? (
          <RampEditor
            ramp={node.ramp}
            onChange={(ramp, committed) =>
              setNode((n) => {
                n.ramp = ramp;
              }, committed)
            }
          />
        ) : null}

        {empty ? <p className="opacity-50">This node has no editable values.</p> : null}
      </Section>
    </div>
  );
}
