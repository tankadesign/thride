import { Vector3 } from "three";
import { modsOf } from "@/core/keymap/chord";
import { matchMouseBinding } from "@/core/keymap/resolve";
import type { MouseBinding, NavAction } from "@/types/keymap";
import type { SnapHit } from "@/render/picking/snapPoint";
import {
  applyCameraNavTick,
  beginCameraNav,
  commitCameraNav,
  updateCameraNav,
} from "./cameraNavWriteback";
import { snapPivot, snapScreen } from "./inputSnap";
import { firstVisibleNode, performSelectionClick, tryInteractivePress } from "./pointerPick";
import type { ViewportSystem } from "./ViewportSystem";

type NavMode = NavAction | null;

/** A press whose binding can resolve to either a nav drag or a click action. */
interface Pending {
  binding: MouseBinding;
  press: PointerEvent;
  pane: number;
  startX: number;
  startY: number;
}

/**
 * All pointer/wheel/key input for a ViewportSystem. Mouse navigation is driven
 * by the active navigation preset (via editor.mouseBindings): each press is
 * matched to a binding that starts a camera drag (orbit/pan/dolly), performs a
 * fixed click action (select / context menu / pane maximize), or defers between
 * the two based on drag distance. Keyboard commands resolve through the active
 * key preset. Split from ViewportSystem to keep both under the 500-line rule.
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
  /** Armed deferred press (drag-vs-click undecided until move/up). */
  private pending: Pending | null = null;
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

  /** Start a camera nav drag, pivoting on the point under the press. */
  private beginNav(mode: NavAction, press: PointerEvent, pane: number): void {
    const vs = this.vs;
    const rect = vs.canvas.getBoundingClientRect();
    let pivot: Vector3 | null = null;
    let marker = { x: press.clientX - rect.left, y: press.clientY - rect.top };
    if (mode === "orbit" || mode === "dolly") {
      // orbit AND dolly pivot on the point under the cursor (the crosshair), so
      // zooming homes in on the picked object just like rotating spins around
      // it. Empty click falls back to the viewport center — no view jump either
      // way (free-camera rig).
      const rig = vs.setRayFromEvent(press, pane);
      const hit = vs.raycaster.intersectObject(vs.sync.root, true)[0];
      if (rig.isPerspective) {
        pivot = rig.beginOrbitPivot(hit?.point ?? null);
        if (!hit) {
          const paneRect = vs.paneRect(pane);
          marker = { x: paneRect.x + paneRect.w / 2, y: paneRect.y + paneRect.h / 2 };
        }
      } else if (mode === "dolly" && hit) {
        // ortho doesn't orbit, but dolly can still zoom toward the picked point
        pivot = hit.point.clone();
      }
    }
    this.nav = { mode, pane, lastX: press.clientX, lastY: press.clientY, pivot };
    beginCameraNav(vs, pane);
    vs.onNavMarker?.(marker);
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

    const binding = matchMouseBinding(vs.editor.mouseBindings, e.button, modsOf(e));
    const navDrag = binding?.drag ?? null;

    // Pen tool: LMB locks the plane / places points; RMB finishes. Navigation
    // (whatever the preset binds) stays available so you can orbit while drawing.
    if (vs.penTool.isActive && !navDrag) {
      if (e.button === 0) vs.penTool.onPointerDown(e);
      else if (e.button === 2) {
        vs.penTool.finish();
        this.suppressContext = true;
      }
      e.preventDefault();
      return;
    }

    // Live bevel tool: LMB drag scrubs width, a plain click applies, RMB cancels
    if (vs.bevelTool.isActive && !navDrag) {
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

    // Option-click on a spline segment inserts a point (point mode). Checked
    // BEFORE nav so it takes priority over Alt-orbit when over the curve, but
    // falls through (returns false) elsewhere so Alt-orbit still works.
    if (
      e.button === 0 &&
      e.altKey &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      vs.splineEdit.tryInsertPoint(e)
    ) {
      e.preventDefault();
      return;
    }

    if (!binding) return; // unbound press — ignore

    // pure drag → start nav now (C4D alt-drag path, unchanged feel)
    if (binding.drag && !binding.click) {
      this.beginNav(binding.drag, e, pane);
      e.preventDefault();
      return;
    }

    // deferred (drag OR click): a select-click still lets gizmo/handles grab on
    // the press; otherwise arm and decide on move/up
    if (binding.drag && binding.click) {
      if (binding.click === "select" && tryInteractivePress(vs, e, pane)) return;
      this.pending = { binding, press: e, pane, startX: e.clientX, startY: e.clientY };
      e.preventDefault();
      return;
    }

    // click-only bindings
    if (binding.click === "select") {
      // select on press (C4D LMB): interactive picks win, else raycast select
      if (!tryInteractivePress(vs, e, pane)) performSelectionClick(vs, e, pane);
      return;
    }
    if (binding.click === "maximizePane") {
      // armed until movement — a drag cancels it (matches the old MMB behavior)
      this.pending = { binding, press: e, pane, startX: e.clientX, startY: e.clientY };
      e.preventDefault();
      return;
    }
    // click === "contextMenu": the native contextmenu event handles it
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
    if (this.pending) {
      // past the threshold a deferred press becomes a drag; a click-only press
      // (maximize) simply cancels
      if (Math.hypot(e.clientX - this.pending.startX, e.clientY - this.pending.startY) > 4) {
        const p = this.pending;
        this.pending = null;
        if (p.binding.drag) {
          this.beginNav(p.binding.drag, p.press, p.pane);
          // continue the drag from the current point (no jump from the press)
          if (this.nav) {
            this.nav.lastX = e.clientX;
            this.nav.lastY = e.clientY;
          }
        }
      }
      return;
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
    // spline point mode: Option over a segment shows the "+" insert cursor
    vs.splineEdit.updateHoverCursor(e, e.altKey);
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
    if (this.pending && e.button === this.pending.press.button) {
      // sub-threshold release → the binding's click action
      const p = this.pending;
      this.pending = null;
      if (p.binding.click === "select") {
        // the interactive press already had its chance on pointer-down
        performSelectionClick(vs, e, p.pane);
      } else if (p.binding.click === "maximizePane") {
        vs.editor.toggleMaximize(p.pane);
        vs.invalidate();
      } else if (p.binding.click === "contextMenu") {
        this.requestContextMenu(e, p.pane);
      }
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

  /** Build and dispatch a context-menu request for the point under the event. */
  private requestContextMenu(e: PointerEvent | MouseEvent, pane: number): void {
    const vs = this.vs;
    vs.setRayFromEvent(e, pane);
    // point mode on a spline: right-clicking an anchor selects it, so the
    // context menu's tangent ops act on the clicked point
    vs.splineEdit.selectAtPointer(e);
    // skip hidden objects — a hidden node shouldn't open its context menu
    const nodeId = firstVisibleNode(vs, vs.raycaster.intersectObject(vs.sync.root, true));
    vs.onContextMenuRequest?.({ clientX: e.clientX, clientY: e.clientY, pane, nodeId });
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
    const vs = this.vs;
    if (this.suppressContext) {
      this.suppressContext = false;
      return;
    }
    const me = e as MouseEvent;
    // if the right button (with these modifiers) drives a nav drag, the menu is
    // suppressed here — a pan preset opens it from the pointer-up click instead
    // (mac fires contextmenu on pointer-DOWN, so it can't own the menu there)
    if (matchMouseBinding(vs.editor.mouseBindings, 2, modsOf(me))?.drag) return;
    const rect = vs.canvas.getBoundingClientRect();
    const pane = vs.paneAt(me.clientX - rect.left, me.clientY - rect.top);
    this.requestContextMenu(me, pane);
  };

  /** A drag/modal is mid-flight — swallow viewport-scoped keys until it ends. */
  isBusy(): boolean {
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
    // Viewport-scoped commands (e.g. Select All) — only while the pointer is over
    // the viewport and no drag/modal is in flight. Global commands (gizmo modes,
    // etc.) are dispatched by the Shell handler through the same active keymap.
    if (this.pointerInside && !this.isBusy() && !this.typingTarget(e)) {
      const id = vs.editor.viewportScopedCommand(e);
      if (id) {
        vs.editor.runCommand(id);
        vs.invalidate();
        e.preventDefault();
        return;
      }
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
