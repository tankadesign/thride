import type { Uuid } from "@/types/core";
import type { Document } from "@/core";
import { Bitset } from "@/core/selection/Bitset";
import { uniqueEdges } from "@/geometry/kernel/components";
import { meshRegistry } from "@/geometry/store/meshRegistry";

/**
 * Mode-aware "Select All" (viewport A): in object mode selects every scene
 * node; in a component mode selects all components of the active editable
 * mesh (points → vertices, edges → canonical edges, polygons → faces). A
 * no-op when a component mode has no editable mesh under focus.
 */
export function selectAll(doc: Document): void {
  const mode = doc.selection.editMode;
  if (mode === "object") {
    doc.selection.selectObjects(doc.scene.toDTO().map((n) => n.id as Uuid));
    return;
  }
  if (mode !== "point" && mode !== "edge" && mode !== "polygon") return; // texture: no-op
  const active = doc.selection.active;
  if (!active || !doc.scene.has(active)) return;
  const meshRef = doc.scene.mustGet(active).data?.mesh as { id: Uuid } | undefined;
  const mesh = meshRef ? meshRegistry.get(meshRef.id) : undefined;
  if (!mesh) return;

  const bits = new Bitset();
  const order: number[] = [];
  const push = (id: number) => {
    bits.add(id);
    order.push(id);
  };
  if (mode === "point") for (let v = 0; v < mesh.vCount; v++) push(v);
  else if (mode === "edge") for (const h of uniqueEdges(mesh)) push(h);
  else for (let f = 0; f < mesh.fCount; f++) push(f);

  doc.selection.setComponents(active, { mode, bits, order, topologyVersion: mesh.topologyVersion });
}
