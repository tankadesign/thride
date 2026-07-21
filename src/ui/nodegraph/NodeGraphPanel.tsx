import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { UpdateMaterialCommand, uuidv7 } from "@/core";
import {
  defaultGraphNode,
  GRAPH_NODE_DEFS,
  type GraphNode,
  type GraphNodeKind,
  type MaterialDTO,
  type MaterialGraphDTO,
} from "@/types/core";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { selectedMaterialsAtom } from "@/ui/hooks/editor/materials";
import { openContextMenu, type MenuEntry } from "@/ui/hooks/editor/shell";
import {
  mountNodeEditor,
  type EditorHandle,
  type EditorHandlers,
  type Transform,
} from "./reteEditor";
import { starterGraph } from "./starter";

/**
 * Node material editor panel (E7 Stages 4–5). Renders the selected material's
 * graph in Rete and commits every edit back through {@link UpdateMaterialCommand}.
 *
 * Sync model (see the advisor notes in the progress file): edits are Rete-first.
 * A JSON signature of the graph gates the remount effect — when the panel is the
 * source of the change it stamps the signature so the effect skips (no view
 * jump, scrubs stay at frame rate); an external change (undo/redo, material
 * switch) has a stale signature, so the editor rebuilds. Structural edits that
 * Rete can't reflect on its own (add/delete node, change a dropdown) deliberately
 * DON'T stamp, so they rebuild — with the view transform preserved.
 */

/** Node kinds offered in the Add-Node menu (everything but the single Output sink). */
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

export function NodeGraphPanel() {
  const doc = useDocument();
  useSliceVersion("materials");
  const selected = useAtomValue(selectedMaterialsAtom);
  const matId = selected[0];
  const dto = matId ? doc.materials.get(matId) : undefined;
  const graph = dto?.graph;
  const sig = graph ? JSON.stringify(graph) : "";

  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const lastSig = useRef<string>("");
  const lastMat = useRef<string | undefined>(undefined);
  const pendingXform = useRef<Transform | undefined>(undefined);
  const scrub = useRef<{ before: MaterialDTO } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !graph || !matId) return;
    if (sig === lastSig.current) return; // panel-originated edit → no remount
    lastSig.current = sig;
    // preserve the view across a remount of the SAME material; reframe on switch
    const initial = lastMat.current === matId ? pendingXform.current : undefined;
    lastMat.current = matId;

    /** Commit `next` as the material's graph. `stamp` suppresses the remount
     *  (the editor already shows the change); `committed` false = live scrub. */
    const setGraph = (next: MaterialGraphDTO, committed: boolean, stamp: boolean) => {
      const cur = doc.materials.get(matId);
      if (!cur) return;
      scrub.current ??= { before: structuredClone(cur) };
      const after = { ...cur, graph: next };
      if (stamp) lastSig.current = JSON.stringify(next);
      doc.updateMaterial(after, !committed);
      if (committed) {
        const before = scrub.current.before;
        scrub.current = null;
        doc.history.pushWithoutExecute(new UpdateMaterialCommand(before, after, "Edit Node Graph"));
      }
    };

    const patchNode = (id: string, patch: (n: GraphNode) => void) => {
      const cur = doc.materials.get(matId)?.graph;
      if (!cur) return null;
      const nodes = cur.nodes.map((n) => {
        if (n.id !== id) return n;
        const copy = structuredClone(n);
        patch(copy);
        return copy;
      });
      return { ...cur, nodes };
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
        // Rete already reflects connect/disconnect/move → stamp (no remount)
        setGraph({ nodes, connections, output: cur.output }, true, true);
      },
      onNodeParam: (id, key, value, committed) => {
        const next = patchNode(id, (n) => {
          n.params = { ...n.params, [key]: value };
        });
        if (next) setGraph(next, committed, true); // live uniform → no remount
      },
      onNodeColor: (id, key, hex, committed) => {
        const next = patchNode(id, (n) => {
          n.colors = { ...n.colors, [key]: hex };
        });
        if (next) setGraph(next, committed, true);
      },
      onNodeSelect: (id, key, value) => {
        const next = patchNode(id, (n) => {
          n.select = { ...n.select, [key]: value };
        });
        if (next) setGraph(next, true, false); // structural → rebuild controls
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
          entries: [{ label: "Delete Node", run: () => deleteNode(id) }],
        });
      },
    };

    const addNode = (kind: GraphNodeKind, pos: [number, number]) => {
      const cur = doc.materials.get(matId)?.graph;
      if (!cur) return;
      const node = defaultGraphNode(uuidv7(), kind, pos);
      setGraph({ ...cur, nodes: [...cur.nodes, node] }, true, false); // remount to show it
    };

    const deleteNode = (id: string) => {
      const cur = doc.materials.get(matId)?.graph;
      if (!cur) return;
      const nodes = cur.nodes.filter((n) => n.id !== id);
      const connections = cur.connections.filter((c) => c.from.node !== id && c.to.node !== id);
      setGraph({ ...cur, nodes, connections }, true, false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig gates remounts (see header)
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
