import {
  BufferGeometry,
  Euler,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Plane,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import type { Uuid, Vec3 } from "@/types/core";
import { CreateNodeCommand, SetNodeDataCommand } from "@/core/history/commands/scene";
import { uniqueSiblingName } from "@/core";
import { emptySpline, type SplineData, type SplinePointDTO } from "@/types/geometry/spline";
import { viewportTheme } from "@/render/theme/viewportTheme";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";
import {
  nearFirstAnchor,
  placeCloseMarker,
  resolvePlaneNormal,
  updateRubberBand,
} from "./penClose";
import { PenPlanePreview } from "./penPlane";

/** Drag farther than this (px) after placing to pull out smooth handles. */
const DRAG_THRESHOLD_PX = 4;

export type PenPlaneAxis = 0 | 1 | 2 | "auto";

/**
 * Spline-app-style 3D pen. Phase 1: a red work-plane preview follows the
 * cursor (auto orientation; X/Y/Z force, A auto); the first click locks it,
 * creates the spline node (transform IS the plane) and places point 1.
 * Phase 2: points map to the plane as local (x,y,0) — 2D in perspective. In
 * PROJECTION mode (S) there is no plane: clicks raycast the scene and points
 * land on whatever surface they hit, in full 3D. Click = corner, click-drag
 * = mirrored smooth handles, click the first point to close, Backspace
 * removes the last point, Enter/Escape finish. One undo step per point.
 */
export class PenTool {
  readonly group = new Group();
  private readonly vs: ViewportSystem;
  private phase: "off" | "plane" | "draw" = "off";
  private axis: PenPlaneAxis = "auto";
  /** Projection mode (S): points land on whatever surface the click hits. */
  private projection = false;
  private nodeId: Uuid | null = null;
  /** Live drag while placing a point (pull out handles). */
  private placing: { index: number; startClient: [number, number]; before: SplineData } | null =
    null;
  /** Last hover position in plane-local coords (rubber band). */
  private hoverLocal: Vector3 | null = null;

  // visuals
  private readonly planePreview = new PenPlanePreview();
  private readonly rubber: Line;
  private readonly closeMarker: Mesh;
  private readonly quat = new Quaternion();
  private readonly plane = new Plane();

  constructor(vs: ViewportSystem) {
    this.vs = vs;
    this.group.name = "pen-tool";
    this.group.visible = false;
    this.group.add(this.planePreview.group);

    this.rubber = new Line(
      new BufferGeometry(),
      new LineBasicMaterial({ color: viewportTheme.accent, transparent: true, opacity: 0.6 }),
    );
    this.rubber.raycast = () => {};
    this.rubber.frustumCulled = false;
    this.rubber.renderOrder = 950;
    this.group.add(this.rubber);

    this.closeMarker = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: viewportTheme.success, depthTest: false }),
    );
    this.closeMarker.raycast = () => {};
    this.closeMarker.frustumCulled = false;
    this.closeMarker.renderOrder = 960;
    this.closeMarker.visible = false;
    this.group.add(this.closeMarker);
  }

  get isActive(): boolean {
    return this.phase !== "off";
  }

  get isDrawing(): boolean {
    return this.phase === "draw";
  }

  toggle(): void {
    if (this.phase === "off") this.begin();
    else this.finish();
  }

  begin(): void {
    this.phase = "plane";
    this.axis = "auto";
    this.projection = false;
    this.nodeId = null;
    this.group.visible = true;
    this.rubber.visible = false;
    this.planePreview.group.visible = true;
    this.planePreview.setPicking();
    this.vs.editor.setPenActive(true);
    this.vs.canvas.style.cursor = "crosshair";
    this.vs.invalidate();
  }

  /**
   * Pen-owned keys: X/Y/Z force the work-plane axis, A auto, S toggles
   * surface-projection mode, Backspace removes the last point, Enter/Escape
   * finish. Returns true when consumed ('a' must not select-all while the
   * pen owns the viewport).
   */
  handleKey(e: KeyboardEvent): boolean {
    const k = e.key.toLowerCase();
    if (k === "escape" || k === "enter") {
      this.finish();
    } else if (k === "backspace" && this.isDrawing) {
      this.removeLastPoint();
    } else if (k === "s" && this.phase === "plane") {
      // projection mode: no work plane — clicks land on scene surfaces
      this.projection = !this.projection;
      this.planePreview.group.visible = !this.projection;
      this.vs.invalidate();
    } else if (k === "x" || k === "y" || k === "z") {
      this.setAxis(k === "x" ? 0 : k === "y" ? 1 : 2);
    } else if (k === "a") {
      this.setAxis("auto");
    } else {
      return false; // let other shortcuts (undo etc.) pass through
    }
    return true;
  }

  /** X/Y/Z force the plane axis, A returns to auto. Only in plane phase. */
  setAxis(axis: PenPlaneAxis): void {
    if (this.phase !== "plane") return;
    this.axis = axis;
    this.vs.invalidate();
  }

  /** Plane-phase hover: orient + position the red preview under the cursor. */
  onHover(e: PointerEvent): void {
    if (this.phase === "plane") {
      if (!this.projection) this.updatePlanePreview(e);
      return;
    }
    if (this.phase === "draw") {
      if (this.placing) {
        this.dragHandles(e);
        return;
      }
      const local = this.pointerToLocal(e);
      if (local) {
        this.hoverLocal = local;
        this.updateRubber();
        this.updateCloseMarker(e);
      }
    }
  }

  /** Pointer down: lock the plane / place a point / close the spline. */
  onPointerDown(e: PointerEvent): void {
    if (this.phase === "plane") {
      this.lockPlaneAndStart(e);
      return;
    }
    const data = this.data();
    if (!data) return;
    // clicking the first anchor closes (needs ≥3 points for an area)
    if (data.points.length >= 3 && this.nearFirstAnchor(e)) {
      const before = structuredClone(data);
      const after = structuredClone(data);
      after.closed = true;
      this.runData(before, after, "Close Spline");
      this.finish();
      return;
    }
    const local = this.pointerToLocal(e);
    if (!local) return;
    const before = structuredClone(data);
    const after = structuredClone(data);
    after.points.push({
      // plane mode locks z to 0; projection keeps the full surface hit
      position: [local.x, local.y, this.projection ? local.z : 0],
      inHandle: [0, 0, 0],
      outHandle: [0, 0, 0],
      mode: "linear",
    });
    // stream as preview; ONE command lands at pointer-up (handles included)
    this.doc.setNodeData(this.nodeId!, this.wrap(after), true);
    this.placing = { index: after.points.length - 1, startClient: [e.clientX, e.clientY], before };
    this.vs.invalidate();
  }

  /** Drag after placing: pull mirrored smooth handles out of the new point. */
  private dragHandles(e: PointerEvent): void {
    const placing = this.placing;
    const data = this.data();
    if (!placing || !data) return;
    const moved = Math.hypot(
      e.clientX - placing.startClient[0],
      e.clientY - placing.startClient[1],
    );
    if (moved < DRAG_THRESHOLD_PX) return;
    const after = structuredClone(data);
    const p = after.points[placing.index]!;
    // projection: handles pull on a camera-parallel plane through the anchor
    // (the cursor may leave the surface mid-drag); plane mode uses the work plane
    const local = this.projection ? this.handleDragLocal(e, p.position) : this.pointerToLocal(e);
    if (!local) return;
    const dx = local.x - p.position[0];
    const dy = local.y - p.position[1];
    const dz = this.projection ? local.z - p.position[2] : 0;
    p.outHandle = [dx, dy, dz];
    p.inHandle = [-dx, -dy, -dz];
    p.mode = "smooth";
    this.doc.setNodeData(this.nodeId!, this.wrap(after), true);
    this.vs.invalidate();
  }

  /** Cursor on the camera-parallel plane through `anchor` (node-local in/out). */
  private handleDragLocal(e: PointerEvent, anchor: Vec3): Vector3 | null {
    const obj = this.nodeId ? this.vs.sync.object(this.nodeId) : undefined;
    if (!obj) return null;
    obj.updateMatrixWorld();
    const rect = this.vs.canvas.getBoundingClientRect();
    const pane = this.vs.paneAt(e.clientX - rect.left, e.clientY - rect.top);
    this.vs.setRayFromEvent(e, pane);
    const anchorWorld = new Vector3(...anchor).applyMatrix4(obj.matrixWorld);
    const camDir = new Vector3();
    this.vs.rigFor(pane).camera.getWorldDirection(camDir);
    this.plane.setFromNormalAndCoplanarPoint(camDir, anchorWorld);
    const hit = new Vector3();
    if (!this.vs.raycaster.ray.intersectPlane(this.plane, hit)) return null;
    return obj.worldToLocal(hit);
  }

  /** Pointer up: commit the placed point (with any pulled handles) as ONE step. */
  onPointerUp(): void {
    const placing = this.placing;
    if (!placing) return;
    this.placing = null;
    const data = this.data();
    if (!data) return;
    this.doc.history.pushWithoutExecute(
      new SetNodeDataCommand(
        this.nodeId!,
        this.wrap(data),
        this.wrap(placing.before),
        "Add Point",
        false,
      ),
    );
    this.updateRubber();
  }

  /** Backspace: remove the last placed point (its own undo step). */
  removeLastPoint(): void {
    const data = this.data();
    if (!data || data.points.length === 0) return;
    if (data.points.length === 1) {
      this.cancel();
      return;
    }
    const before = structuredClone(data);
    const after = structuredClone(data);
    after.points.pop();
    this.runData(before, after, "Remove Point");
    this.updateRubber();
  }

  /** Enter / Escape / toggle: finish the spline (delete it if degenerate). */
  finish(): void {
    const data = this.data();
    if (this.phase === "draw" && this.nodeId && (!data || data.points.length < 2)) {
      // a 0/1-point spline is useless — undo its creation entirely
      this.cancel();
      return;
    }
    if (this.nodeId) this.doc.selection.selectObjects([this.nodeId]);
    this.exit();
  }

  /** Abandon: unwind the node + its points via history (they're all commands). */
  private cancel(): void {
    if (this.nodeId) {
      // every pen action since begin() touched only this node; undo them all
      while (this.doc.history.canUndo && this.doc.scene.has(this.nodeId)) {
        this.doc.history.undo();
        if (!this.doc.scene.has(this.nodeId)) break;
      }
    }
    this.exit();
  }

  private exit(): void {
    this.phase = "off";
    this.nodeId = null;
    this.placing = null;
    this.hoverLocal = null;
    this.group.visible = false;
    this.closeMarker.visible = false;
    this.vs.editor.setPenActive(false);
    this.vs.canvas.style.cursor = "";
    this.vs.invalidate();
  }

  // ---- plane handling -------------------------------------------------------

  private updatePlanePreview(e: PointerEvent): void {
    const normal = resolvePlaneNormal(this.vs, this.axis).normal;
    // the surface under the cursor sets the plane's offset along its normal
    // (hovering a box top raises a Y plane to that height; X/Z equivalent);
    // empty space falls back to the world-origin plane
    const surf = this.raycastSurface(e);
    this.plane.setFromNormalAndCoplanarPoint(normal, surf ?? new Vector3(0, 0, 0));
    const pane = this.vs.paneAt(
      e.clientX - this.vs.canvas.getBoundingClientRect().left,
      e.clientY - this.vs.canvas.getBoundingClientRect().top,
    );
    this.vs.setRayFromEvent(e, pane);
    const hit = new Vector3();
    if (!this.vs.raycaster.ray.intersectPlane(this.plane, hit)) return;
    this.quat.setFromUnitVectors(new Vector3(0, 0, 1), normal);
    this.planePreview.place(hit, this.quat);
    this.vs.invalidate();
  }

  /** First click: lock the plane (or hit a surface), create the node, place point 1. */
  private lockPlaneAndStart(e: PointerEvent): void {
    let hit: Vector3;
    if (this.projection) {
      // projection: the node anchors at the first surface hit, axis-aligned;
      // points carry full 3D offsets from there
      const surf = this.raycastSurface(e);
      if (!surf) return;
      hit = surf;
      this.quat.identity();
    } else {
      const normal = resolvePlaneNormal(this.vs, this.axis).normal;
      // same offset rule as the preview — the click lands where it showed
      const surf = this.raycastSurface(e);
      this.plane.setFromNormalAndCoplanarPoint(normal, surf ?? new Vector3(0, 0, 0));
      const pane = this.vs.paneAt(
        e.clientX - this.vs.canvas.getBoundingClientRect().left,
        e.clientY - this.vs.canvas.getBoundingClientRect().top,
      );
      this.vs.setRayFromEvent(e, pane);
      const planeHit = new Vector3();
      if (!this.vs.raycaster.ray.intersectPlane(this.plane, planeHit)) return;
      hit = planeHit;
      this.quat.setFromUnitVectors(new Vector3(0, 0, 1), normal);
    }

    // node transform IS the work plane: origin at the first click, +Z normal
    const rot = eulerFromQuat(this.quat);
    const name = uniqueSiblingName(this.doc, null, "Spline");
    const first: SplinePointDTO = {
      position: [0, 0, 0],
      inHandle: [0, 0, 0],
      outHandle: [0, 0, 0],
      mode: "linear",
    };
    const data: SplineData = { ...emptySpline(), points: [first] };
    const cmd = new CreateNodeCommand(
      "spline",
      name,
      null,
      undefined,
      { spline: data },
      {
        position: [hit.x, hit.y, hit.z],
        rotation: rot,
        scale: [1, 1, 1],
      },
    );
    this.doc.history.run(cmd);
    this.nodeId = cmd.nodeId;
    this.phase = "draw";
    // lock the preview plane where it was clicked (hidden in projection mode)
    if (!this.projection) {
      this.planePreview.place(hit, this.quat);
      this.planePreview.setLocked();
    }
    // dragging right away pulls handles out of point 0
    this.placing = {
      index: 0,
      startClient: [e.clientX, e.clientY],
      before: structuredClone(data),
    };
    // the create command already placed point 0; "before" for the pending
    // Add Point step is the single-point state (a no-op command if unchanged)
    this.vs.invalidate();
  }

  // ---- helpers --------------------------------------------------------------

  private get doc() {
    return this.vs.doc;
  }

  private data(): SplineData | null {
    if (!this.nodeId || !this.doc.scene.has(this.nodeId)) return null;
    return (this.doc.scene.mustGet(this.nodeId).data?.spline as SplineData | undefined) ?? null;
  }

  private wrap(data: SplineData): Record<string, unknown> {
    const node = this.doc.scene.mustGet(this.nodeId!);
    return { ...node.data, spline: data };
  }

  private runData(before: SplineData, after: SplineData, label: string): void {
    this.doc.history.run(
      new SetNodeDataCommand(this.nodeId!, this.wrap(after), this.wrap(before), label, false),
    );
  }

  /**
   * Cursor → node-local point. Plane mode: ray ∩ the locked work plane with
   * z=0 (the locked dimension). Projection mode: ray ∩ the nearest visible
   * surface — the point lands wherever the click hits, in full 3D.
   */
  private pointerToLocal(e: PointerEvent): Vector3 | null {
    if (!this.nodeId) return null;
    const obj = this.vs.sync.object(this.nodeId);
    if (!obj) return null;
    obj.updateMatrixWorld();
    if (this.projection) {
      const surf = this.raycastSurface(e);
      return surf ? obj.worldToLocal(surf) : null;
    }
    const rect = this.vs.canvas.getBoundingClientRect();
    const pane = this.vs.paneAt(e.clientX - rect.left, e.clientY - rect.top);
    this.vs.setRayFromEvent(e, pane);
    const normal = new Vector3(0, 0, 1).applyQuaternion(obj.quaternion).normalize();
    this.plane.setFromNormalAndCoplanarPoint(normal, obj.position);
    const hit = new Vector3();
    if (!this.vs.raycaster.ray.intersectPlane(this.plane, hit)) return null;
    const local = obj.worldToLocal(hit.clone());
    local.z = 0; // the locked dimension
    return local;
  }

  /** Nearest visible MESH surface under the cursor (never the pen's spline). */
  private raycastSurface(e: PointerEvent): Vector3 | null {
    const rect = this.vs.canvas.getBoundingClientRect();
    const pane = this.vs.paneAt(e.clientX - rect.left, e.clientY - rect.top);
    this.vs.setRayFromEvent(e, pane);
    for (const h of this.vs.raycaster.intersectObject(this.vs.sync.root, true)) {
      if (!(h.object instanceof Mesh)) continue; // lines/helpers aren't surfaces
      const nodeId = this.vs.sync.visibleNodeIdOf(h.object);
      if (!nodeId || nodeId === this.nodeId) continue;
      return h.point.clone();
    }
    return null;
  }

  /** Rubber band: the segment that WOULD be added if you clicked now. */
  private updateRubber(): void {
    const data = this.data();
    const obj = this.nodeId ? this.vs.sync.object(this.nodeId) : undefined;
    if (!data || data.points.length === 0 || !this.hoverLocal || this.placing || !obj) {
      this.rubber.visible = false;
      return;
    }
    updateRubberBand(this.rubber, obj, data, this.hoverLocal);
  }

  /** Screen distance from the cursor to the first anchor (close affordance). */
  private nearFirstAnchor(e: PointerEvent): boolean {
    const data = this.data();
    const obj = this.nodeId ? this.vs.sync.object(this.nodeId) : undefined;
    return !!data && !!obj && nearFirstAnchor(this.vs, obj, data, e);
  }

  /** Show the green "click to close" marker over the first anchor. */
  private updateCloseMarker(e: PointerEvent): void {
    const data = this.data();
    const obj = this.nodeId ? this.vs.sync.object(this.nodeId) : undefined;
    const show = !!data && data.points.length >= 3 && !!obj && this.nearFirstAnchor(e);
    this.closeMarker.visible = show;
    if (show && obj && data) placeCloseMarker(this.vs, this.closeMarker, obj, data);
  }
}

/** XYZ euler from a quaternion (the TransformDTO rotation convention). */
function eulerFromQuat(q: Quaternion): Vec3 {
  const e = new Euler().setFromQuaternion(q, "XYZ");
  return [e.x, e.y, e.z];
}
