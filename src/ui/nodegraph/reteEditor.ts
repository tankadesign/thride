import { ClassicPreset, NodeEditor, type GetSchemes } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { Presets, ReactPlugin, type ReactArea2D } from "rete-react-plugin";
import { createRoot } from "react-dom/client";
import { GRAPH_NODE_DEFS, NOISE_SPACES, type GraphNode, type MaterialGraphDTO } from "@/types/core";
import {
  InlineColorControl,
  InlineNumberControl,
  InlineSelectControl,
  renderInlineControl,
} from "./inlineControls";

/**
 * Rete v2 editor over a {@link MaterialGraphDTO} (E7). The canvas is for WIRING:
 * connect/disconnect/move, plus Blender-style inline fallback widgets on UNWIRED
 * inputs (see {@link inlineControls}) so constants don't need their own nodes.
 * Full value editing lives in the Attributes panel — a click on a node shows it
 * there, a double-click also brings the panel to the front, and Delete/Backspace
 * removes the selected nodes. No context menu over nodes; right-clicking the
 * background offers Add Node.
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
  /** A node was clicked — show it in the Attributes panel (no focus steal). */
  onNodeClicked: (nodeId: string) => void;
  /** A node was double-clicked — show it AND bring Attributes to the front. */
  onNodeInspect: (nodeId: string) => void;
  /** Delete/Backspace over the canvas with nodes selected. */
  onDeleteNodes: (nodeIds: string[]) => void;
  /** Right-click on empty canvas — `graph` is the click in graph coords. */
  onBackgroundMenu: (clientX: number, clientY: number, graph: [number, number]) => void;
  /** Inline widget edits (unwired-input fallbacks + the coord node's space). */
  onNodeSelect: (nodeId: string, key: string, value: string) => void;
  onNodeParam: (nodeId: string, key: string, value: number, committed: boolean) => void;
  onNodeColor: (nodeId: string, key: string, hex: string, committed: boolean) => void;
}

export interface EditorHandle {
  destroy: () => void;
  /** Read the current structure back out of Rete (positions + wiring). */
  readStructure: () => EditorStructure;
  /** Current view transform, to preserve across a remount. */
  getTransform: () => Transform;
}

const SOCKET = new ClassicPreset.Socket("s");

/** The inline fallback widget for an unwired input socket, or null. */
function fallbackControl(
  dto: GraphNode,
  socket: string,
  h: EditorHandlers,
): ClassicPreset.Control | null {
  const kind = dto.kind;
  if (kind === "noise" && socket === "coord") {
    return new InlineSelectControl(dto.select?.space ?? "object", NOISE_SPACES, (v) =>
      h.onNodeSelect(dto.id, "space", v),
    );
  }
  if (kind === "math" && (socket === "a" || socket === "b")) {
    return new InlineNumberControl(dto.params?.[socket] ?? 0, 0.01, (v, committed) =>
      h.onNodeParam(dto.id, socket, v, committed),
    );
  }
  if (kind === "mix" && (socket === "a" || socket === "b")) {
    return new InlineColorControl(
      dto.colors?.[socket] ?? (socket === "a" ? "#000000" : "#ffffff"),
      (hex, committed) => h.onNodeColor(dto.id, socket, hex, committed),
    );
  }
  if (kind === "ramp" && socket === "t") {
    return new InlineNumberControl(dto.params?.t ?? 0, 0.01, (v, committed) =>
      h.onNodeParam(dto.id, "t", v, committed),
    );
  }
  if (kind === "bump" && socket === "height") {
    return new InlineNumberControl(dto.params?.height ?? 0, 0.01, (v, committed) =>
      h.onNodeParam(dto.id, "height", v, committed),
    );
  }
  return null;
}

/** A wiring-first Rete node: title + sockets + inline fallbacks on unwired inputs. */
function buildNode(dto: GraphNode, graph: MaterialGraphDTO, h: EditorHandlers): ClassicPreset.Node {
  const def = GRAPH_NODE_DEFS[dto.kind];
  const node = new ClassicPreset.Node(def.label);
  node.id = dto.id; // bridge: Rete events + connections reference the DTO id
  for (const s of def.inputs) {
    const input = new ClassicPreset.Input(SOCKET, s.label);
    const wired = graph.connections.some((c) => c.to.node === dto.id && c.to.socket === s.key);
    if (!wired) {
      const control = fallbackControl(dto, s.key, h);
      if (control) input.addControl(control);
    }
    node.addInput(s.key, input);
  }
  if (def.output) node.addOutput("out", new ClassicPreset.Output(SOCKET, "Out"));
  // the Coordinate Space node IS its select — show it on the canvas
  if (dto.kind === "coord") {
    const options = GRAPH_NODE_DEFS.coord.selects[0]!.options;
    node.addControl(
      "space",
      new InlineSelectControl(dto.select?.space ?? "object", options, (v) =>
        h.onNodeSelect(dto.id, "space", v),
      ),
    );
  }
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
      customize: { control: (data) => renderInlineControl(data.payload) },
    }),
  );
  connection.addPreset(ConnectionPresets.classic.setup());

  editor.use(area);
  area.use(connection);
  area.use(render);
  AreaExtensions.simpleNodesOrder(area);

  // muted spans the programmatic build so its events don't echo back as edits
  let muted = true;

  for (const dto of graph.nodes) {
    await editor.addNode(buildNode(dto, graph, handlers));
    await area.translate(dto.id, { x: dto.position?.[0] ?? 0, y: dto.position?.[1] ?? 0 });
  }
  for (const c of graph.connections) {
    const from = editor.getNode(c.from.node);
    const to = editor.getNode(c.to.node);
    if (from && to) {
      await editor.addConnection(new ClassicPreset.Connection(from, "out", to, c.to.socket));
    }
  }

  // structural events → notify the panel (debounced to one call per microtask).
  // While a wire DRAG is in flight the commit is deferred: grabbing a wire off an
  // occupied input removes it in Rete (the pseudo-connection follows the pointer
  // for re-wiring), and committing that removal immediately would rebuild the
  // canvas and kill the drag — the "detached wire disappears" bug. The drop
  // flushes once, so pick-up→re-drop reads back as a single rewire commit.
  let pending = false;
  let wireDrag = false;
  let dirtyDuringDrag = false;
  const notify = () => {
    if (wireDrag) {
      dirtyDuringDrag = true;
      return;
    }
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      handlers.onStructureChanged();
    });
  };
  connection.addPipe((ctx) => {
    if (ctx.type === "connectionpick") wireDrag = true;
    if (ctx.type === "connectiondrop") {
      wireDrag = false;
      // flush after Rete applies the drop result (re-wired, or removed in void)
      queueMicrotask(() => {
        if (dirtyDuringDrag) {
          dirtyDuringDrag = false;
          notify();
        }
      });
    }
    return ctx;
  });

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
  // double-click detection rides the pick events, not the DOM dblclick — the
  // first click can re-render the node (selection styling), which breaks the
  // browser's same-element dblclick synthesis
  let lastPick = { id: "", t: 0 };
  area.addPipe((ctx) => {
    if (muted) return ctx;
    // drop double-click zoom; a node double-click opens Attributes instead
    if (ctx.type === "zoom" && ctx.data.source === "dblclick") return undefined;
    if (ctx.type === "nodedragged") notify();
    if (ctx.type === "nodepicked") {
      const now = performance.now();
      if (ctx.data.id === lastPick.id && now - lastPick.t < 400) {
        // second click on the same node → edit it, bringing Attributes forward
        handlers.onNodeInspect(ctx.data.id);
      } else {
        // "last clicked" → show it in Attributes (no focus steal)
        handlers.onNodeClicked(ctx.data.id);
      }
      lastPick = { id: ctx.data.id, t: now };
    }
    return ctx;
  });

  muted = false;

  const isWidget = (el: EventTarget | null): boolean =>
    el instanceof HTMLElement && !!el.closest("input,select,textarea");

  // the canvas takes focus on click so Delete/Backspace can act on the selection
  container.tabIndex = 0;
  container.style.outline = "none";
  const onPointerDown = (e: PointerEvent) => {
    if (!isWidget(e.target)) container.focus({ preventScroll: true });
  };
  container.addEventListener("pointerdown", onPointerDown);

  // Delete/Backspace → delete the selected nodes. Swallow the key inside the
  // canvas either way, so the global scene-object delete never fires from here;
  // every other key (⌘Z…) still bubbles to the app shortcuts.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (isWidget(e.target)) return; // typing in an inline widget
    e.preventDefault();
    e.stopPropagation();
    const ids = editor
      .getNodes()
      .filter((n) => n.selected)
      .map((n) => n.id);
    if (ids.length) handlers.onDeleteNodes(ids);
  };
  container.addEventListener("keydown", onKeyDown);

  // right-click: background → Add Node menu; over a node → nothing (no menu)
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    const nodeEl = (e.target as HTMLElement).closest("[data-testid='node']");
    if (nodeEl) return;
    const rect = container.getBoundingClientRect();
    const t = area.area.transform;
    const gx = (e.clientX - rect.left - t.x) / t.k;
    const gy = (e.clientY - rect.top - t.y) / t.k;
    handlers.onBackgroundMenu(e.clientX, e.clientY, [gx, gy]);
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
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("keydown", onKeyDown);
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
