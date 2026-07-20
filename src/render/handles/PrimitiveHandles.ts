import {
  Camera,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Vector3,
} from "three";
import type { Uuid } from "@/types/core";
import type { Document } from "@/core";
import { SetNodeDataCommand } from "@/core/history/commands/scene";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import { viewportTheme } from "@/render/theme/viewportTheme";
import { type HandleDef, handleDefs } from "./defs";

const HANDLE_MAT = new MeshBasicMaterial({
  color: viewportTheme.handleColor,
  depthTest: false,
  depthWrite: false,
});
const HANDLE_HOVER_MAT = new MeshBasicMaterial({
  color: viewportTheme.handleHoverColor,
  depthTest: false,
  depthWrite: false,
});
const HANDLE_GEO = new PlaneGeometry(1, 1);
// invisible fat picker: 2.5× hit area, double-sided so glancing rays still hit
const PICKER_GEO = new PlaneGeometry(2.5, 2.5);
const PICKER_MAT = new MeshBasicMaterial({ visible: false, side: DoubleSide });

interface DragState {
  nodeId: Uuid;
  def: HandleDef;
  before: Record<string, unknown>;
  origin: Vector3; // world position of the object's origin
  axisWorld: Vector3; // world direction of the local axis (unit)
  worldPerLocal: number; // world length of one local unit along the axis
  plane: Plane;
}

/**
 * C4D-style yellow square handles for live primitive parameters. Rendered
 * ABOVE the gizmo (higher renderOrder) and hit-tested BEFORE it so handles
 * are never obscured by gizmo arms. Drags preview via setNodeData and
 * commit one SetNodeDataCommand.
 */
export class PrimitiveHandles {
  readonly group = new Group();
  private readonly doc: Document;
  private drag: DragState | null = null;
  private hovered: Mesh | null = null;
  private activeNode: Uuid | null = null;

  constructor(doc: Document) {
    this.doc = doc;
    this.group.name = "prim-handles";
    this.group.renderOrder = 1500;
    this.group.visible = false;
  }

  get isDragging(): boolean {
    return this.drag !== null;
  }

  /** Re-apply themed handle colors to the shared handle materials (see viewportTheme). */
  applyTheme(): void {
    HANDLE_MAT.color.copy(viewportTheme.handleColor);
    HANDLE_HOVER_MAT.color.copy(viewportTheme.handleHoverColor);
  }

  /** Rebuild/position handles for the active selected primitive each frame. */
  update(camera: Camera, targetObject: Object3D | null): void {
    const active = this.doc.selection.active;
    const node = active && this.doc.scene.has(active) ? this.doc.scene.mustGet(active) : null;
    const desc = node?.data?.primitive as PrimitiveDescriptor | undefined;
    if (!node || !desc || !targetObject) {
      this.group.visible = false;
      this.activeNode = null;
      return;
    }
    const defs = handleDefs(desc);
    if (this.activeNode !== node.id || this.group.children.length !== defs.length) {
      this.group.clear();
      for (const def of defs) {
        const m = new Mesh(HANDLE_GEO, HANDLE_MAT);
        m.userData.handleDef = def;
        m.renderOrder = 1500;
        const picker = new Mesh(PICKER_GEO, PICKER_MAT);
        picker.userData.handleDef = def;
        picker.userData.visual = m;
        m.add(picker); // inherits billboard + screen-constant scale
        this.group.add(m);
      }
      this.activeNode = node.id;
    }
    this.group.visible = true;
    targetObject.updateMatrixWorld();
    const params = desc.params as unknown as Record<string, number>;
    const camPos = camera.position;
    for (const child of this.group.children) {
      const mesh = child as Mesh;
      const def = mesh.userData.handleDef as HandleDef;
      const [lx, ly, lz] = def.pos(params);
      mesh.position.set(lx, ly, lz);
      targetObject.localToWorld(mesh.position);
      // billboard + screen-constant size (~10px at gizmo scale convention)
      mesh.quaternion.copy(camera.quaternion);
      const ortho = camera as OrthographicCamera;
      let size: number;
      if (ortho.isOrthographicCamera) {
        size = (ortho.top - ortho.bottom) * 0.016;
      } else {
        // normalize by tan(fov/2) so a look-through camera's fov doesn't rescale
        // the handles (0.014 is calibrated at the editor's default 50° fov)
        const fov = (camera as PerspectiveCamera).fov ?? 50;
        const fovK = Math.tan(MathUtils.degToRad(fov / 2)) / Math.tan(MathUtils.degToRad(25));
        size = Math.max(0.0001, camPos.distanceTo(mesh.position) * 0.014 * fovK);
      }
      mesh.scale.setScalar(size);
    }
  }

  /** Priority hit-test — call BEFORE the gizmo's pointerDown. */
  pointerDown(raycaster: Raycaster, targetObject: Object3D | null): boolean {
    if (!this.group.visible || !targetObject || !this.activeNode) return false;
    const hit = raycaster
      .intersectObject(this.group, true)
      .find((h) => (h.object as Mesh).userData.handleDef);
    if (!hit) return false;
    const def = (hit.object as Mesh).userData.handleDef as HandleDef;
    const node = this.doc.scene.mustGet(this.activeNode);

    const origin = targetObject.getWorldPosition(new Vector3());
    const axisLocal = new Vector3(...def.axis);
    const axisWorld = targetObject.localToWorld(axisLocal.clone()).sub(origin);
    const worldPerLocal = axisWorld.length() || 1;
    axisWorld.normalize();

    // drag plane: contains the axis, faces the camera (same trick as the gizmo)
    const viewDir = raycaster.ray.direction.clone();
    const n = viewDir.sub(axisWorld.clone().multiplyScalar(viewDir.dot(axisWorld))).normalize();
    const plane = new Plane().setFromNormalAndCoplanarPoint(n, origin);

    this.drag = {
      nodeId: this.activeNode,
      def,
      before: structuredClone(node.data!),
      origin,
      axisWorld,
      worldPerLocal,
      plane,
    };
    return true;
  }

  pointerMove(raycaster: Raycaster): void {
    const d = this.drag;
    if (!d) return;
    const point = new Vector3();
    if (!raycaster.ray.intersectPlane(d.plane, point)) return;
    const extentLocal = point.sub(d.origin).dot(d.axisWorld) / d.worldPerLocal;

    const node = this.doc.scene.mustGet(d.nodeId);
    const data = structuredClone(node.data!);
    const desc = data.primitive as unknown as { params: Record<string, number> };
    d.def.set(desc.params, extentLocal);
    this.doc.setNodeData(d.nodeId, data, true); // preview
  }

  pointerUp(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const node = this.doc.scene.mustGet(d.nodeId);
    const after = structuredClone(node.data!);
    this.doc.history.pushWithoutExecute(
      new SetNodeDataCommand(d.nodeId, after, d.before, "Adjust Primitive"),
    );
  }

  cancelDrag(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.doc.setNodeData(d.nodeId, d.before);
  }

  updateHover(raycaster: Raycaster): void {
    if (this.drag || !this.group.visible) return;
    const hitObj =
      (raycaster
        .intersectObject(this.group, true)
        .find((h) => (h.object as Mesh).userData.handleDef)?.object as Mesh) ?? null;
    const mesh = hitObj ? ((hitObj.userData.visual as Mesh | undefined) ?? hitObj) : null;
    if (mesh === this.hovered) return;
    if (this.hovered) this.hovered.material = HANDLE_MAT;
    this.hovered = mesh;
    if (mesh) mesh.material = HANDLE_HOVER_MAT;
  }
}
