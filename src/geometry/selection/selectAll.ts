import type { Uuid } from "@/types/core";
import type { Document } from "@/core";
import { Bitset } from "@/core/selection/Bitset";
import type { SplineData } from "@/types/geometry/spline";
import { uniqueEdges } from "@/geometry/kernel/components";
import { splineStamp } from "@/geometry/splines/eval";
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
  const node = doc.scene.mustGet(active);
  // spline in point mode: select all anchors
  if (node.kind === "spline" && mode === "point") {
    const data = node.data?.spline as SplineData | undefined;
    if (!data || data.points.length === 0) return;
    const sBits = new Bitset();
    const sOrder: number[] = [];
    for (let i = 0; i < data.points.length; i++) {
      sBits.add(i);
      sOrder.push(i);
    }
    doc.selection.setComponents(active, {
      mode,
      bits: sBits,
      order: sOrder,
      topologyVersion: splineStamp(data),
    });
    return;
  }
  const meshRef = node.data?.mesh as { id: Uuid } | undefined;
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
