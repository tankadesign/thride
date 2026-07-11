import type { Vector3 } from "three";
import type { Uuid } from "@/types/core";
import { vertsForSelection } from "@/geometry/kernel/components";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { findSnap, type SnapCandidate, type SnapHit } from "@/render/picking/snapPoint";
import type { ViewportSystem } from "./ViewportSystem";

/**
 * Magnet-snap plumbing for ViewportInput (split out for the 500-line rule):
 * candidate collection (every editable mesh), the dragged-geometry exclusion,
 * and the world→screen projection for the snap marker.
 */

/** Snap a moved pivot to the nearest scene vertex/edge; returns the hit too. */
export function snapPivot(
  vs: ViewportSystem,
  world: Vector3,
): { snapped: Vector3; hit: SnapHit } | null {
  const pane = vs.editor.activePane;
  const hit = findSnap(
    world,
    vs.rigFor(pane).camera,
    vs.paneRect(pane),
    snapCandidates(vs),
    snapExclude(vs),
  );
  return hit ? { snapped: hit.world, hit } : null;
}

/** Every editable mesh in the scene as a snap target. */
function snapCandidates(vs: ViewportSystem): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  for (const n of vs.doc.scene.toDTO()) {
    if (n.kind !== "mesh") continue;
    const ref = (n.data as { mesh?: { id: Uuid } } | undefined)?.mesh;
    const mesh = ref ? meshRegistry.get(ref.id) : undefined;
    const object = vs.sync.object(n.id);
    if (ref && mesh && object) out.push({ meshId: ref.id, mesh, object });
  }
  return out;
}

/** Skip the geometry currently being dragged so it can't snap to itself. */
function snapExclude(vs: ViewportSystem): (meshId: string, v: number) => boolean {
  const doc = vs.doc;
  const mode = doc.selection.editMode;
  if (mode === "point" || mode === "edge" || mode === "polygon") {
    const active = doc.selection.active;
    const ref = active
      ? (doc.scene.get(active)?.data?.mesh as { id: Uuid } | undefined)
      : undefined;
    const mesh = ref ? meshRegistry.get(ref.id) : undefined;
    const sel = active && ref ? doc.selection.componentsFor(active, mode) : undefined;
    if (ref && mesh && sel) {
      const dragged = new Set(vertsForSelection(mesh, mode, sel.bits));
      return (mid, v) => mid === ref.id && dragged.has(v);
    }
    return () => false;
  }
  const selMeshes = new Set<string>();
  for (const id of doc.selection.objectIds) {
    const ref = doc.scene.get(id)?.data?.mesh as { id: Uuid } | undefined;
    if (ref) selMeshes.add(ref.id);
  }
  return (mid) => selMeshes.has(mid);
}

/** Project a world snap target to canvas pixels for the DOM marker. */
export function snapScreen(vs: ViewportSystem, world: Vector3): { x: number; y: number } {
  const pane = vs.paneRect(vs.editor.activePane);
  const cam = vs.rigFor(vs.editor.activePane).camera;
  cam.updateMatrixWorld();
  const v = world.clone().applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
  return { x: pane.x + ((v.x + 1) / 2) * pane.w, y: pane.y + ((1 - v.y) / 2) * pane.h };
}
