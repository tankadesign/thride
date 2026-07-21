import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { UpdateMaterialCommand, uuidv7 } from "@/core";
import {
  defaultGraphNode,
  GRAPH_NODE_DEFS,
  type GraphNode,
  type GraphNodeKind,
  type MaterialDTO,
  type MaterialGraphDTO,
} from "@/types/core";
import { GraphNodeThumbnails } from "@/render/thumbnails/graphNodeThumbnails";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { selectedMaterialsAtom } from "@/ui/hooks/editor/materials";
import { inspectedNodeAtom } from "@/ui/hooks/editor/inspector";
import { focusPanel, openContextMenu, type MenuEntry } from "@/ui/hooks/editor/shell";
import {
  mountNodeEditor,
  type EditorHandle,
  type EditorHandlers,
  type Transform,
} from "./reteEditor";
import { starterGraph } from "./starter";

/**
 * Node material editor panel (E7). The canvas is for WIRING (connect/add/delete/
 * move + inline fallbacks on unwired inputs); full value editing happens in the
 * Attributes panel — click a node to show it there, double-click to also bring
 * the panel forward, Delete/Backspace removes the selection.
 *
 * The canvas rebuilds when its SIGNATURE — topology (node ids + kinds + wiring)
 * plus the `select` values shown by inline widgets — changes, with the view
 * transform preserved. Numeric/colour edits are NOT in the signature, so scrubs
 * never rebuild. Crucially the mount effect has no early-out: React pairs every
 * cleanup with a fresh mount, so a rebuild can never destroy the editor without
 * remounting it (the old "canvas disappears after a wire edit" bug).
 */

const ADDABLE: GraphNodeKind[] = [
  "coord",
  "noise",
  "float",
  "color",
  "math",
  "mix",
  "ramp",
  "bump",
];

/** What a canvas rebuild depends on: topology + the selects inline widgets show. */
function canvasSig(g?: MaterialGraphDTO): string {
  if (!g) return "";
  const nodes = g.nodes
    .map((n) => `${n.id}:${n.kind}:${JSON.stringify(n.select ?? {})}`)
    .sort()
    .join("|");
  const conns = g.connections
    .map((c) => `${c.from.node}.${c.from.socket}>${c.to.node}.${c.to.socket}`)
    .sort()
    .join("|");
  return `${nodes}#${conns}#${g.output}`;
}

export function NodeGraphPanel() {
  const doc = useDocument();
  useSliceVersion("materials");
  const selected = useAtomValue(selectedMaterialsAtom);
  const setInspected = useSetAtom(inspectedNodeAtom);
  const matId = selected[0];
  const dto = matId ? doc.materials.get(matId) : undefined;
  const graph = dto?.graph;
  const sig = canvasSig(graph);

  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const lastMat = useRef<string | undefined>(undefined);
  const pendingXform = useRef<Transform | undefined>(undefined);
  const scrub = useRef<{ before: MaterialDTO } | null>(null);

  // ---- per-node preview thumbnails (Stage 6) -------------------------------
  // One offscreen renderer per panel, alive across canvas rebuilds. Renders are
  // serialized (busy/queued) and applied IMPERATIVELY to the node imgs — the
  // canvas doesn't re-render on value edits, so src rides outside React.
  const thumbs = useRef<GraphNodeThumbnails | null>(null);
  const thumbMap = useRef<Map<string, string>>(new Map());
  const thumbBusy = useRef(false);
  const thumbQueued = useRef<MaterialGraphDTO | null>(null);
  useEffect(
    () => () => {
      thumbs.current?.dispose();
      thumbs.current = null;
    },
    [],
  );

  const applyThumbs = () => {
    const host = hostRef.current;
    if (!host) return;
    for (const img of host.querySelectorAll<HTMLImageElement>("[data-node-thumb]")) {
      const url = thumbMap.current.get(img.dataset.nodeThumb ?? "");
      if (url && img.src !== url) {
        img.src = url;
        img.style.opacity = "1";
      }
    }
  };

  const renderThumbs = (g: MaterialGraphDTO) => {
    if (thumbBusy.current) {
      thumbQueued.current = g; // latest wins; re-render once the pass finishes
      return;
    }
    thumbBusy.current = true;
    thumbs.current ??= new GraphNodeThumbnails();
    void thumbs.current
      .render(g)
      .then((map) => {
        thumbMap.current = map;
        applyThumbs();
      })
      .finally(() => {
        thumbBusy.current = false;
        const queued = thumbQueued.current;
        thumbQueued.current = null;
        if (queued) renderThumbs(queued);
      });
  };

  // re-render thumbnails on ANY graph change (values included), debounced so a
  // scrub costs one trailing pass
  const fullSig = graph ? JSON.stringify(graph) : "";
  useEffect(() => {
    if (!graph) return;
    const t = setTimeout(() => renderThumbs(graph), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized graph
  }, [fullSig, matId]);
  // --------------------------------------------------------------------------

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !graph || !matId) return;
    // preserve the view across a rebuild of the SAME material; reframe on switch
    const initial = lastMat.current === matId ? pendingXform.current : undefined;
    lastMat.current = matId;

    /** Commit a whole-graph replacement as one undo step. */
    const setGraph = (next: MaterialGraphDTO) => {
      const cur = doc.materials.get(matId);
      if (!cur) return;
      doc.history.run(new UpdateMaterialCommand(cur, { ...cur, graph: next }, "Edit Node Graph"));
    };

    /** Patch one node with the scrub pattern (live during drag, one step on release). */
    const patchNode = (id: string, patch: (n: GraphNode) => void, committed: boolean) => {
      const cur = doc.materials.get(matId);
      if (!cur?.graph) return;
      scrub.current ??= { before: structuredClone(cur) };
      const nodes = cur.graph.nodes.map((n) => {
        if (n.id !== id) return n;
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

    const inspect = (nodeId: string) => setInspected({ materialId: matId, nodeId });

    const handlers: EditorHandlers = {
      onStructureChanged: () => {
        const cur = doc.materials.get(matId)?.graph;
        const h = editorRef.current;
        if (!cur || !h) return;
        const s = h.readStructure();
        const byId = new Map(cur.nodes.map((n) => [n.id, n]));
        const nodes = s.nodeIds
          .map((id) => {
            const c = byId.get(id);
            return c ? { ...c, position: s.positions[id] ?? c.position } : null;
          })
          .filter((n): n is NonNullable<typeof n> => n !== null);
        // one wire per input socket: last connection wins
        const seen = new Set<string>();
        const connections: MaterialGraphDTO["connections"] = [];
        for (const c of [...s.connections].reverse()) {
          const key = `${c.to.node}/${c.to.socket}`;
          if (seen.has(key)) continue;
          seen.add(key);
          connections.unshift(c);
        }
        const next: MaterialGraphDTO = { nodes, connections, output: cur.output };
        // no-op guard: picking a wire off and re-dropping it on the same socket
        // (or a drag that lands where it started) must not push an undo step
        if (JSON.stringify(next) === JSON.stringify(cur)) return;
        setGraph(next);
      },
      onNodeClicked: inspect,
      onNodeInspect: (nodeId) => {
        inspect(nodeId);
        focusPanel("attributes");
      },
      onDeleteNodes: (ids) => {
        const cur = doc.materials.get(matId)?.graph;
        if (!cur) return;
        const drop = new Set(ids.filter((id) => id !== cur.output)); // Output stays
        if (drop.size === 0) return;
        const nodes = cur.nodes.filter((n) => !drop.has(n.id));
        const connections = cur.connections.filter(
          (c) => !drop.has(c.from.node) && !drop.has(c.to.node),
        );
        setInspected(null);
        setGraph({ ...cur, nodes, connections });
      },
      onCopyNode: (id, originalPos) => {
        const cur = doc.materials.get(matId)?.graph;
        const h = editorRef.current;
        if (!cur || !h) return;
        const s = h.readStructure();
        const src = cur.nodes.find((n) => n.id === id);
        if (!src) return;
        const dropPos = s.positions[id] ?? src.position ?? originalPos;
        // the original keeps its id + wires and snaps back to where the drag
        // started; the copy (fresh id, same values, no wires) takes the drop
        // spot — one commit, one undo step. Other nodes keep any moved positions.
        const nodes = cur.nodes.map((n) => {
          const position = n.id === id ? originalPos : (s.positions[n.id] ?? n.position);
          return { ...n, position };
        });
        const clone: GraphNode = { ...structuredClone(src), id: uuidv7(), position: dropPos };
        setGraph({ ...cur, nodes: [...nodes, clone] });
      },
      onBackgroundMenu: (clientX, clientY, pos) => {
        openContextMenu({ x: clientX, y: clientY, entries: addNodeMenu(pos, addNode) });
      },
      onNodeSelect: (id, key, value) =>
        patchNode(
          id,
          (n) => {
            n.select = { ...n.select, [key]: value };
          },
          true,
        ),
      onNodeParam: (id, key, value, committed) =>
        patchNode(
          id,
          (n) => {
            n.params = { ...n.params, [key]: value };
          },
          committed,
        ),
      onNodeColor: (id, key, hex, committed) =>
        patchNode(
          id,
          (n) => {
            n.colors = { ...n.colors, [key]: hex };
          },
          committed,
        ),
    };

    const addNode = (kind: GraphNodeKind, pos: [number, number]) => {
      const cur = doc.materials.get(matId)?.graph;
      if (!cur) return;
      const node = defaultGraphNode(uuidv7(), kind, pos);
      setGraph({ ...cur, nodes: [...cur.nodes, node] });
    };

    let handle: EditorHandle | null = null;
    let disposed = false;
    void mountNodeEditor(host, graph, handlers, initial).then((h) => {
      if (disposed) h.destroy();
      else {
        editorRef.current = handle = h;
        applyThumbs(); // a rebuild mounts fresh imgs — refill from the cache
      }
    });
    return () => {
      disposed = true;
      if (handle) pendingXform.current = handle.getTransform();
      handle?.destroy();
      if (editorRef.current === handle) editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the canvas signature gates rebuilds (see header)
  }, [matId, sig]);

  if (!dto) return <Empty>Select a material to edit its node graph.</Empty>;
  if (!graph) {
    return (
      <Empty>
        <p className="opacity-70">
          <span className="font-medium">{dto.name}</span> has no node graph.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() =>
            doc.history.run(
              new UpdateMaterialCommand(dto, { ...dto, graph: starterGraph() }, "Add Node Graph"),
            )
          }
        >
          Create Node Graph
        </button>
      </Empty>
    );
  }
  return (
    <div ref={hostRef} className="dot-bg bg-base-300 relative h-full w-full overflow-hidden" />
  );
}

/** The Add-Node submenu — one entry per addable kind, placed at the cursor. */
function addNodeMenu(
  pos: [number, number],
  add: (kind: GraphNodeKind, pos: [number, number]) => void,
): MenuEntry[] {
  return [
    {
      label: "Add Node",
      children: ADDABLE.map((kind) => ({
        label: GRAPH_NODE_DEFS[kind].label,
        run: () => add(kind, pos),
      })),
    },
  ];
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-base-content flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center text-sm">
      {children}
    </div>
  );
}
