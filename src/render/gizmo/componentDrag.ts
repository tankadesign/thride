import { Matrix4, type Object3D, Quaternion, Vector3 } from "three";
import type { Uuid } from "@/types/core";
import type { Document } from "@/core";
import { ComponentTransformSession } from "@/geometry/commands/meshEdit";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { vertexCentroid, vertsForSelection } from "@/geometry/kernel/components";
import { meshRegistry } from "@/geometry/store/meshRegistry";

export interface ComponentContext {
  nodeId: Uuid;
  meshId: Uuid;
  mesh: HEMesh;
  verts: number[];
  centroidWorld: Vector3;
}

/**
 * The gizmo's component-editing context: active node is an editable mesh
 * with a live component selection valid for the current topology. Null in
 * object/texture mode or when nothing applies — gizmo falls back / hides.
 */
export function componentContext(
  doc: Document,
  activeObject: Object3D | null,
): ComponentContext | null {
  const mode = doc.selection.editMode;
  if (mode === "object" || mode === "texture") return null;
  const active = doc.selection.active;
  if (!active || !activeObject || !doc.scene.has(active)) return null;
  const meshRef = doc.scene.mustGet(active).data?.mesh as { id: Uuid } | undefined;
  const mesh = meshRef ? meshRegistry.get(meshRef.id) : undefined;
  if (!meshRef || !mesh) return null;
  const sel = doc.selection.componentsFor(active, mode);
  if (!sel || sel.topologyVersion !== mesh.topologyVersion) return null;
  const verts = vertsForSelection(mesh, mode, sel.bits);
  if (verts.length === 0) return null;
  const c = vertexCentroid(mesh, verts);
  activeObject.updateMatrixWorld();
  const centroidWorld = new Vector3(c[0], c[1], c[2]).applyMatrix4(activeObject.matrixWorld);
  return { nodeId: active, meshId: meshRef.id, mesh, verts, centroidWorld };
}

const KIND_LABEL: Record<string, string> = {
  translate: "Move Components",
  "translate-view": "Move Components",
  rotate: "Rotate Components",
  scale: "Scale Components",
};

/**
 * Applies one gizmo drag to the selected vertices: captures begin WORLD
 * positions, transforms them per move (translate delta / rotation about the
 * pivot / axis scale in the gizmo basis), converts back to mesh-local, and
 * streams them through a ComponentTransformSession (one undo step).
 */
export class ComponentDrag {
  private readonly doc: Document;
  private readonly verts: readonly number[];
  private readonly beginWorld: Float32Array;
  private readonly invWorld = new Matrix4();
  private readonly out: Float32Array;

  constructor(doc: Document, ctx: ComponentContext, object: Object3D, handleKind: string) {
    this.doc = doc;
    this.verts = ctx.verts;
    object.updateMatrixWorld();
    this.invWorld.copy(object.matrixWorld).invert();
    this.beginWorld = new Float32Array(ctx.verts.length * 3);
    const p = new Vector3();
    for (let i = 0; i < ctx.verts.length; i++) {
      const v = ctx.verts[i]! * 3;
      p.set(ctx.mesh.vPos[v]!, ctx.mesh.vPos[v + 1]!, ctx.mesh.vPos[v + 2]!).applyMatrix4(
        object.matrixWorld,
      );
      this.beginWorld[i * 3] = p.x;
      this.beginWorld[i * 3 + 1] = p.y;
      this.beginWorld[i * 3 + 2] = p.z;
    }
    this.out = new Float32Array(ctx.verts.length * 3);
    doc.sessions.start(
      new ComponentTransformSession(
        ctx.nodeId,
        ctx.meshId,
        ctx.verts,
        KIND_LABEL[handleKind] ?? "Move Components",
      ),
    );
  }

  applyTranslate(deltaWorld: Vector3): void {
    const p = new Vector3();
    for (let i = 0; i < this.verts.length; i++) {
      p.set(
        this.beginWorld[i * 3]! + deltaWorld.x,
        this.beginWorld[i * 3 + 1]! + deltaWorld.y,
        this.beginWorld[i * 3 + 2]! + deltaWorld.z,
      );
      this.writeLocal(i, p);
    }
    this.doc.sessions.update(this.out);
  }

  applyRotate(axisWorld: Vector3, angle: number, pivotWorld: Vector3): void {
    const q = new Quaternion().setFromAxisAngle(axisWorld, angle);
    const p = new Vector3();
    for (let i = 0; i < this.verts.length; i++) {
      p.set(this.beginWorld[i * 3]!, this.beginWorld[i * 3 + 1]!, this.beginWorld[i * 3 + 2]!)
        .sub(pivotWorld)
        .applyQuaternion(q)
        .add(pivotWorld);
      this.writeLocal(i, p);
    }
    this.doc.sessions.update(this.out);
  }

  applyScale(
    basis: Quaternion,
    axis: 0 | 1 | 2,
    ratio: number,
    uniform: boolean,
    pivotWorld: Vector3,
  ): void {
    const invBasis = basis.clone().invert();
    const s = new Vector3(
      uniform || axis === 0 ? ratio : 1,
      uniform || axis === 1 ? ratio : 1,
      uniform || axis === 2 ? ratio : 1,
    );
    const p = new Vector3();
    for (let i = 0; i < this.verts.length; i++) {
      p.set(this.beginWorld[i * 3]!, this.beginWorld[i * 3 + 1]!, this.beginWorld[i * 3 + 2]!)
        .sub(pivotWorld)
        .applyQuaternion(invBasis)
        .multiply(s)
        .applyQuaternion(basis)
        .add(pivotWorld);
      this.writeLocal(i, p);
    }
    this.doc.sessions.update(this.out);
  }

  private writeLocal(i: number, world: Vector3): void {
    world.applyMatrix4(this.invWorld);
    this.out[i * 3] = world.x;
    this.out[i * 3 + 1] = world.y;
    this.out[i * 3 + 2] = world.z;
  }
}
