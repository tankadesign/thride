import type { MaterialGraphDTO, Uuid } from "@/types/core";
import type { Vec3 } from "@/materials/tsl";
import { UniformTable } from "@/materials/procedural/uniforms";
import { GraphEmit, toVec3 } from "./emit";

/**
 * Per-node preview emission (E7 Stage 6): every non-Output node's value as a
 * vec3, for the editor's node thumbnails. A fresh emit pass with its own
 * uniforms — values are baked from the DTO snapshot, so the caller just
 * re-renders after edits instead of poking uniforms. `dispose` frees the ramp
 * textures the pass created.
 */
export function emitNodePreviews(graph: MaterialGraphDTO): {
  nodes: Map<Uuid, Vec3>;
  dispose: () => void;
} {
  const emit = new GraphEmit(graph, new UniformTable());
  const nodes = new Map<Uuid, Vec3>();
  for (const n of graph.nodes) {
    if (n.kind === "output") continue;
    nodes.set(n.id, toVec3(emit.emit(n.id)));
  }
  return {
    nodes,
    dispose: () => {
      for (const r of emit.ramps.values()) r.dispose();
    },
  };
}
