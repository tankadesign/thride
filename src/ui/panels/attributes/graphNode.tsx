import { useRef } from "react";
import { UpdateMaterialCommand } from "@/core";
import {
  BLEND_MODES,
  GRAPH_NODE_DEFS,
  NOISE_SPACES,
  SHAPING_DEFAULTS as SD,
  type GraphNode,
  type MaterialDTO,
  type Uuid,
} from "@/types/core";
import { defaultNoiseParams, noiseDef, NOISE_DEFS } from "@/materials/noises";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { Field, Section } from "@/ui/widgets/inspector";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { RampEditor } from "@/ui/panels/materialEditor/RampEditor";

/**
 * Attributes editor for a material graph node (E7). The node canvas handles
 * wiring (+ inline input fallbacks); this panel is the FULL editor — reached by
 * clicking a node (double-click also brings the panel forward). The noise node
 * mirrors the material manager's NoiseEditor knob-for-knob: Type, Space, Seed,
 * the type's own params, and the shaping group — all live uniforms except
 * Type/Space (structural). Uses the shared inspector widgets and the same
 * scrub-then-commit history pattern as everything else.
 */

type SetNode = (patch: (n: GraphNode) => void, committed: boolean) => void;

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
  const setNode: SetNode = (patch, committed) => {
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

  if (node.kind === "noise") {
    const coordWired = mat.graph!.connections.some(
      (c) => c.to.node === nodeId && c.to.socket === "coord",
    );
    return (
      <div className="h-full overflow-auto bg-base-100 text-xs py-2">
        <NoiseSection node={node} coordWired={coordWired} setNode={setNode} />
      </div>
    );
  }

  const empty =
    def.selects.length === 0 && def.params.length === 0 && def.colors.length === 0 && !def.hasRamp;

  return (
    <div className="h-full overflow-auto bg-base-100 text-xs py-2">
      <Section title={`${def.label} Node`} bordered={false}>
        {def.selects.map((sel) => {
          const options =
            sel.key === "blend"
              ? BLEND_MODES.map((b) => ({ value: b.mode, label: b.label }))
              : sel.options;
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

        {def.params.map((p) => (
          <Field key={p.key} label={p.label}>
            <NumberDrag
              value={node.params?.[p.key] ?? 0}
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

/** The noise node's full editor — NoiseEditor parity (see header). */
function NoiseSection({
  node,
  coordWired,
  setNode,
}: {
  node: GraphNode;
  coordWired: boolean;
  setNode: SetNode;
}) {
  const def = noiseDef(node.select?.noise ?? "perlin");

  // swap the noise type, keeping params the two types share (scale carries over)
  // — the non-registry params (seed/shaping) live in the same bag and survive.
  const swapType = (id: string) => {
    const next = noiseDef(id);
    if (!next) return;
    setNode((n) => {
      const params = { ...n.params };
      for (const [key, fallback] of Object.entries(defaultNoiseParams(next))) {
        params[key] ??= fallback;
      }
      n.select = { ...n.select, noise: id };
      n.params = params;
    }, true);
  };

  const num = (
    label: string,
    key: string,
    fallback: number,
    min: number,
    max: number,
    step: number,
    integer = false,
  ) => (
    <Field key={key} label={label}>
      <NumberDrag
        value={node.params?.[key] ?? fallback}
        min={min}
        max={max}
        step={step}
        integer={integer}
        onChange={(v, committed) =>
          setNode((n) => {
            n.params = { ...n.params, [key]: v };
          }, committed)
        }
      />
    </Field>
  );

  return (
    <Section title="Noise Node" bordered={false}>
      <Field label="Type">
        <select
          className="select select-sm w-full"
          value={node.select?.noise ?? "perlin"}
          onChange={(e) => swapType(e.target.value)}
        >
          {NOISE_DEFS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Space">
        <select
          className="select select-sm w-full"
          value={node.select?.space ?? "object"}
          disabled={coordWired}
          title={coordWired ? "Overridden by the wired Coord input" : undefined}
          onChange={(e) =>
            setNode((n) => {
              n.select = { ...n.select, space: e.target.value };
            }, true)
          }
        >
          {NOISE_SPACES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      {num("Seed", "seed", 0, 0, 999, 1, true)}
      {def?.params.map((p) => (
        <Field key={p.key} label={p.label}>
          <NumberDrag
            value={node.params?.[p.key] ?? p.default}
            min={p.min}
            max={p.max}
            step={p.step}
            integer={p.integer}
            onChange={(v, committed) =>
              setNode((n) => {
                n.params = { ...n.params, [p.key]: v };
              }, committed)
            }
          />
        </Field>
      ))}
      {num("Contrast", "contrast", SD.contrast, 0, 4, 0.02)}
      {num("Bias", "bias", SD.bias, -1, 1, 0.01)}
      {num("Clip Low", "clipLow", SD.clipLow, 0, 1, 0.01)}
      {num("Clip High", "clipHigh", SD.clipHigh, 0, 1, 0.01)}
    </Section>
  );
}
