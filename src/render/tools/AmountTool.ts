import { MathUtils, type OrthographicCamera, type PerspectiveCamera, Vector3 } from "three";
import type { Uuid } from "@/types/core";
import type { Document } from "@/core";
import { Bitset } from "@/core/selection/Bitset";
import { MeshTopologyCommand } from "@/geometry/commands/topology";
import type { HEMesh, HEMeshSnapshot } from "@/geometry/kernel/HEMesh";
import { extrudeFaces, insetFaces } from "@/geometry/ops/faceOps";
import type { OpResult } from "@/geometry/ops/soup";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";

export type AmountKind = "extrude" | "inset";

const LABEL: Record<AmountKind, string> = { extrude: "Extrude", inset: "Inset" };

/**
 * Blender-style modal for extrude/inset: activating the tool applies the
 * topology at amount 0, then vertical mouse motion drives the amount live
 * (positions-only updates — cheap). Left click confirms as ONE undo step
 * (snapshot restored, then the op re-runs at the final amount through
 * MeshTopologyCommand); Escape/right-click cancels with zero trace. The
 * gizmo hides by itself while modal (selection stamps are void mid-edit)
 * and returns on the command's fresh cap selection.
 */
export class AmountTool {
  readonly kind: AmountKind;
  private readonly vs: ViewportSystem;
  private readonly doc: Document;
  private readonly nodeId: Uuid;
  private readonly meshId: Uuid;
  private readonly faceIds: number[];
  private readonly before: HEMeshSnapshot;
  private readonly lift: NonNullable<OpResult["lift"]>;
  private readonly worldPerPixel: number;
  private startY: number | null = null;
  private amount = 0;

  private constructor(
    vs: ViewportSystem,
    kind: AmountKind,
    nodeId: Uuid,
    meshId: Uuid,
    faceIds: number[],
    before: HEMeshSnapshot,
    lift: NonNullable<OpResult["lift"]>,
    worldPerPixel: number,
  ) {
    this.vs = vs;
    this.doc = vs.doc;
    this.kind = kind;
    this.nodeId = nodeId;
    this.meshId = meshId;
    this.faceIds = faceIds;
    this.before = before;
    this.lift = lift;
    this.worldPerPixel = worldPerPixel;
  }

  /** Start the modal on the active polygon selection; null when not applicable. */
  static begin(vs: ViewportSystem, kind: AmountKind): AmountTool | null {
    const doc = vs.doc;
    const active = doc.selection.active;
    if (!active || !doc.scene.has(active)) return null;
    const meshRef = doc.scene.mustGet(active).data?.mesh as { id: Uuid } | undefined;
    const mesh = meshRef ? meshRegistry.get(meshRef.id) : undefined;
    if (!meshRef || !mesh) return null;
    const sel = doc.selection.componentsFor(active, "polygon");
    if (!sel || sel.topologyVersion !== mesh.topologyVersion || sel.bits.count === 0) return null;
    const faceIds = sel.bits.toArray();

    // screen→world scale at the selection centroid, through the active pane
    const rig = vs.rigFor(vs.editor.activePane);
    const paneH = Math.max(1, vs.paneRect(vs.editor.activePane).h);
    const centroid = new Vector3();
    for (const f of faceIds) {
      const verts = mesh.faceVertices(f);
      for (const v of verts) {
        centroid.x += mesh.vPos[v * 3]! / (faceIds.length * verts.length);
        centroid.y += mesh.vPos[v * 3 + 1]! / (faceIds.length * verts.length);
        centroid.z += mesh.vPos[v * 3 + 2]! / (faceIds.length * verts.length);
      }
    }
    const obj = vs.sync.object(active);
    if (obj) centroid.applyMatrix4(obj.matrixWorld);
    const persp = rig.camera as PerspectiveCamera;
    const ortho = rig.camera as OrthographicCamera;
    const worldPerPixel = persp.isPerspectiveCamera
      ? (2 * persp.position.distanceTo(centroid) * Math.tan(MathUtils.degToRad(persp.fov / 2))) /
        paneH
      : (ortho.top - ortho.bottom) / paneH;

    const before = mesh.snapshot();
    const op = kind === "extrude" ? extrudeFaces : insetFaces;
    const result = op(mesh, faceIds, 0);
    if (!result?.lift) return null; // op refused — nothing installed
    doc.touchNode(active);
    vs.canvas.style.cursor = "move";
    return new AmountTool(
      vs,
      kind,
      active,
      meshRef.id,
      faceIds,
      before,
      result.lift,
      worldPerPixel,
    );
  }

  /** Vertical mouse motion → amount (up = grow). */
  onPointerMove(clientY: number): void {
    this.startY ??= clientY;
    let amount = (this.startY - clientY) * this.worldPerPixel;
    if (this.kind === "inset") amount = Math.max(0, amount);
    this.amount = amount;
    const mesh = meshRegistry.get(this.meshId);
    if (!mesh) return;
    const { verts, base, dir, max } = this.lift;
    for (let i = 0; i < verts.length; i++) {
      const a = Math.min(amount, max[i]!);
      mesh.setPosition(
        verts[i]!,
        base[i * 3]! + dir[i * 3]! * a,
        base[i * 3 + 1]! + dir[i * 3 + 1]! * a,
        base[i * 3 + 2]! + dir[i * 3 + 2]! * a,
      );
    }
    this.doc.touchNode(this.nodeId, true); // preview
  }

  /** Left click: collapse the whole gesture into one deterministic undo step. */
  confirm(): void {
    const mesh = meshRegistry.get(this.meshId);
    const finalAmount = this.amount;
    this.exit();
    if (!mesh) return;
    mesh.restore(this.before);
    const op = this.kind === "extrude" ? extrudeFaces : insetFaces;
    this.doc.history.run(
      new MeshTopologyCommand(this.nodeId, this.meshId, LABEL[this.kind], (m: HEMesh) =>
        op(m, this.faceIds, finalAmount),
      ),
    );
  }

  /** Escape / right click: restore exactly, re-stamp the original selection. */
  cancel(): void {
    const mesh = meshRegistry.get(this.meshId);
    this.exit();
    if (!mesh) return;
    mesh.restore(this.before);
    this.doc.touchNode(this.nodeId);
    const bits = new Bitset();
    for (const f of this.faceIds) bits.add(f);
    this.doc.selection.setComponents(this.nodeId, {
      mode: "polygon",
      bits,
      order: [...this.faceIds],
      topologyVersion: mesh.topologyVersion,
    });
  }

  private exit(): void {
    this.vs.canvas.style.cursor = "";
    this.vs.modalTool = null;
    this.vs.invalidate();
  }
}
