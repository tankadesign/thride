import { ClassicPreset, NodeEditor, type GetSchemes } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { Presets, ReactPlugin, type ReactArea2D } from "rete-react-plugin";
import { createRoot } from "react-dom/client";
import {
  GRAPH_NODE_DEFS,
  NOISE_SPACES,
  type GraphNode,
  type MaterialGraphDTO,
  type Uuid,
} from "@/types/core";
import {
  InlineColorControl,
  InlineNumberControl,
  InlineSelectControl,
  renderInlineControl,
} from "./inlineControls";
import { graphProblems } from "@/materials/graph";
import {
  ThrideConnection,
  ThrideNode,
  ThrideNodeData,
  ThrideSocket,
  ThrideSocketData,
} from "./nodeTheme";

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
  nodeIds: Uuid[];
  positions: Record<string, [number, number]>;
  connections: { from: { node: Uuid; socket: string }; to: { node: Uuid; socket: string } }[];
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
  /** Option-drag finished: leave a copy — original returns to `originalPos`
   *  (wires intact), an unwired clone lands where the drag dropped it. */
  onCopyNode: (nodeId: Uuid, originalPos: [number, number]) => void;
  /** Bypass toggle (structural passthrough). */
  onToggleBypass: (nodeId: string, on: boolean) => void;
  /** Solo toggle (look-dev color preview of one node). */
  onToggleSolo: (nodeId: string, on: boolean) => void;
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

/** A wiring-first Rete node: title + sockets + inline fallbacks on unwired inputs.
 *  Each socket gets its own {@link ThrideSocketData} carrying its wiring state,
 *  so the themed socket can render connected = filled (see nodeTheme); the node
 *  payload ({@link ThrideNodeData}) carries the error badge + preview flag. */
function buildNode(
  dto: GraphNode,
  graph: MaterialGraphDTO,
  problems: Map<string, string>,
  h: EditorHandlers,
): ClassicPreset.Node {
  const def = GRAPH_NODE_DEFS[dto.kind];
  const node = new ThrideNodeData(def.label);
  node.id = dto.id; // bridge: Rete events + connections reference the DTO id
  node.problem = problems.get(dto.id);
  node.showPreview = dto.kind !== "output";
  node.bypass = dto.bypass ?? false;
  node.solo = graph.solo === dto.id;
  node.onToggleBypass = (on) => h.onToggleBypass(dto.id, on);
  node.onToggleSolo = (on) => h.onToggleSolo(dto.id, on);
  for (const s of def.inputs) {
    const wired = graph.connections.some((c) => c.to.node === dto.id && c.to.socket === s.key);
    const input = new ClassicPreset.Input(new ThrideSocketData(wired), s.label);
    if (!wired) {
      const control = fallbackControl(dto, s.key, h);
      if (control) input.addControl(control);
    }
    node.addInput(s.key, input);
  }
  if (def.output) {
    const wired = graph.connections.some((c) => c.from.node === dto.id && c.from.socket === "out");
    node.addOutput("out", new ClassicPreset.Output(new ThrideSocketData(wired), "Out"));
  }
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

  // Multi-select: Shift or ⌘/Ctrl accumulates; and picking a node that is
  // ALREADY selected keeps the whole selection, so dragging any member moves
  // the group without a modifier (C4D/Blender behavior). `pickKeepsSelection`
  // is set by the capture-phase pointerdown below, which runs before Rete's
  // pick reaches the selector.
  let modifierHeld = false;
  let pickKeepsSelection = false;
  const trackModifiers = (e: KeyboardEvent) => {
    modifierHeld = e.shiftKey || e.metaKey || e.ctrlKey;
  };
  window.addEventListener("keydown", trackModifiers);
  window.addEventListener("keyup", trackModifiers);
  AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
    accumulating: { active: () => modifierHeld || pickKeepsSelection },
  });
  render.addPreset(
    Presets.classic.setup({
      customize: {
        node: () => ThrideNode,
        socket: () => ThrideSocket,
        connection: () => ThrideConnection,
        control: (data) => renderInlineControl(data.payload),
      },
    }),
  );
  connection.addPreset(ConnectionPresets.classic.setup());

  editor.use(area);
  area.use(connection);
  area.use(render);
  AreaExtensions.simpleNodesOrder(area);

  // muted spans the programmatic build so its events don't echo back as edits
  let muted = true;

  const problems = graphProblems(graph);
  for (const dto of graph.nodes) {
    await editor.addNode(buildNode(dto, graph, problems, handlers));
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
  // Option-drag copy: armed on alt+pointerdown over a node (see onPointerDown),
  // resolved when that node's drag ends. The commit happens at DROP — a
  // mid-gesture commit would rebuild the canvas and kill the drag. From the
  // first real move a GHOST of the original stays at the pre-drag spot, so
  // both nodes are visible while copying.
  let copyArm: { id: string; x: number; y: number } | null = null;
  let copyGhost: HTMLElement | null = null;
  const clearGhost = () => {
    copyGhost?.remove();
    copyGhost = null;
  };

  // double-click detection rides the pick events, not the DOM dblclick — the
  // first click can re-render the node (selection styling), which breaks the
  // browser's same-element dblclick synthesis
  let lastPick = { id: "", t: 0 };
  area.addPipe((ctx) => {
    if (muted) return ctx;
    // drop double-click zoom; a node double-click opens Attributes instead
    if (ctx.type === "zoom" && ctx.data.source === "dblclick") return undefined;
    // first move of an armed copy drag → spawn the ghost at the original spot
    if (ctx.type === "nodetranslated" && copyArm && ctx.data.id === copyArm.id && !copyGhost) {
      const view = area.nodeViews.get(copyArm.id);
      if (view) {
        const g = view.element.cloneNode(true) as HTMLElement;
        g.style.transform = `translate(${copyArm.x}px, ${copyArm.y}px)`;
        g.style.opacity = "0.45";
        g.style.pointerEvents = "none";
        view.element.parentElement?.appendChild(g);
        copyGhost = g;
      }
    }
    if (ctx.type === "nodedragged") {
      const arm = copyArm;
      copyArm = null;
      const draggedId = ctx.data.id;
      // resolve on a macrotask: node translations are async promise chains that
      // keep re-enqueuing microtasks, so the final position can land well after
      // the synchronous drag-end moment — a timeout lets them fully drain
      setTimeout(() => {
        clearGhost(); // the commit's rebuild redraws both nodes for real
        const view = arm && arm.id === draggedId ? area.nodeViews.get(arm.id) : null;
        // only a real move copies — an alt+click stays a plain (no-op) commit
        if (arm && view && Math.hypot(view.position.x - arm.x, view.position.y - arm.y) > 4) {
          handlers.onCopyNode(arm.id as Uuid, [arm.x, arm.y]);
        } else {
          notify();
        }
      }, 0);
    }
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

  const nodeIdAt = (el: EventTarget | null): string | null => {
    const nodeEl = el instanceof HTMLElement ? el.closest("[data-testid='node']") : null;
    if (!nodeEl) return null;
    for (const [id, view] of area.nodeViews) {
      if (view.element === nodeEl || view.element.contains(nodeEl)) return id;
    }
    return null;
  };

  // Option over a node reads as "drag to copy" — show the copy cursor while
  // held (set imperatively; the node's own cursor-pointer class would win a
  // stylesheet fight, and the theme owns no custom CSS)
  const setNodeCursors = (cursor: string) => {
    for (const [, view] of area.nodeViews) {
      const el = view.element.querySelector<HTMLElement>("[data-testid='node']");
      if (el) el.style.cursor = cursor;
    }
  };
  const onAltKey = (e: KeyboardEvent) => {
    if (e.key === "Alt") setNodeCursors(e.type === "keydown" ? "copy" : "");
  };
  const onWinBlur = () => setNodeCursors("");
  window.addEventListener("keydown", onAltKey);
  window.addEventListener("keyup", onAltKey);
  window.addEventListener("blur", onWinBlur);

  // the canvas takes focus on click so Delete/Backspace can act on the selection
  container.tabIndex = 0;
  container.style.outline = "none";
  const onPointerDown = (e: PointerEvent) => {
    if (!isWidget(e.target)) container.focus({ preventScroll: true });
    // group-move without modifier: picking an already-selected node keeps the
    // selection (see the accumulating predicate above)
    const overId = nodeIdAt(e.target);
    pickKeepsSelection = !!overId && (editor.getNode(overId)?.selected ?? false);
    // arm option-drag copy (the Output sink is the one node that can't be copied)
    copyArm = null;
    if (e.altKey && e.button === 0 && overId && overId !== graph.output) {
      const view = area.nodeViews.get(overId);
      if (view) copyArm = { id: overId, x: view.position.x, y: view.position.y };
    }
  };
  // capture phase: Rete's node drag stops propagation on pointerdown, so a
  // bubble-phase listener never hears clicks that land on a node
  container.addEventListener("pointerdown", onPointerDown, true);

  // ---- canvas navigation: middle-drag pans (left-drag on the background
  // already pans via the stock area drag); C4D-style Option+right-drag zooms
  // about the grab point. Capture phase so nodes/sockets can't swallow it.
  let navDragged = false;
  const onNavDown = (e: PointerEvent) => {
    const middlePan = e.button === 1;
    const altZoom = e.button === 2 && e.altKey;
    if (!middlePan && !altZoom) return;
    e.preventDefault();
    e.stopPropagation();
    navDragged = false;
    const t0 = area.area.transform;
    const start = { x: e.clientX, y: e.clientY, k: t0.k, tx: t0.x, ty: t0.y };
    const rect = container.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) navDragged = true;
      if (middlePan) {
        void area.area.translate(start.tx + dx, start.ty + dy);
      } else {
        // drag right / up = zoom in (C4D); pivot stays under the grab point
        const k = Math.min(2.5, Math.max(0.15, start.k * Math.exp((dx - dy) * 0.005)));
        const t = area.area.transform;
        const ratio = 1 - k / t.k;
        void area.area.zoom(k, (px - t.x) * ratio, (py - t.y) * ratio);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  container.addEventListener("pointerdown", onNavDown, true);
  // middle-click autoscroll is a mousedown default — suppress it separately
  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };
  container.addEventListener("mousedown", onMouseDown, true);

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

  // right-click: background → Add Node menu; over a node → nothing (no menu);
  // Option+right = the zoom gesture, and a zoom drag must not pop the menu
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    if (e.altKey || navDragged) {
      navDragged = false;
      return;
    }
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
    // initial framing — retry until the dock panel has laid out (a zero-size
    // container makes zoomAt frame into a corner)
    const frame = () => {
      if (container.clientWidth < 50 || container.clientHeight < 50) {
        setTimeout(frame, 60);
        return;
      }
      void AreaExtensions.zoomAt(area, editor.getNodes());
    };
    setTimeout(frame, 0);
  }

  return {
    destroy: () => {
      clearGhost();
      container.removeEventListener("pointerdown", onPointerDown, true);
      container.removeEventListener("pointerdown", onNavDown, true);
      container.removeEventListener("mousedown", onMouseDown, true);
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onAltKey);
      window.removeEventListener("keyup", onAltKey);
      window.removeEventListener("keydown", trackModifiers);
      window.removeEventListener("keyup", trackModifiers);
      window.removeEventListener("blur", onWinBlur);
      area.destroy();
    },
    // Rete types ids as plain strings; ours ARE the DTO Uuids (buildNode sets
    // node.id = dto.id), so the read-back re-brands them at this one boundary.
    readStructure: () => ({
      nodeIds: editor.getNodes().map((n) => n.id as Uuid),
      positions: Object.fromEntries(
        editor.getNodes().map((n) => {
          const v = area.nodeViews.get(n.id);
          return [n.id, [v?.position.x ?? 0, v?.position.y ?? 0] as [number, number]];
        }),
      ),
      connections: editor.getConnections().map((c) => ({
        from: { node: c.source as Uuid, socket: c.sourceOutput },
        to: { node: c.target as Uuid, socket: c.targetInput },
      })),
    }),
    getTransform: () => ({ ...area.area.transform }),
  };
}
