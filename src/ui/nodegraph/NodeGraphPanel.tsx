import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { UpdateMaterialCommand, uuidv7 } from "@/core";
import {
  defaultGraphNode,
  GRAPH_NODE_DEFS,
  type GraphNodeKind,
  type MaterialGraphDTO,
} from "@/types/core";
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
 * Node material editor panel (E7). The canvas is WIRING ONLY — connect/add/delete
 * nodes and double-click a node to edit its values in the Attributes panel.
 *
 * Remounts are gated on a TOPOLOGY signature (node ids+kinds + wiring), never on
 * values: editing a param/colour/dropdown in Attributes changes the graph but not
 * the topology, so the canvas is never rebuilt underfoot (which is what made the
 * old inline-editing version flicker/blank). The editor rebuilds only on add/
 * delete/undo/redo/material-switch; connect/disconnect stamp the signature so the
 * canvas — which already shows the edit — isn't rebuilt. The view transform is
 * preserved across rebuilds.
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

/** Topology fingerprint — what a canvas rebuild actually depends on (not values). */
function topoSig(g?: MaterialGraphDTO): string {
  if (!g) return "";
  const nodes = g.nodes
    .map((n) => `${n.id}:${n.kind}`)
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
  const sig = topoSig(graph);

  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const lastSig = useRef<string>("");
  const lastMat = useRef<string | undefined>(undefined);
  const pendingXform = useRef<Transform | undefined>(undefined);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !graph || !matId) return;
    if (sig === lastSig.current) return; // canvas already reflects this topology
    lastSig.current = sig;
    const initial = lastMat.current === matId ? pendingXform.current : undefined;
    lastMat.current = matId;

    /** Commit `next` as the material's graph. `stamp` suppresses the rebuild
     *  (the canvas already shows the change, e.g. a Rete connect/move). */
    const setGraph = (next: MaterialGraphDTO, stamp: boolean) => {
      const cur = doc.materials.get(matId);
      if (!cur) return;
      if (stamp) lastSig.current = topoSig(next);
      doc.history.run(new UpdateMaterialCommand(cur, { ...cur, graph: next }, "Edit Node Graph"));
    };

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
        setGraph({ nodes, connections, output: cur.output }, true); // canvas already shows it
      },
      onNodeInspect: (nodeId) => {
        setInspected({ materialId: matId, nodeId });
        focusPanel("attributes");
      },
      onBackgroundMenu: (clientX, clientY, pos) => {
        openContextMenu({ x: clientX, y: clientY, entries: addNodeMenu(pos, addNode) });
      },
      onNodeMenu: (id, clientX, clientY) => {
        const cur = doc.materials.get(matId)?.graph;
        if (!cur || id === cur.output) return; // the Output sink isn't deletable
        openContextMenu({
          x: clientX,
          y: clientY,
          entries: [
            { label: "Edit Node", run: () => handlers.onNodeInspect(id) },
            { label: "Delete Node", run: () => deleteNode(id) },
          ],
        });
      },
    };

    const addNode = (kind: GraphNodeKind, pos: [number, number]) => {
      const cur = doc.materials.get(matId)?.graph;
      if (!cur) return;
      const node = defaultGraphNode(uuidv7(), kind, pos);
      setGraph({ ...cur, nodes: [...cur.nodes, node] }, false); // rebuild to show it
    };

    const deleteNode = (id: string) => {
      const cur = doc.materials.get(matId)?.graph;
      if (!cur) return;
      const nodes = cur.nodes.filter((n) => n.id !== id);
      const connections = cur.connections.filter((c) => c.from.node !== id && c.to.node !== id);
      setInspected(null);
      setGraph({ ...cur, nodes, connections }, false);
    };

    let handle: EditorHandle | null = null;
    let disposed = false;
    void mountNodeEditor(host, graph, handlers, initial).then((h) => {
      if (disposed) h.destroy();
      else editorRef.current = handle = h;
    });
    return () => {
      disposed = true;
      if (handle) pendingXform.current = handle.getTransform();
      handle?.destroy();
      if (editorRef.current === handle) editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- topology sig gates rebuilds (see header)
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
  return <div ref={hostRef} className="bg-base-300 relative h-full w-full overflow-hidden" />;
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
