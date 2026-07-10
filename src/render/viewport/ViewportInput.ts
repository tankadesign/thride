import { Mesh, Raycaster, Vector3 } from "three";
import type { ComponentMode, Uuid } from "@/types/core";
import { Bitset } from "@/core/selection/Bitset";
import { selectAll } from "@/geometry/selection/selectAll";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { pickComponent } from "@/render/picking/componentPicking";
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
      vs.beginCameraNav(pane);
      vs.onNavMarker?.(marker);
      e.preventDefault();
      return;
    }

    if (e.button === 0) {
      // armed weld tool captures point-mode clicks before gizmo/handles:
      // drag a vertex to slide-weld, or fall through to normal selection
      if (vs.doc.selection.editMode === "point" && vs.editor.weldArmed) {
        if (!vs.weldTool.beginDrag(e, pane)) this.componentClick(e, pane, "point");
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
        this.componentClick(e, pane, mode);
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
      if (this.nav.mode === "dolly") rig.dolly(dy * 2.5);
      vs.updateCameraNav(this.nav.pane, rig);
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
      vs.commitCameraNav();
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
    const rig = vs.rigFor(pane);
    rig.dolly(e.deltaY * 1.2);
    vs.applyCameraNavTick(pane, rig);
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

  /** Click-select components of the ACTIVE editable mesh (shift add, mod toggle). */
  private componentClick(e: PointerEvent, pane: number, mode: ComponentMode): void {
    const vs = this.vs;
    const doc = vs.doc;
    const active = doc.selection.active;
    if (!active || !doc.scene.has(active)) return;
    const meshRef = doc.scene.mustGet(active).data?.mesh as { id: Uuid } | undefined;
    const mesh = meshRef ? meshRegistry.get(meshRef.id) : undefined;
    const obj = vs.sync.object(active);
    if (!mesh || !(obj instanceof Mesh)) return; // nothing editable under this mode
    const rect = vs.canvas.getBoundingClientRect();
    const hit = pickComponent(mode, {
      mesh,
      meshObject: obj,
      camera: vs.rigFor(pane).camera,
      pane: vs.paneRect(pane),
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      raycaster: vs.raycaster,
      triFace: vs.sync.renderInfoFor(active)?.triFace ?? null,
    });
    const op = e.shiftKey ? "add" : e.metaKey || e.ctrlKey ? "toggle" : "replace";
    if (hit === null) {
      // clear only THIS mode's selection — other modes keep their memory
      if (op === "replace") doc.selection.clearComponents(active, mode);
      return;
    }
    const prev = doc.selection.componentsFor(active, mode);
    const valid = prev && prev.topologyVersion === mesh.topologyVersion;
    const bits = valid && op !== "replace" ? prev.bits.clone() : new Bitset();
    const order = valid && op !== "replace" ? [...prev.order] : [];
    if (op === "toggle" && bits.has(hit)) {
      bits.delete(hit);
      const i = order.indexOf(hit);
      if (i !== -1) order.splice(i, 1);
    } else if (!bits.has(hit)) {
      bits.add(hit);
      order.push(hit);
    }
    doc.selection.setComponents(active, {
      mode,
      bits,
      order,
      topologyVersion: mesh.topologyVersion,
    });
  }

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
    if (e.key !== "Escape") return;
    if (vs.modalTool) {
      vs.modalTool.cancel();
      vs.invalidate();
    } else if (vs.weldTool.isDragging) {
      vs.weldTool.cancel();
      vs.invalidate();
    } else if (vs.handles.isDragging) {
      vs.handles.cancelDrag();
      vs.invalidate();
    } else if (vs.gizmo.isDragging) {
      vs.gizmo.cancelDrag();
      vs.invalidate();
    }
  };
}
