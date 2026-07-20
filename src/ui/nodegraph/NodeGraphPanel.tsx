import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { UpdateMaterialCommand } from "@/core";
import { graphStructureKey } from "@/types/core";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { selectedMaterialsAtom } from "@/ui/hooks/editor/materials";
import { mountNodeEditor, type MountedEditor } from "./reteEditor";
import { starterGraph } from "./starter";

/**
 * Node material editor panel (E7 Stage 4) — a read-only Rete render of the
 * selected material's graph with pan / zoom / node-selection. If the material has
 * no graph yet, offers to seed the canonical `noise → ramp → color` starter,
 * which then renders live on the object (via MaterialSync) and here.
 *
 * The Rete editor is imperative and lives outside React's tree, so it's mounted
 * into a host div and rebuilt when the material or the graph STRUCTURE changes.
 * Param-value scrubs don't rebuild (nothing to re-lay-out) — full in-panel
 * editing is Stage 5.
 */
export function NodeGraphPanel() {
  const doc = useDocument();
  useSliceVersion("materials"); // re-render when the material library changes
  const selected = useAtomValue(selectedMaterialsAtom);
  const matId = selected[0];
  const dto = matId ? doc.materials.get(matId) : undefined;
  const graph = dto?.graph;
  const structKey = graphStructureKey(graph);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !graph) return;
    let mounted: MountedEditor | null = null;
    let disposed = false;
    void mountNodeEditor(host, graph).then((m) => {
      if (disposed) m.destroy();
      else mounted = m;
    });
    return () => {
      disposed = true;
      mounted?.destroy();
    };
    // rebuild only on material switch or a structural graph change (see header)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matId, structKey]);

  if (!dto) {
    return <Empty>Select a material to edit its node graph.</Empty>;
  }
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

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-base-content flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center text-sm">
      {children}
    </div>
  );
}
