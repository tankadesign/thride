import { ClassicPreset, NodeEditor, type GetSchemes } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { Presets, ReactPlugin, type ReactArea2D } from "rete-react-plugin";
import { createRoot } from "react-dom/client";
import { BLEND_MODES, GRAPH_NODE_DEFS, type MaterialGraphDTO } from "@/types/core";
import { NOISE_DEFS } from "@/materials/noises";

/**
 * Rete v2 read-only render of a {@link MaterialGraphDTO} (E7 Stage 4): nodes,
 * sockets, wires, and param values, with pan / zoom / node-selection. Editing
 * (connect/disconnect/param widgets) is Stage 5 — this maps the DTO into a Rete
 * graph one-way. One shared socket type: our compiler coerces float↔vec3 at every
 * wire, so the panel doesn't gate connections on type.
 */

type Schemes = GetSchemes<
  ClassicPreset.Node,
  ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>
>;
type AreaExtra = ReactArea2D<Schemes>;

/** A mounted editor + its teardown. */
export interface MountedEditor {
  destroy: () => void;
}

const SOCKET = new ClassicPreset.Socket("s");

/** Human label for a select value (noise id / blend mode / raw). */
function optionLabel(kind: string, key: string, value: string): string {
  if (kind === "noise") return NOISE_DEFS.find((d) => d.id === value)?.label ?? value;
  if (key === "blend") return BLEND_MODES.find((b) => b.mode === value)?.label ?? value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** A read-only control so the classic preset renders the value, greyed and inert. */
function ro(value: string | number): ClassicPreset.InputControl<"text"> {
  return new ClassicPreset.InputControl("text", { initial: String(value), readonly: true });
}

export async function mountNodeEditor(
  container: HTMLElement,
  graph: MaterialGraphDTO,
): Promise<MountedEditor> {
  const editor = new NodeEditor<Schemes>();
  const area = new AreaPlugin<Schemes, AreaExtra>(container);
  const connection = new ConnectionPlugin<Schemes, AreaExtra>();
  const render = new ReactPlugin<Schemes, AreaExtra>({ createRoot });

  AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
    accumulating: AreaExtensions.accumulateOnCtrl(),
  });
  render.addPreset(Presets.classic.setup());
  connection.addPreset(ConnectionPresets.classic.setup());

  editor.use(area);
  area.use(connection);
  area.use(render);
  AreaExtensions.simpleNodesOrder(area);

  // DTO node id → Rete node (Rete mints its own ids; we bridge by our stable id)
  const byId = new Map<string, ClassicPreset.Node>();
  for (const dto of graph.nodes) {
    const def = GRAPH_NODE_DEFS[dto.kind];
    const node = new ClassicPreset.Node(def.label);
    for (const s of def.inputs) node.addInput(s.key, new ClassicPreset.Input(SOCKET, s.label));
    if (def.output) node.addOutput("out", new ClassicPreset.Output(SOCKET, "Out"));
    // read-only widgets: the shape-selecting dropdown value, then param values.
    for (const sel of def.selects) {
      const v = dto.select?.[sel.key];
      if (v) node.addControl(sel.key, ro(optionLabel(dto.kind, sel.key, v)));
    }
    if (dto.kind === "noise") {
      const nd = NOISE_DEFS.find((d) => d.id === dto.select?.noise);
      for (const p of nd?.params ?? []) {
        node.addControl(p.key, ro(dto.params?.[p.key] ?? p.default));
      }
    } else {
      for (const p of def.params) {
        // params that share an input socket key are inline fallbacks — shown by
        // the socket itself, not as a separate widget
        if (def.inputs.some((i) => i.key === p.key)) continue;
        if (dto.params?.[p.key] !== undefined) node.addControl(p.key, ro(dto.params[p.key]!));
      }
    }
    for (const c of def.colors) {
      const hex = dto.colors?.[c.key];
      if (hex) node.addControl(c.key, ro(hex));
    }
    await editor.addNode(node);
    byId.set(dto.id, node);
    await area.translate(node.id, { x: dto.position?.[0] ?? 0, y: dto.position?.[1] ?? 0 });
  }

  for (const c of graph.connections) {
    const from = byId.get(c.from.node);
    const to = byId.get(c.to.node);
    if (from && to) {
      await editor.addConnection(new ClassicPreset.Connection(from, "out", to, c.to.socket));
    }
  }

  // frame the whole graph
  setTimeout(() => void AreaExtensions.zoomAt(area, editor.getNodes()), 0);

  return { destroy: () => area.destroy() };
}
