import {
  BoxGeometry,
  Camera,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Plane,
  Quaternion,
  Raycaster,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import type { TransformDTO, Uuid } from "@/types/core";
import type { Document } from "@/core";
import { TransformDragSession } from "@/core/session/TransformDragSession";

type HandleKind = "translate" | "rotate" | "scale" | "translate-view";
type Axis = 0 | 1 | 2;

interface Handle {
  kind: HandleKind;
  axis: Axis;
}

const AXIS_COLORS = [0xe0554f, 0x69b839, 0x3f7fdc] as const; // x y z
const AXIS_VECS = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)] as const;

interface DragState {
  handle: Handle;
  nodeIds: Uuid[];
  begin: Map<Uuid, TransformDTO>;
  pivot: Vector3;
  axisWorld: Vector3;
  plane: Plane;
  startPoint: Vector3;
  startAngle: number;
}

/**
 * Unified TRS gizmo (C4D-style single gizmo): translate arrows, rotate
 * rings, scale cubes, view-plane center handle. Lives in the main scene
 * with depthTest off; drags run through the document's SessionRunner so
 * every drag is exactly one undo step.
 */
export class TransformGizmo {
  readonly group = new Group();
  private readonly doc: Document;
  private drag: DragState | null = null;
  private hovered: Mesh | null = null;

  constructor(doc: Document) {
    this.doc = doc;
    this.group.name = "gizmo";
    this.group.renderOrder = 999;
    this.build();
    this.group.visible = false;
  }

  get isDragging(): boolean {
    return this.drag !== null;
  }

  /** Reposition on the active selection; hide when nothing is selected. */
  update(camera: Camera): void {
    const ids = this.doc.selection.objectIds;
    const active = this.doc.selection.active;
    if (!active || ids.length === 0 || !this.doc.scene.has(active)) {
      this.group.visible = false;
      return;
    }
    const t = this.doc.scene.mustGet(active).transform;
    this.group.position.set(t.position[0], t.position[1], t.position[2]);
    this.group.visible = true;
    // screen-constant size: perspective scales by distance, ortho by frustum height
    const ortho = camera as OrthographicCamera;
    const scale = ortho.isOrthographicCamera
      ? Math.max(0.0001, (ortho.top - ortho.bottom) * 0.16)
      : Math.max(0.0001, camera.position.distanceTo(this.group.position) * 0.14);
    this.group.scale.setScalar(scale);
  }

  /** Try to begin a drag. Returns true when the pointer hit a handle. */
  pointerDown(raycaster: Raycaster): boolean {
    if (!this.group.visible) return false;
    const hits = raycaster.intersectObject(this.group, true);
    const hit = hits.find((h) => (h.object as Mesh).userData.handle);
    if (!hit) return false;
    const handle = (hit.object as Mesh).userData.handle as Handle;

    const ids = [...this.doc.selection.objectIds];
    const begin = new Map<Uuid, TransformDTO>();
    for (const id of ids) begin.set(id, structuredClone(this.doc.scene.mustGet(id).transform));

    const pivot = this.group.position.clone();
    const axisWorld = AXIS_VECS[handle.axis].clone();
    const viewDir = raycaster.ray.direction.clone();

    let plane: Plane;
    if (handle.kind === "rotate") {
      plane = new Plane().setFromNormalAndCoplanarPoint(axisWorld, pivot);
    } else if (handle.kind === "translate-view") {
      plane = new Plane().setFromNormalAndCoplanarPoint(viewDir.clone().negate(), pivot);
    } else {
      // plane containing the axis, facing the camera as much as possible
      const n = viewDir
        .clone()
        .sub(axisWorld.clone().multiplyScalar(viewDir.dot(axisWorld)))
        .normalize();
      plane = new Plane().setFromNormalAndCoplanarPoint(n, pivot);
    }
    const startPoint = new Vector3();
    if (!raycaster.ray.intersectPlane(plane, startPoint)) return false;

    const rel = startPoint.clone().sub(pivot);
    const startAngle = this.angleOnPlane(rel, handle.axis);

    this.drag = { handle, nodeIds: ids, begin, pivot, axisWorld, plane, startPoint, startAngle };
    this.doc.sessions.start(new TransformDragSession(ids, labelFor(handle.kind)));
    return true;
  }

  pointerMove(raycaster: Raycaster, uniformScale = false): void {
    const d = this.drag;
    if (!d) return;
    const point = new Vector3();
    if (!raycaster.ray.intersectPlane(d.plane, point)) return;

    const updates = new Map<Uuid, TransformDTO>();
    if (d.handle.kind === "translate" || d.handle.kind === "translate-view") {
      const delta = point.clone().sub(d.startPoint);
      if (d.handle.kind === "translate") {
        const along = delta.dot(d.axisWorld);
        delta.copy(d.axisWorld).multiplyScalar(along);
      }
      for (const [id, t0] of d.begin) {
        const t = structuredClone(t0);
        t.position[0] = t0.position[0] + delta.x;
        t.position[1] = t0.position[1] + delta.y;
        t.position[2] = t0.position[2] + delta.z;
        updates.set(id, t);
      }
    } else if (d.handle.kind === "rotate") {
      const angle = this.angleOnPlane(point.clone().sub(d.pivot), d.handle.axis) - d.startAngle;
      const dq = new Quaternion().setFromAxisAngle(d.axisWorld, angle);
      for (const [id, t0] of d.begin) {
        const t = structuredClone(t0);
        const q0 = new Quaternion().setFromEuler(
          new Euler(t0.rotation[0], t0.rotation[1], t0.rotation[2], "XYZ"),
        );
        const e = new Euler().setFromQuaternion(dq.clone().multiply(q0), "XYZ");
        t.rotation = [e.x, e.y, e.z];
        updates.set(id, t);
      }
    } else {
      // scale along axis: ratio of distances from pivot along axis.
      // Shift = uniform scale on all three axes.
      const a0 = d.startPoint.clone().sub(d.pivot).dot(d.axisWorld);
      const a1 = point.clone().sub(d.pivot).dot(d.axisWorld);
      const ratio = Math.abs(a0) > 1e-6 ? a1 / a0 : 1;
      for (const [id, t0] of d.begin) {
        const t = structuredClone(t0);
        if (uniformScale) {
          t.scale = [t0.scale[0] * ratio, t0.scale[1] * ratio, t0.scale[2] * ratio];
        } else {
          t.scale[d.handle.axis] = t0.scale[d.handle.axis]! * ratio;
        }
        updates.set(id, t);
      }
    }
    this.doc.sessions.update(updates);
  }

  pointerUp(): void {
    if (!this.drag) return;
    this.drag = null;
    this.doc.sessions.commit();
  }

  cancelDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.doc.sessions.cancel();
  }

  /** Hover feedback: brighten the handle under the pointer. */
  updateHover(raycaster: Raycaster): void {
    if (this.drag || !this.group.visible) return;
    const hits = raycaster.intersectObject(this.group, true);
    const mesh = (hits.find((h) => (h.object as Mesh).userData.handle)?.object as Mesh) ?? null;
    if (mesh === this.hovered) return;
    if (this.hovered) (this.hovered.material as MeshBasicMaterial).opacity = BASE_OPACITY;
    this.hovered = mesh;
    if (mesh) (mesh.material as MeshBasicMaterial).opacity = 1;
  }

  private angleOnPlane(rel: Vector3, axis: Axis): number {
    // signed angle of rel projected on the plane orthogonal to axis
    const u = AXIS_VECS[((axis + 1) % 3) as Axis];
    const v = AXIS_VECS[((axis + 2) % 3) as Axis];
    return Math.atan2(rel.dot(v), rel.dot(u));
  }

  private build(): void {
    for (let axis = 0 as Axis; axis < 3; axis = (axis + 1) as Axis) {
      const color = AXIS_COLORS[axis];
      const dir = AXIS_VECS[axis];
      const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);

      const shaft = this.handleMesh(new CylinderGeometry(0.012, 0.012, 0.72, 6), color, {
        kind: "translate",
        axis,
      });
      shaft.position.copy(dir).multiplyScalar(0.42);
      shaft.quaternion.copy(quat);

      const head = this.handleMesh(new ConeGeometry(0.05, 0.16, 12), color, {
        kind: "translate",
        axis,
      });
      head.position.copy(dir).multiplyScalar(0.86);
      head.quaternion.copy(quat);

      const ring = this.handleMesh(new TorusGeometry(1.0, 0.014, 8, 48), color, {
        kind: "rotate",
        axis,
      });
      ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir);

      const cube = this.handleMesh(new BoxGeometry(0.09, 0.09, 0.09), color, {
        kind: "scale",
        axis,
      });
      cube.position.copy(dir).multiplyScalar(1.18);
    }
    const center = this.handleMesh(new SphereGeometry(0.07, 16, 12), 0xdddddd, {
      kind: "translate-view",
      axis: 0,
    });
    center.position.set(0, 0, 0);
  }

  private handleMesh(
    geometry: BoxGeometry | ConeGeometry | CylinderGeometry | SphereGeometry | TorusGeometry,
    color: number,
    handle: Handle,
  ): Mesh {
    const mat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: BASE_OPACITY,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, mat);
    mesh.userData.handle = handle;
    mesh.renderOrder = 1000;
    this.group.add(mesh);
    return mesh;
  }
}

const BASE_OPACITY = 0.82;

function labelFor(kind: HandleKind): string {
  return kind === "rotate" ? "Rotate" : kind === "scale" ? "Scale" : "Move";
}
