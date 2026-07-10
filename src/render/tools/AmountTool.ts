import { MathUtils, type OrthographicCamera, type PerspectiveCamera, Vector3 } from "three";
import type { ComponentMode, Uuid } from "@/types/core";
import type { Document } from "@/core";
import { Bitset } from "@/core/selection/Bitset";
import { MeshTopologyCommand } from "@/geometry/commands/topology";
import type { HEMesh, HEMeshSnapshot } from "@/geometry/kernel/HEMesh";
import { vertsForSelection } from "@/geometry/kernel/components";
import { bevelVertices } from "@/geometry/ops/bevel";
import { bevelEdges } from "@/geometry/ops/bevelEdge";
import { extrudeFaces, insetFaces } from "@/geometry/ops/faceOps";
import type { OpResult } from "@/geometry/ops/soup";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";

export type AmountKind = "extrude" | "inset" | "bevel" | "bevelEdge";

const LABEL: Record<AmountKind, string> = {
  extrude: "Extrude",
  inset: "Inset",
  bevel: "Bevel",
  bevelEdge: "Bevel",
};
/** Which component selection each modal reads/writes. */
const AMOUNT_MODE: Record<AmountKind, ComponentMode> = {
  extrude: "polygon",
  inset: "polygon",
  bevel: "point",
  bevelEdge: "edge",
};
const AMOUNT_OP: Record<AmountKind, (m: HEMesh, ids: number[], amount: number) => OpResult | null> =
  {
    extrude: extrudeFaces,
    inset: insetFaces,
    bevel: bevelVertices,
    bevelEdge: (m, ids, amount) => bevelEdges(m, ids, { width: amount, angleDeg: 40 }),
  };
/** Bevel kinds collapse to coincident points at width 0 (degenerate n-gon
 * triangulation); the modal must build them at a small non-zero width. */
const IS_BEVEL = (k: AmountKind) => k === "bevel" || k === "bevelEdge";

/**
 * Blender-style modal for extrude/inset (polygon selection) and bevel (point
 * selection): activating the tool applies the topology at amount 0, then
 * vertical mouse motion drives the amount live (positions-only updates —
 * cheap). Left click confirms as ONE undo step
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
  /** Source component selection (faces for extrude/inset, verts for bevel). */
  private readonly srcIds: number[];
  private readonly srcMode: ComponentMode;
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
    srcIds: number[],
    before: HEMeshSnapshot,
    lift: NonNullable<OpResult["lift"]>,
    worldPerPixel: number,
  ) {
    this.vs = vs;
    this.doc = vs.doc;
    this.kind = kind;
    this.nodeId = nodeId;
    this.meshId = meshId;
    this.srcIds = srcIds;
    this.srcMode = AMOUNT_MODE[kind];
    this.before = before;
    this.lift = lift;
    this.worldPerPixel = worldPerPixel;
  }

  /** Start the modal on the active selection for this kind's mode; null if N/A. */
  static begin(vs: ViewportSystem, kind: AmountKind): AmountTool | null {
    const doc = vs.doc;
    const mode = AMOUNT_MODE[kind];
    const active = doc.selection.active;
    if (!active || !doc.scene.has(active)) return null;
    const meshRef = doc.scene.mustGet(active).data?.mesh as { id: Uuid } | undefined;
    const mesh = meshRef ? meshRegistry.get(meshRef.id) : undefined;
    if (!meshRef || !mesh) return null;
    const sel = doc.selection.componentsFor(active, mode);
    if (!sel || sel.topologyVersion !== mesh.topologyVersion || sel.bits.count === 0) return null;
    const srcIds = sel.bits.toArray();

    // screen→world scale at the selection centroid, through the active pane
    const rig = vs.rigFor(vs.editor.activePane);
    const paneH = Math.max(1, vs.paneRect(vs.editor.activePane).h);
    const cverts = vertsForSelection(mesh, mode, sel.bits);
    const centroid = new Vector3();
    for (const v of cverts) {
      centroid.x += mesh.vPos[v * 3]! / cverts.length;
      centroid.y += mesh.vPos[v * 3 + 1]! / cverts.length;
      centroid.z += mesh.vPos[v * 3 + 2]! / cverts.length;
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
    let result = AMOUNT_OP[kind](mesh, srcIds, 0);
    if (!result?.lift) return null; // op refused — nothing installed
    if (IS_BEVEL(kind)) {
      // At width 0 every cut point collapses onto its vertex, so the cut/strip
      // faces are degenerate — their n-gon triangulation is baked on that
      // collapsed shape and never recomputed (positions only stream), leaving
      // garbage triangles as the points spread (black holes). Rebuild at a
      // small non-degenerate width so the triangulation pattern is valid; the
      // lift still drives the displayed amount from 0. (Extrude/inset are
      // quad-only there, whose triangulation is stable under motion.)
      const minClamp = Math.min(...result.lift.max);
      const buildW = 0.02 * (Number.isFinite(minClamp) && minClamp > 0 ? minClamp : 1);
      mesh.restore(before);
      result = AMOUNT_OP[kind](mesh, srcIds, buildW);
      if (!result?.lift) return null;
    }
    // show the freshly created components selected while the modal runs
    // (positions stream without touching topology, so this stamp stays valid)
    const bits = new Bitset();
    for (const id of result.ids) bits.add(id);
    doc.selection.setComponents(active, {
      mode: result.mode,
      bits,
      order: [...result.ids],
      topologyVersion: mesh.topologyVersion,
    });
    doc.touchNode(active);
    vs.canvas.style.cursor = "move";
    return new AmountTool(vs, kind, active, meshRef.id, srcIds, before, result.lift, worldPerPixel);
  }

  /** Vertical mouse motion → amount (up = grow). */
  onPointerMove(clientY: number): void {
    this.startY ??= clientY;
    let amount = (this.startY - clientY) * this.worldPerPixel;
    // inset and bevel only grow inward (never negative); extrude is signed
    if (this.kind !== "extrude") amount = Math.max(0, amount);
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
    // no drag (or collapsed back to zero) — commit nothing, just restore
    // (extrude is signed, so test magnitude, not sign)
    if (this.startY === null || Math.abs(this.amount) <= 1e-6) {
      this.cancel();
      return;
    }
    const mesh = meshRegistry.get(this.meshId);
    const finalAmount = this.amount;
    this.exit();
    if (!mesh) return;
    mesh.restore(this.before);
    const op = AMOUNT_OP[this.kind];
    this.doc.history.run(
      new MeshTopologyCommand(this.nodeId, this.meshId, LABEL[this.kind], (m: HEMesh) =>
        op(m, this.srcIds, finalAmount),
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
    for (const id of this.srcIds) bits.add(id);
    this.doc.selection.setComponents(this.nodeId, {
      mode: this.srcMode,
      bits,
      order: [...this.srcIds],
      topologyVersion: mesh.topologyVersion,
    });
  }

  private exit(): void {
    this.vs.canvas.style.cursor = "";
    this.vs.modalTool = null;
    this.vs.invalidate();
  }
}
