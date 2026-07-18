import { Euler, Matrix4, type Object3D, Quaternion, Vector3 } from "three";
import type { ProjectionTransform, TextureChannel, Uuid } from "@/types/core";
import { defaultProjectionTransform } from "@/types/core";
import type { Document } from "@/core";
import { ProjectionDragSession } from "@/core/session/ProjectionDragSession";

/** What the Texture-mode gizmo edits: one material channel's projection, on an object. */
export interface ProjectionTarget {
  materialId: Uuid;
  channel: TextureChannel;
  /** A scene object using the material — the gizmo's anchor and local frame. */
  object: Object3D;
}

/**
 * Applies one gizmo drag onto a material channel's projection placement. The
 * projection samples in OBJECT-LOCAL space (`positionLocal` in projections.ts),
 * so world-space gizmo deltas are mapped through the target object's inverse
 * world frame before they touch offset/rotation/scale. Streams previews through
 * a {@link ProjectionDragSession} (one undo step per drag).
 *
 * Sign conventions (verified in-viewport): a translate follows the drag
 * (`offset += localDelta`); a ring drag rotates the texture WITH the cursor, so
 * the projection Euler rotates by `-angle` (the projector frame is the inverse
 * of the apparent texture); scaling up enlarges the projected features.
 */
export class ProjectionDrag {
  private readonly doc: Document;
  private readonly begin: ProjectionTransform;
  private readonly invWorld = new Matrix4();

  constructor(doc: Document, target: ProjectionTarget) {
    this.doc = doc;
    const mat = doc.materials.get(target.materialId);
    this.begin = structuredClone(
      mat?.textureProjectionTransforms?.[target.channel] ?? defaultProjectionTransform(),
    );
    target.object.updateMatrixWorld();
    this.invWorld.copy(target.object.matrixWorld).invert();
    doc.sessions.start(new ProjectionDragSession(target.materialId, target.channel));
  }

  /** World direction → object-local direction (two-point through the inverse world). */
  private localDir(world: Vector3): Vector3 {
    const origin = new Vector3().applyMatrix4(this.invWorld);
    return world.clone().applyMatrix4(this.invWorld).sub(origin);
  }

  applyTranslate(deltaWorld: Vector3): void {
    const d = this.localDir(deltaWorld);
    const o = this.begin.offset;
    this.push({ ...this.begin, offset: [o[0] + d.x, o[1] + d.y, o[2] + d.z] });
  }

  applyRotate(axisWorld: Vector3, angle: number): void {
    const axis = this.localDir(axisWorld).normalize();
    if (axis.lengthSq() < 1e-12) return;
    const r = this.begin.rotation;
    const q0 = new Quaternion().setFromEuler(new Euler(r[0], r[1], r[2], "XYZ"));
    // projector frame is the inverse of the apparent texture → -angle so the
    // pattern turns WITH the ring
    const dq = new Quaternion().setFromAxisAngle(axis, -angle);
    const e = new Euler().setFromQuaternion(dq.multiply(q0), "XYZ");
    this.push({ ...this.begin, rotation: [e.x, e.y, e.z] });
  }

  applyScale(axis: 0 | 1 | 2, ratio: number, uniform: boolean): void {
    const s = this.begin.scale;
    const next: [number, number, number] = [s[0], s[1], s[2]];
    if (uniform) {
      next[0] = s[0] * ratio;
      next[1] = s[1] * ratio;
      next[2] = s[2] * ratio;
    } else {
      next[axis] = s[axis] * ratio;
    }
    this.push({ ...this.begin, scale: next });
  }

  private push(t: ProjectionTransform): void {
    this.doc.sessions.update<ProjectionTransform>(t);
  }
}
