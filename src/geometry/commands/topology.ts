import type { Uuid } from "@/types/core";
import type { Document } from "@/core";
import type { Command } from "@/core/history/Command";
import { Bitset } from "@/core/selection/Bitset";
import { type HEMesh, type HEMeshSnapshot, snapshotBytes } from "@/geometry/kernel/HEMesh";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import type { OpResult } from "@/geometry/ops/soup";

/**
 * One undo step for a topology op (extrude/inset/weld/delete): stores the
 * full before-snapshot; redo re-runs the op (deterministic), undo restores
 * the snapshot. The op returns the follow-up component selection — stamps
 * from before the op are invalid by design (topologyVersion moved on).
 * An op that returns null (aborted, e.g. non-manifold weld) leaves the
 * mesh untouched and the command becomes inert.
 */
export class MeshTopologyCommand implements Command {
  readonly type = "geometry.topology";
  readonly label: string;
  private readonly nodeId: Uuid;
  private readonly meshId: Uuid;
  private readonly apply: (mesh: HEMesh) => OpResult | null;
  private before: HEMeshSnapshot | null = null;
  private inert = false;

  constructor(nodeId: Uuid, meshId: Uuid, label: string, apply: (mesh: HEMesh) => OpResult | null) {
    this.nodeId = nodeId;
    this.meshId = meshId;
    this.label = label;
    this.apply = apply;
  }

  get memoryCost(): number {
    return this.before ? snapshotBytes(this.before) : 512;
  }

  execute(doc: Document): void {
    const mesh = meshRegistry.get(this.meshId);
    if (!mesh) {
      this.inert = true;
      return;
    }
    this.before ??= mesh.snapshot();
    const result = this.apply(mesh);
    if (!result) {
      this.inert = true;
      return;
    }
    doc.touchNode(this.nodeId);
    const bits = new Bitset();
    for (const id of result.ids) bits.add(id);
    doc.selection.setComponents(this.nodeId, {
      mode: result.mode,
      bits,
      order: [...result.ids],
      topologyVersion: mesh.topologyVersion,
    });
  }

  undo(doc: Document): void {
    if (this.inert || !this.before) return;
    const mesh = meshRegistry.get(this.meshId);
    if (!mesh) return;
    mesh.restore(this.before);
    doc.touchNode(this.nodeId);
    doc.selection.clearComponents(this.nodeId); // pre-op stamps are void anyway
  }
}
