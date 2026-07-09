import { Vector3 } from "three";
import type { ViewportSystem } from "./ViewportSystem";

type NavMode = "orbit" | "pan" | "dolly" | null;

/**
 * All pointer/wheel/key input for a ViewportSystem: C4D navigation
 * (Alt+LMB orbit-around-pick, Alt+MMB pan, Alt+RMB dolly), MMB pane
 * maximize, pick/gizmo/handle drags, and right-click context requests.
 * Split from ViewportSystem to keep both under the 500-line rule.
 */
export class ViewportInput {
  private readonly vs: ViewportSystem;
  private nav: {
    mode: NavMode;
    pane: number;
    lastX: number;
    lastY: number;
    pivot: Vector3 | null;
  } | null = null;
  private mmbClick: { x: number; y: number; pane: number } | null = null;

  constructor(vs: ViewportSystem) {
    this.vs = vs;
    vs.canvas.addEventListener("pointerdown", this.onPointerDown);
    vs.canvas.addEventListener("pointermove", this.onPointerMove);
    vs.canvas.addEventListener("pointerup", this.onPointerUp);
    vs.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    vs.canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
  }

  dispose(): void {
    const c = this.vs.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("wheel", this.onWheel);
    c.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
  }

  private onPointerDown = (e: PointerEvent): void => {
    const vs = this.vs;
    const rect = vs.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pane = vs.paneAt(x, y);
    vs.editor.setActivePane(pane);
    try {
      vs.canvas.setPointerCapture(e.pointerId);
    } catch {
      // synthetic/test events have no active pointer — capture is best-effort
    }

    if (!e.altKey && e.button === 1) {
      // MMB click (no drag): maximize pane / back to 4-up — armed until movement
      this.mmbClick = { x: e.clientX, y: e.clientY, pane };
      e.preventDefault();
      return;
    }

    if (e.altKey) {
      const mode: NavMode =
        e.button === 0 ? "orbit" : e.button === 1 ? "pan" : e.button === 2 ? "dolly" : null;
      let pivot: Vector3 | null = null;
      let marker = { x, y };
      if (mode === "orbit") {
        // C4D: orbit around the point under the cursor; empty click orbits
        // the viewport center (no view jump either way — free-camera rig)
        const rig = vs.setRayFromEvent(e, pane);
        if (rig.isPerspective) {
          const hit = vs.raycaster.intersectObject(vs.sync.root, true)[0];
          pivot = rig.beginOrbitPivot(hit?.point ?? null);
          if (!hit) {
            // marker sits where the pivot actually is: the pane center
            const paneRect = vs.paneRect(pane);
            marker = { x: paneRect.x + paneRect.w / 2, y: paneRect.y + paneRect.h / 2 };
          }
        }
      }
      this.nav = { mode, pane, lastX: e.clientX, lastY: e.clientY, pivot };
      vs.onNavMarker?.(marker);
      e.preventDefault();
      return;
    }

    if (e.button === 0) {
      vs.setRayFromEvent(e, pane);
      // primitive adjustment handles take priority over the gizmo
      if (vs.handles.pointerDown(vs.raycaster, vs.activeObject())) {
        vs.invalidate();
        return;
      }
      if (vs.gizmo.pointerDown(vs.raycaster)) {
        vs.invalidate();
        return;
      }
      // click select
      const hit = vs.raycaster.intersectObject(vs.sync.root, true)[0];
      const nodeId = hit ? vs.sync.nodeIdOf(hit.object) : null;
      if (nodeId) {
        const op = e.shiftKey ? "add" : e.metaKey || e.ctrlKey ? "toggle" : "replace";
        vs.doc.selection.selectObjects([nodeId], op);
      } else if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
        vs.doc.selection.clearObjects();
      }
      vs.invalidate();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const vs = this.vs;
    if (this.mmbClick) {
      const moved = Math.hypot(e.clientX - this.mmbClick.x, e.clientY - this.mmbClick.y);
      if (moved > 4) this.mmbClick = null; // became a drag, not a click
    }
    if (this.nav?.mode) {
      const dx = e.clientX - this.nav.lastX;
      const dy = e.clientY - this.nav.lastY;
      this.nav.lastX = e.clientX;
      this.nav.lastY = e.clientY;
      const rig = vs.rigFor(this.nav.pane);
      const rect = vs.paneRect(this.nav.pane);
      if (this.nav.mode === "orbit" && this.nav.pivot) rig.orbitAround(this.nav.pivot, dx, dy);
      if (this.nav.mode === "pan") rig.pan(dx, dy, rect.h);
      if (this.nav.mode === "dolly") rig.dolly(dy * 2.5);
      vs.invalidate();
      return;
    }
    if (vs.handles.isDragging) {
      vs.setRayFromEvent(e, vs.editor.activePane);
      vs.handles.pointerMove(vs.raycaster);
      vs.invalidate();
      return;
    }
    if (vs.gizmo.isDragging) {
      vs.setRayFromEvent(e, vs.editor.activePane);
      vs.gizmo.pointerMove(vs.raycaster, {
        uniformScale: e.shiftKey,
        snap: e.shiftKey,
        snapSize: vs.editor.gridSnapSize,
      });
      vs.invalidate();
      return;
    }
    // hover feedback: handles win over gizmo (matching pick priority)
    const rect = vs.canvas.getBoundingClientRect();
    const pane = vs.paneAt(e.clientX - rect.left, e.clientY - rect.top);
    vs.setRayFromEvent(e, pane);
    vs.handles.updateHover(vs.raycaster);
    vs.gizmo.updateHover(vs.raycaster);
    vs.invalidate();
  };

  private onPointerUp = (e: PointerEvent): void => {
    const vs = this.vs;
    try {
      vs.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // see setPointerCapture note
    }
    if (this.mmbClick && e.button === 1) {
      const pane = this.mmbClick.pane;
      this.mmbClick = null;
      vs.editor.toggleMaximize(pane);
      vs.invalidate();
      return;
    }
    if (this.nav) {
      this.nav = null;
      vs.onNavMarker?.(null);
      return;
    }
    if (vs.handles.isDragging) {
      vs.handles.pointerUp();
      vs.invalidate();
      return;
    }
    if (vs.gizmo.isDragging) {
      vs.gizmo.pointerUp();
      vs.invalidate();
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const vs = this.vs;
    const rect = vs.canvas.getBoundingClientRect();
    const pane = vs.paneAt(e.clientX - rect.left, e.clientY - rect.top);
    vs.rigFor(pane).dolly(e.deltaY * 1.2);
    vs.invalidate();
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
    const vs = this.vs;
    const me = e as MouseEvent;
    if (me.altKey) return; // alt+RMB is dolly
    const rect = vs.canvas.getBoundingClientRect();
    const pane = vs.paneAt(me.clientX - rect.left, me.clientY - rect.top);
    vs.setRayFromEvent(me, pane);
    const hit = vs.raycaster.intersectObject(vs.sync.root, true)[0];
    const nodeId = hit ? vs.sync.nodeIdOf(hit.object) : null;
    vs.onContextMenuRequest?.({ clientX: me.clientX, clientY: me.clientY, pane, nodeId });
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const vs = this.vs;
    if (e.key !== "Escape") return;
    if (vs.handles.isDragging) {
      vs.handles.cancelDrag();
      vs.invalidate();
    } else if (vs.gizmo.isDragging) {
      vs.gizmo.cancelDrag();
      vs.invalidate();
    }
  };
}
