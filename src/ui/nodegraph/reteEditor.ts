import { ClassicPreset, NodeEditor, type GetSchemes } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { Presets, ReactPlugin, type ReactArea2D } from "rete-react-plugin";
import { createRoot } from "react-dom/client";
import { GRAPH_NODE_DEFS, type GraphNode, type MaterialGraphDTO } from "@/types/core";

/**
 * Rete v2 editor over a {@link MaterialGraphDTO} (E7) — WIRING ONLY. Nodes show a
 * title and their input/output sockets; there are no value widgets on the canvas.
 * Double-clicking a node opens it in the Attributes panel, which is where every
 * value is edited (see NodeGraphPanel + GraphNodeAttributes). This keeps the
 * canvas about connections and sidesteps Rete's control system entirely.
 *
 * One shared socket type: the compiler coerces float↔vec3 at every wire, so
 * connections aren't gated on type. Each input takes at most one wire (enforced
 * by the panel on read-back).
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

export interface EditorHandlers {
  /** A structural edit happened in Rete (connect/disconnect/move-end). */
  onStructureChanged: () => void;
  /** A node was double-clicked — open it in the Attributes panel. */
  onNodeInspect: (nodeId: string) => void;
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

/** A wiring-only Rete node: title + sockets, id bridged to the DTO id. */
function buildNode(dto: GraphNode): ClassicPreset.Node {
  const def = GRAPH_NODE_DEFS[dto.kind];
  const node = new ClassicPreset.Node(def.label);
  node.id = dto.id; // bridge: Rete events + connections reference the DTO id
  for (const s of def.inputs) node.addInput(s.key, new ClassicPreset.Input(SOCKET, s.label));
  if (def.output) node.addOutput("out", new ClassicPreset.Output(SOCKET, "Out"));
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
  render.addPreset(Presets.classic.setup());
  connection.addPreset(ConnectionPresets.classic.setup());

  editor.use(area);
  area.use(connection);
  area.use(render);
  AreaExtensions.simpleNodesOrder(area);

  // muted spans the programmatic build so its events don't echo back as edits
  let muted = true;

  for (const dto of graph.nodes) {
    await editor.addNode(buildNode(dto));
    await area.translate(dto.id, { x: dto.position?.[0] ?? 0, y: dto.position?.[1] ?? 0 });
  }
  for (const c of graph.connections) {
    const from = editor.getNode(c.from.node);
    const to = editor.getNode(c.to.node);
    if (from && to) {
      await editor.addConnection(new ClassicPreset.Connection(from, "out", to, c.to.socket));
    }
  }

  // structural events → notify the panel (debounced to one call per microtask)
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
  area.addPipe((ctx) => {
    if (muted) return ctx;
    // drop double-click zoom; a node double-click is handled by the DOM listener
    if (ctx.type === "zoom" && ctx.data.source === "dblclick") return undefined;
    if (ctx.type === "nodedragged") notify();
    return ctx;
  });

  muted = false;

  const nodeIdAt = (el: Element): string | null => {
    for (const [id, view] of area.nodeViews) {
      if (view.element === el || view.element.contains(el)) return id;
    }
    return null;
  };

  // double-click a node → edit it in Attributes (background dbl-click is inert)
  const onDblClick = (e: MouseEvent) => {
    const nodeEl = (e.target as HTMLElement).closest("[data-testid='node']");
    const id = nodeEl ? nodeIdAt(nodeEl) : null;
    if (id) {
      e.stopPropagation();
      handlers.onNodeInspect(id);
    }
  };
  container.addEventListener("dblclick", onDblClick);

  // right-click → app context menu (native menu suppressed)
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    const nodeEl = (e.target as HTMLElement).closest("[data-testid='node']");
    const id = nodeEl ? nodeIdAt(nodeEl) : null;
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
      container.removeEventListener("dblclick", onDblClick);
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
