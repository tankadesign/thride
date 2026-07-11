import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  Group,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type OrthographicCamera,
  type PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import type { Uuid, Vec3 } from "@/types/core";
import { CreateNodeCommand, SetNodeDataCommand } from "@/core/history/commands/scene";
import { uniqueSiblingName } from "@/core";
import type { SplineData, SplinePointDTO } from "@/types/geometry/spline";
import { emptySpline } from "@/types/geometry/spline";
import { sampleSpline } from "@/geometry/splines/eval";
import { viewportTheme } from "@/render/theme/viewportTheme";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";
import { PenPlanePreview } from "./penPlane";

/** Clicking this close (px) to the first anchor closes the spline. */
const CLOSE_RADIUS_PX = 12;
/** Drag farther than this (px) after placing to pull out smooth handles. */
const DRAG_THRESHOLD_PX = 4;

const AXIS_NORMALS: Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export type PenPlaneAxis = 0 | 1 | 2 | "auto";

/**
 * Spline-app-style 3D pen. Two phases:
 *
 * 1. **Plane** — a red work-plane preview follows the cursor showing the
 *    orientation you'll draw onto. Orientation is automatic (the world plane
 *    most facing the camera); X / Y / Z force an axis, A returns to auto.
 *    The first click locks the plane, creates the spline node (its transform
 *    IS the plane: local XY = the plane, +Z = its normal) and places point 1.
 * 2. **Draw** — every pointer position is ray∩plane, written as local (x,y,0):
 *    one dimension is locked, so you draw in 2D but in perspective. Click
 *    places a linear point; click-drag pulls out mirrored smooth handles
 *    (Illustrator-style). Click the first point to close. Backspace removes
 *    the last point, Enter/Escape (or the Pen toggle) finishes. Each point is
 *    ONE undo step, so ⌘Z while drawing walks back point by point.
 */
export class PenTool {
  readonly group = new Group();
  private readonly vs: ViewportSystem;
  private phase: "off" | "plane" | "draw" = "off";
  private axis: PenPlaneAxis = "auto";
  private resolvedAxis: 0 | 1 | 2 = 1;
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
    this.nodeId = null;
    this.group.visible = true;
    this.rubber.visible = false;
    this.planePreview.setPicking();
    this.vs.editor.setPenActive(true);
    this.vs.canvas.style.cursor = "crosshair";
    this.vs.invalidate();
  }

  /**
   * Pen-owned keys: X/Y/Z force the work-plane axis, A auto, Backspace
   * removes the last point, Enter/Escape finish. Returns true when consumed
   * ('a' must not select-all while the pen owns the viewport).
   */
  handleKey(e: KeyboardEvent): boolean {
    const k = e.key.toLowerCase();
    if (k === "escape" || k === "enter") {
      this.finish();
    } else if (k === "backspace" && this.isDrawing) {
      this.removeLastPoint();
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
      this.updatePlanePreview(e);
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
      position: [local.x, local.y, 0],
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
    const local = this.pointerToLocal(e);
    if (!local) return;
    const after = structuredClone(data);
    const p = after.points[placing.index]!;
    const dx = local.x - p.position[0];
    const dy = local.y - p.position[1];
    p.outHandle = [dx, dy, 0];
    p.inHandle = [-dx, -dy, 0];
    p.mode = "smooth";
    this.doc.setNodeData(this.nodeId!, this.wrap(after), true);
    this.vs.invalidate();
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

  /** The world plane most facing the camera (or the forced axis). */
  private currentNormal(): Vector3 {
    if (this.axis !== "auto") {
      this.resolvedAxis = this.axis;
    } else {
      const camDir = new Vector3();
      this.vs.rigFor(this.vs.editor.activePane).camera.getWorldDirection(camDir);
      const ax = Math.abs(camDir.x);
      const ay = Math.abs(camDir.y);
      const az = Math.abs(camDir.z);
      this.resolvedAxis = ay >= ax && ay >= az ? 1 : ax >= az ? 0 : 2;
    }
    return new Vector3(...AXIS_NORMALS[this.resolvedAxis]!);
  }

  private updatePlanePreview(e: PointerEvent): void {
    const normal = this.currentNormal();
    this.plane.setFromNormalAndCoplanarPoint(normal, new Vector3(0, 0, 0));
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

  /** First click: lock the plane, create the spline node, place point 1. */
  private lockPlaneAndStart(e: PointerEvent): void {
    const normal = this.currentNormal();
    this.plane.setFromNormalAndCoplanarPoint(normal, new Vector3(0, 0, 0));
    const pane = this.vs.paneAt(
      e.clientX - this.vs.canvas.getBoundingClientRect().left,
      e.clientY - this.vs.canvas.getBoundingClientRect().top,
    );
    this.vs.setRayFromEvent(e, pane);
    const hit = new Vector3();
    if (!this.vs.raycaster.ray.intersectPlane(this.plane, hit)) return;
    this.quat.setFromUnitVectors(new Vector3(0, 0, 1), normal);

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
    // lock the preview plane where it was clicked
    this.planePreview.place(hit, this.quat);
    this.planePreview.setLocked();
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

  /** Cursor ray ∩ the locked work plane, in node-local plane coords. */
  private pointerToLocal(e: PointerEvent): Vector3 | null {
    if (!this.nodeId) return null;
    const obj = this.vs.sync.object(this.nodeId);
    if (!obj) return null;
    const rect = this.vs.canvas.getBoundingClientRect();
    const pane = this.vs.paneAt(e.clientX - rect.left, e.clientY - rect.top);
    this.vs.setRayFromEvent(e, pane);
    obj.updateMatrixWorld();
    const normal = new Vector3(0, 0, 1).applyQuaternion(obj.quaternion).normalize();
    this.plane.setFromNormalAndCoplanarPoint(normal, obj.position);
    const hit = new Vector3();
    if (!this.vs.raycaster.ray.intersectPlane(this.plane, hit)) return null;
    const local = obj.worldToLocal(hit.clone());
    local.z = 0; // the locked dimension
    return local;
  }

  /** Rubber band: the segment that WOULD be added if you clicked now. */
  private updateRubber(): void {
    const data = this.data();
    if (!data || data.points.length === 0 || !this.hoverLocal || this.placing) {
      this.rubber.visible = false;
      return;
    }
    const last = data.points[data.points.length - 1]!;
    const ghost: SplineData = {
      closed: false,
      points: [
        last,
        {
          position: [this.hoverLocal.x, this.hoverLocal.y, 0],
          inHandle: [0, 0, 0],
          outHandle: [0, 0, 0],
          mode: "linear",
        },
      ],
    };
    const flat = sampleSpline(ghost, 16);
    this.rubber.geometry.dispose();
    this.rubber.geometry = new BufferGeometry();
    this.rubber.geometry.setAttribute("position", new BufferAttribute(flat, 3));
    const obj = this.vs.sync.object(this.nodeId!);
    if (obj) {
      this.rubber.position.copy(obj.position);
      this.rubber.quaternion.copy(obj.quaternion);
    }
    this.rubber.visible = true;
  }

  /** Screen distance from the cursor to the first anchor (close affordance). */
  private nearFirstAnchor(e: PointerEvent): boolean {
    const data = this.data();
    const obj = this.nodeId ? this.vs.sync.object(this.nodeId) : undefined;
    if (!data || data.points.length === 0 || !obj) return false;
    const rect = this.vs.canvas.getBoundingClientRect();
    const pane = this.vs.paneRect(this.vs.editor.activePane);
    const cam = this.vs.rigFor(this.vs.editor.activePane).camera;
    cam.updateMatrixWorld();
    obj.updateMatrixWorld();
    const w = new Vector3(...data.points[0]!.position).applyMatrix4(obj.matrixWorld);
    const v = w.clone().applyMatrix4(cam.matrixWorldInverse);
    if ((cam as PerspectiveCamera).isPerspectiveCamera && v.z >= -1e-6) return false;
    v.applyMatrix4(cam.projectionMatrix);
    const sx = pane.x + ((v.x + 1) / 2) * pane.w;
    const sy = pane.y + ((1 - v.y) / 2) * pane.h;
    return Math.hypot(sx - (e.clientX - rect.left), sy - (e.clientY - rect.top)) <= CLOSE_RADIUS_PX;
  }

  /** Show the green "click to close" marker over the first anchor. */
  private updateCloseMarker(e: PointerEvent): void {
    const data = this.data();
    const obj = this.nodeId ? this.vs.sync.object(this.nodeId) : undefined;
    const show = !!data && data.points.length >= 3 && !!obj && this.nearFirstAnchor(e);
    this.closeMarker.visible = show;
    if (!show || !obj || !data) return;
    obj.updateMatrixWorld();
    const w = new Vector3(...data.points[0]!.position).applyMatrix4(obj.matrixWorld);
    const cam = this.vs.rigFor(this.vs.editor.activePane).camera;
    const paneH = Math.max(1, this.vs.paneRect(this.vs.editor.activePane).h);
    const ortho = cam as OrthographicCamera;
    const persp = cam as PerspectiveCamera;
    const perPixel = ortho.isOrthographicCamera
      ? (ortho.top - ortho.bottom) / paneH
      : (2 * cam.position.distanceTo(w) * Math.tan(MathUtils.degToRad(persp.fov / 2))) / paneH;
    const q = new Quaternion();
    cam.getWorldQuaternion(q);
    this.closeMarker.matrixAutoUpdate = false;
    this.closeMarker.matrix.compose(w, q, new Vector3().setScalar(Math.max(1e-6, 12 * perPixel)));
  }
}

/** XYZ euler from a quaternion (the TransformDTO rotation convention). */
function eulerFromQuat(q: Quaternion): Vec3 {
  const e = new Euler().setFromQuaternion(q, "XYZ");
  return [e.x, e.y, e.z];
}
