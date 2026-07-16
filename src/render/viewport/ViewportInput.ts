import { Raycaster, Vector3 } from "three";
import type { Uuid } from "@/types/core";
import type { GizmoMode } from "@/render/gizmo/TransformGizmo";
import { selectAll } from "@/geometry/selection/selectAll";
import type { SnapHit } from "@/render/picking/snapPoint";
import { componentClick } from "./componentClick";
import {
  applyCameraNavTick,
  beginCameraNav,
  commitCameraNav,
  updateCameraNav,
} from "./cameraNavWriteback";
import { snapPivot, snapScreen } from "./inputSnap";
import type { ViewportSystem } from "./ViewportSystem";

type NavMode = "orbit" | "pan" | "dolly" | null;

/** Bare-key gizmo modes (C4D-flavored): E move, R rotate, T scale, V multi. */
const GIZMO_MODE_KEYS: Record<string, GizmoMode | undefined> = {
  e: "translate",
  r: "rotate",
  t: "scale",
  v: "all",
};

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
  /** Live-bevel width scrub state. */
  private bevelDrag: { startY: number; lastY: number; moved: boolean } | null = null;
  /** Snap target hit during the current gizmo move (for the magnet marker). */
  private lastSnap: SnapHit | null = null;
  /** RMB cancelled a modal tool — swallow the contextmenu it also fires. */
  private suppressContext = false;
  /** Pointer is over the canvas — gates viewport-scoped keys (Select All). */
  private pointerInside = false;

  constructor(vs: ViewportSystem) {
    this.vs = vs;
    vs.canvas.addEventListener("pointerdown", this.onPointerDown);
    vs.canvas.addEventListener("pointermove", this.onPointerMove);
    vs.canvas.addEventListener("pointerup", this.onPointerUp);
    vs.canvas.addEventListener("pointerenter", this.onPointerEnter);
    vs.canvas.addEventListener("pointerleave", this.onPointerLeave);
    vs.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    vs.canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
  }

  dispose(): void {
    const c = this.vs.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointerenter", this.onPointerEnter);
    c.removeEventListener("pointerleave", this.onPointerLeave);
    c.removeEventListener("wheel", this.onWheel);
    c.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
  }

  private onPointerEnter = (): void => {
    this.pointerInside = true;
  };

  private onPointerLeave = (): void => {
    this.pointerInside = false;
  };

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

    // Blender-style modal (extrude/inset): LMB confirms, RMB cancels
    if (vs.modalTool) {
      if (e.button === 0) vs.modalTool.confirm();
      else if (e.button === 2) {
        vs.modalTool.cancel();
        this.suppressContext = true;
      }
      vs.invalidate();
      e.preventDefault();
      return;
    }

    // Pen tool: LMB locks the plane / places points; RMB finishes.
    // Alt-nav stays available so you can orbit while drawing.
    if (vs.penTool.isActive && !e.altKey) {
      if (e.button === 0) vs.penTool.onPointerDown(e);
      else if (e.button === 2) {
        vs.penTool.finish();
        this.suppressContext = true;
      }
      e.preventDefault();
      return;
    }

    // Live bevel tool: LMB drag scrubs width, a plain click applies, RMB cancels
    if (vs.bevelTool.isActive && !e.altKey) {
      if (e.button === 0) {
        this.bevelDrag = { startY: e.clientY, lastY: e.clientY, moved: false };
        vs.bevelTool.beginWidthDrag();
      } else if (e.button === 2) {
        vs.bevelTool.cancel();
        this.suppressContext = true;
      }
      e.preventDefault();
      return;
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
      if (mode === "orbit" || mode === "dolly") {
        // C4D: orbit AND dolly pivot on the point under the cursor (the
        // crosshair), so zooming homes in on the picked object just like
        // rotating spins around it. Empty click falls back to the viewport
        // center — no view jump either way (free-camera rig).
        const rig = vs.setRayFromEvent(e, pane);
        const hit = vs.raycaster.intersectObject(vs.sync.root, true)[0];
        if (rig.isPerspective) {
          pivot = rig.beginOrbitPivot(hit?.point ?? null);
          if (!hit) {
            // marker sits where the pivot actually is: the pane center
            const paneRect = vs.paneRect(pane);
            marker = { x: paneRect.x + paneRect.w / 2, y: paneRect.y + paneRect.h / 2 };
          }
        } else if (mode === "dolly" && hit) {
          // ortho doesn't orbit, but dolly can still zoom toward the picked
          // point; no hit → fall through to plain center zoom
          pivot = hit.point.clone();
        }
      }
      this.nav = { mode, pane, lastX: e.clientX, lastY: e.clientY, pivot };
      beginCameraNav(vs, pane);
      vs.onNavMarker?.(marker);
      e.preventDefault();
      return;
    }

    if (e.button === 0) {
      // armed weld tool captures point-mode clicks before gizmo/handles:
      // drag a vertex to slide-weld, or fall through to normal selection
      if (vs.doc.selection.editMode === "point" && vs.editor.weldArmed) {
        if (!vs.weldTool.beginDrag(e, pane)) componentClick(this.vs, e, pane, "point");
        vs.invalidate();
        return;
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
        return;
      }
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
      // component modes lock clicks to the active editable mesh (C4D-style)
      const mode = vs.doc.selection.editMode;
      if (mode === "point" || mode === "edge" || mode === "polygon") {
        componentClick(this.vs, e, pane, mode);
        vs.invalidate();
        return;
      }
      // click select — skip hidden objects (raycaster ignores .visible)
      const nodeId = this.firstVisibleNode(vs.raycaster.intersectObject(vs.sync.root, true));
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
    if (vs.modalTool) {
      vs.modalTool.onPointerMove(e.clientY);
      vs.invalidate();
      return;
    }
    if (this.bevelDrag) {
      const dy = e.clientY - this.bevelDrag.lastY;
      this.bevelDrag.lastY = e.clientY;
      if (Math.abs(e.clientY - this.bevelDrag.startY) > 3) this.bevelDrag.moved = true;
      if (this.bevelDrag.moved) vs.bevelTool.onWidthDrag(dy);
      return;
    }
    if (vs.penTool.isActive && !this.nav) {
      vs.penTool.onHover(e);
      return;
    }
    if (vs.splineEdit.isDragging) {
      vs.splineEdit.pointerMove(e);
      return;
    }
    if (vs.weldTool.isDragging) {
      vs.weldTool.update(e);
      vs.invalidate();
      return;
    }
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
      if (this.nav.mode === "dolly") {
        // pivot on the crosshair point when we have one (ortho empty-space
        // dolly keeps the old center zoom)
        if (this.nav.pivot) rig.dollyToward(this.nav.pivot, dy * 2.5);
        else rig.dolly(dy * 2.5);
      }
      updateCameraNav(vs, this.nav.pane, rig);
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
      this.lastSnap = null;
      vs.gizmo.pointerMove(vs.raycaster, {
        uniformScale: e.shiftKey,
        snap: e.shiftKey,
        snapSize: vs.editor.gridSnapSize,
        snapWorld: vs.editor.snapEnabled ? this.snapWorld : undefined,
      });
      // this.snapWorld (the callback above) mutates lastSnap — read past the
      // control-flow narrowing from the reset
      const hit = this.lastSnap as SnapHit | null;
      vs.onSnapMarker?.(hit ? snapScreen(vs, hit.world) : null);
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
    if (this.bevelDrag) {
      const moved = this.bevelDrag.moved;
      this.bevelDrag = null;
      vs.bevelTool.endWidthDrag();
      if (!moved) vs.bevelTool.commit(); // a plain click applies the bevel
      return;
    }
    if (vs.penTool.isActive && !this.nav) {
      vs.penTool.onPointerUp();
      return;
    }
    if (vs.splineEdit.isDragging) {
      vs.splineEdit.pointerUp();
      vs.invalidate();
      return;
    }
    if (vs.weldTool.isDragging) {
      vs.weldTool.finish();
      vs.invalidate();
      return;
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
      commitCameraNav(vs);
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
      this.lastSnap = null;
      vs.onSnapMarker?.(null);
      vs.invalidate();
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const vs = this.vs;
    const rect = vs.canvas.getBoundingClientRect();
    const pane = vs.paneAt(e.clientX - rect.left, e.clientY - rect.top);
    // zoom centers on the point under the cursor: scroll toward what you're
    // pointing at (matching alt-dolly's crosshair pivot). Perspective needs a
    // real hit for a depth; ortho rays are parallel, so the cursor's camera-
    // plane point keeps the zoom pointer-centered even over empty space.
    const rig = vs.setRayFromEvent(e, pane);
    const delta = -e.deltaY * 1.2; // wheel-up = zoom in
    const hit = vs.raycaster.intersectObject(vs.sync.root, true)[0];
    const point = hit?.point ?? (rig.isPerspective ? null : vs.raycaster.ray.origin.clone());
    if (point) rig.dollyToward(point, delta);
    else rig.dolly(delta);
    applyCameraNavTick(vs, pane, rig);
    vs.invalidate();
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
    const vs = this.vs;
    if (this.suppressContext) {
      this.suppressContext = false;
      return;
    }
    const me = e as MouseEvent;
    if (me.altKey) return; // alt+RMB is dolly
    const rect = vs.canvas.getBoundingClientRect();
    const pane = vs.paneAt(me.clientX - rect.left, me.clientY - rect.top);
    vs.setRayFromEvent(me, pane);
    // skip hidden objects — a hidden node shouldn't open its context menu
    const nodeId = this.firstVisibleNode(vs.raycaster.intersectObject(vs.sync.root, true));
    vs.onContextMenuRequest?.({ clientX: me.clientX, clientY: me.clientY, pane, nodeId });
  };

  /** A drag/modal is mid-flight — swallow viewport-scoped keys until it ends. */
  private isBusy(): boolean {
    const vs = this.vs;
    return (
      !!vs.modalTool ||
      vs.weldTool.isDragging ||
      vs.gizmo.isDragging ||
      vs.handles.isDragging ||
      this.nav !== null
    );
  }

  /** Keydown originated in a text field — leave it to the field. */
  private typingTarget(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    return (
      t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.isContentEditable
    );
  }

  /** Magnet: snap a moved pivot to the nearest scene vertex/edge (or null). */
  private snapWorld = (world: Vector3): Vector3 | null => {
    const res = snapPivot(this.vs, world);
    this.lastSnap = res?.hit ?? null;
    return res ? res.snapped : null;
  };

  /** First raycast hit that resolves to a visible node, or null. */
  private firstVisibleNode(hits: ReturnType<Raycaster["intersectObject"]>): Uuid | null {
    for (const h of hits) {
      const id = this.vs.sync.visibleNodeIdOf(h.object);
      if (id) return id;
    }
    return null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const vs = this.vs;
    // Pen tool owns its keys while active (axis picks, finish, backspace)
    if (vs.penTool.isActive && !this.typingTarget(e)) {
      if (vs.penTool.handleKey(e)) {
        e.preventDefault();
        return;
      }
    }
    // Live bevel tool: Enter bakes, Escape cancels
    if (vs.bevelTool.isActive) {
      if (e.key === "Enter") {
        vs.bevelTool.commit();
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        vs.bevelTool.cancel();
        e.preventDefault();
        return;
      }
    }
    // Select All (bare A) — only while the pointer is over the viewport and no
    // drag/modal is in flight; object mode selects all nodes, component modes
    // select all components of the active mesh
    if (e.key.toLowerCase() === "a" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (!this.pointerInside || this.isBusy() || this.typingTarget(e)) return;
      selectAll(vs.doc);
      vs.invalidate();
      e.preventDefault();
      return;
    }
    // Gizmo modes (bare key, pointer over the viewport): E move-only,
    // R rotate-only, T scale-only, V back to the full multi gizmo
    const gizmoMode = GIZMO_MODE_KEYS[e.key.toLowerCase()];
    if (gizmoMode && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (!this.pointerInside || this.isBusy() || this.typingTarget(e)) return;
      vs.gizmo.setMode(gizmoMode);
      vs.invalidate();
      e.preventDefault();
      return;
    }
    if (e.key !== "Escape") return;
    if (vs.modalTool) {
      vs.modalTool.cancel();
      vs.invalidate();
    } else if (vs.weldTool.isDragging) {
      vs.weldTool.cancel();
      vs.invalidate();
    } else if (vs.splineEdit.isDragging) {
      vs.splineEdit.cancel();
    } else if (vs.handles.isDragging) {
      vs.handles.cancelDrag();
      vs.invalidate();
    } else if (vs.gizmo.isDragging) {
      vs.gizmo.cancelDrag();
      vs.invalidate();
    }
  };
}
