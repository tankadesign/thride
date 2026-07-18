import type { Raycaster } from "three";
import type { Uuid } from "@/types/core";
import { componentClick } from "./componentClick";
import type { ViewportSystem } from "./ViewportSystem";

/** First raycast hit that resolves to a visible node, or null. */
export function firstVisibleNode(
  vs: ViewportSystem,
  hits: ReturnType<Raycaster["intersectObject"]>,
): Uuid | null {
  for (const h of hits) {
    const id = vs.sync.visibleNodeIdOf(h.object);
    if (id) return id;
  }
  return null;
}

/**
 * Press-initiated interactions that take priority over both camera navigation
 * and selection: armed weld drag, spline point edit, primitive handles, the
 * transform gizmo, and the ortho move-only view drag. Returns true when one of
 * them consumed the press (so the caller must not start a nav drag or select).
 * Assumes button 0 (left) — the only button these bind to.
 */
export function tryInteractivePress(vs: ViewportSystem, e: PointerEvent, pane: number): boolean {
  // armed weld tool captures point-mode clicks before gizmo/handles: drag a
  // vertex to slide-weld, or fall through to a normal component click
  if (vs.doc.selection.editMode === "point" && vs.editor.weldArmed) {
    if (!vs.weldTool.beginDrag(e, pane)) componentClick(vs, e, pane, "point");
    vs.invalidate();
    return true;
  }
  // point mode on a spline node: anchors + tangent handles
  if (vs.splineEdit.context()) {
    if (!vs.splineEdit.pointerDown(e)) {
      // empty click clears this spline's point selection
      const active = vs.doc.selection.active;
      if (active && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        vs.doc.selection.clearComponents(active, "point");
      }
    }
    vs.invalidate();
    return true;
  }
  const rig = vs.setRayFromEvent(e, pane);
  // primitive adjustment handles take priority over the gizmo
  if (vs.handles.pointerDown(vs.raycaster, vs.activeObject())) {
    vs.invalidate();
    return true;
  }
  if (vs.gizmo.pointerDown(vs.raycaster)) {
    vs.invalidate();
    return true;
  }
  // move-only mode in a 2D pane: a drag ANYWHERE slides the selection in the
  // pane's plane (handles and gizmo picks above keep precedence)
  if (
    !rig.isPerspective &&
    vs.gizmo.currentMode === "translate" &&
    vs.doc.selection.editMode === "object" &&
    vs.gizmo.beginViewDrag(vs.raycaster)
  ) {
    vs.invalidate();
    return true;
  }
  return false;
}

/**
 * The selection fallback when no interactive press grabbed: component modes
 * lock the click to the active editable mesh; object mode raycasts the scene
 * and selects (shift = add, cmd/ctrl = toggle) or clears on empty space.
 */
export function performSelectionClick(vs: ViewportSystem, e: PointerEvent, pane: number): void {
  vs.setRayFromEvent(e, pane);
  const mode = vs.doc.selection.editMode;
  if (mode === "point" || mode === "edge" || mode === "polygon") {
    componentClick(vs, e, pane, mode);
    vs.invalidate();
    return;
  }
  // click select — skip hidden objects (raycaster ignores .visible)
  const nodeId = firstVisibleNode(vs, vs.raycaster.intersectObject(vs.sync.root, true));
  if (nodeId) {
    const op = e.shiftKey ? "add" : e.metaKey || e.ctrlKey ? "toggle" : "replace";
    vs.doc.selection.selectObjects([nodeId], op);
  } else if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
    vs.doc.selection.clearObjects();
  }
  vs.invalidate();
}
