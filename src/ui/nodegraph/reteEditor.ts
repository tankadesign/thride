import { ClassicPreset, NodeEditor, type GetSchemes } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { Presets, ReactPlugin, type ReactArea2D } from "rete-react-plugin";
import { createRoot } from "react-dom/client";
import { GRAPH_NODE_DEFS, type GraphNode, type MaterialGraphDTO } from "@/types/core";
import { controlFor, renderControl, type ControlHandlers } from "./graphControls";

/**
 * Rete v2 editor over a {@link MaterialGraphDTO} (E7 Stages 4–5). Structure
 * (which nodes exist, the wiring, positions) is edited in Rete and read back via
 * {@link EditorHandle.readStructure}; node CONTENT (kind/select/params) stays in
 * the panel's DTO and is passed in. Edits are Rete-first: the panel applies each
 * as a delta and commits — it never remounts on its own edits, so the view never
 * jumps (see NodeGraphPanel).
 *
 * One shared socket type: the compiler coerces float↔vec3 at every wire, so
 * connections aren't gated on type. Each input takes at most one wire.
 */

type Schemes = GetSchemes<
  ClassicPreset.Node,
  ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>
>;
type AreaExtra = ReactArea2D<Schemes>;

/** View transform (pan x/y + zoom k) — snapshotted across remounts. */
export interface Transform {
  x: number;
  y: number;
  k: number;
}

/** The structural read-back: node ids present, their positions, and the wiring. */
export interface EditorStructure {
  nodeIds: string[];
  positions: Record<string, [number, number]>;
  connections: { from: { node: string; socket: string }; to: { node: string; socket: string } }[];
}

export interface EditorHandlers extends ControlHandlers {
  /** A structural edit happened in Rete (connect/disconnect/delete/move-end). */
  onStructureChanged: () => void;
  /** Right-click on empty canvas — `graph` is the click in graph coords. */
  onBackgroundMenu: (clientX: number, clientY: number, graph: [number, number]) => void;
  /** Right-click on a node. */
  onNodeMenu: (nodeId: string, clientX: number, clientY: number) => void;
}

export interface EditorHandle {
  destroy: () => void;
  /** Read the current structure back out of Rete (positions + wiring). */
  readStructure: () => EditorStructure;
  /** Current view transform, to preserve across a remount. */
  getTransform: () => Transform;
}

const SOCKET = new ClassicPreset.Socket("s");

/** Build a Rete node for a DTO node — id bridged so events reference our ids. */
function buildNode(dto: GraphNode, handlers: ControlHandlers): ClassicPreset.Node {
  const def = GRAPH_NODE_DEFS[dto.kind];
  const node = new ClassicPreset.Node(def.label);
  node.id = dto.id; // bridge: Rete events + connections reference the DTO id
  for (const s of def.inputs) node.addInput(s.key, new ClassicPreset.Input(SOCKET, s.label));
  if (def.output) node.addOutput("out", new ClassicPreset.Output(SOCKET, "Out"));
  for (const [key, control] of controlFor(dto, handlers)) node.addControl(key, control);
  return node;
}

export async function mountNodeEditor(
  container: HTMLElement,
  graph: MaterialGraphDTO,
  handlers: EditorHandlers,
  initial?: Transform,
): Promise<EditorHandle> {
  const editor = new NodeEditor<Schemes>();
  const area = new AreaPlugin<Schemes, AreaExtra>(container);
  const connection = new ConnectionPlugin<Schemes, AreaExtra>();
  const render = new ReactPlugin<Schemes, AreaExtra>({ createRoot });

  AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
    accumulating: AreaExtensions.accumulateOnCtrl(),
  });
  render.addPreset(
    Presets.classic.setup({
      customize: { control: (data) => renderControl(data.payload) },
    }),
  );
  connection.addPreset(ConnectionPresets.classic.setup());

  editor.use(area);
  area.use(connection);
  area.use(render);
  AreaExtensions.simpleNodesOrder(area);

  // muted spans the programmatic build so its events don't echo back as user
  // edits (the advisor's #1 trap). Structural edits remount from the DTO, so the
  // panel enforces one-wire-per-input when it reads the structure back.
  let muted = true;

  for (const dto of graph.nodes) {
    await editor.addNode(buildNode(dto, handlers));
    await area.translate(dto.id, { x: dto.position?.[0] ?? 0, y: dto.position?.[1] ?? 0 });
  }
  for (const c of graph.connections) {
    const from = editor.getNode(c.from.node);
    const to = editor.getNode(c.to.node);
    if (from && to) {
      await editor.addConnection(new ClassicPreset.Connection(from, "out", to, c.to.socket));
    }
  }

  // structural events → notify the panel (debounced to one call per microtask so
  // a multi-step gesture is a single commit).
  let pending = false;
  const notify = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      handlers.onStructureChanged();
    });
  };

  editor.addPipe((ctx) => {
    if (muted) return ctx;
    if (
      ctx.type === "connectioncreated" ||
      ctx.type === "connectionremoved" ||
      ctx.type === "noderemoved"
    ) {
      notify();
    }
    return ctx;
  });
  // node drag end (position is not structural, but persist it in one step)
  area.addPipe((ctx) => {
    if (muted) return ctx;
    // drop double-click zoom (advisor #5): the area zooms on dblclick by default
    if (ctx.type === "zoom" && ctx.data.source === "dblclick") return undefined;
    if (ctx.type === "nodedragged") notify();
    return ctx;
  });

  muted = false;

  // right-click → app context menu (native menu suppressed)
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    const nodeEl = (e.target as HTMLElement).closest("[data-testid='node']");
    const id = nodeEl ? editorNodeIdAt(area, nodeEl) : null;
    if (id) {
      handlers.onNodeMenu(id, e.clientX, e.clientY);
    } else {
      const rect = container.getBoundingClientRect();
      const t = area.area.transform;
      const gx = (e.clientX - rect.left - t.x) / t.k;
      const gy = (e.clientY - rect.top - t.y) / t.k;
      handlers.onBackgroundMenu(e.clientX, e.clientY, [gx, gy]);
    }
  };
  container.addEventListener("contextmenu", onContext);

  if (initial) {
    await area.area.zoom(initial.k);
    await area.area.translate(initial.x, initial.y);
  } else {
    setTimeout(() => void AreaExtensions.zoomAt(area, editor.getNodes()), 0);
  }

  return {
    destroy: () => {
      container.removeEventListener("contextmenu", onContext);
      area.destroy();
    },
    readStructure: () => ({
      nodeIds: editor.getNodes().map((n) => n.id),
      positions: Object.fromEntries(
        editor.getNodes().map((n) => {
          const v = area.nodeViews.get(n.id);
          return [n.id, [v?.position.x ?? 0, v?.position.y ?? 0] as [number, number]];
        }),
      ),
      connections: editor.getConnections().map((c) => ({
        from: { node: c.source, socket: c.sourceOutput },
        to: { node: c.target, socket: c.targetInput },
      })),
    }),
    getTransform: () => ({ ...area.area.transform }),
  };
}

/** Resolve which node a right-clicked DOM element belongs to (by matching view roots). */
function editorNodeIdAt(area: AreaPlugin<Schemes, AreaExtra>, el: Element): string | null {
  for (const [id, view] of area.nodeViews) {
    if (view.element === el || view.element.contains(el)) return id;
  }
  return null;
}
