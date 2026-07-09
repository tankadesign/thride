import type { Uuid } from "@/types/core";
import type { Document } from "@/core";
import type { Command } from "@/core/history/Command";
import type { InteractiveSession } from "@/core/session/InteractiveSession";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { meshRegistry } from "@/geometry/store/meshRegistry";

/** Gather positions of `indices` from the kernel into a packed array. */
function gatherPositions(mesh: HEMesh, indices: readonly number[]): Float32Array {
  const out = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]! * 3;
    out[i * 3] = mesh.vPos[v]!;
    out[i * 3 + 1] = mesh.vPos[v + 1]!;
    out[i * 3 + 2] = mesh.vPos[v + 2]!;
  }
  return out;
}

function scatterPositions(mesh: HEMesh, indices: readonly number[], packed: Float32Array): void {
  for (let i = 0; i < indices.length; i++) {
    mesh.setPosition(indices[i]!, packed[i * 3]!, packed[i * 3 + 1]!, packed[i * 3 + 2]!);
  }
}

/**
 * Undoable vertex-position edit on a registry mesh (component move/rotate/
 * scale commit). Stores packed before/after for the affected vertices only.
 */
export class SetMeshPositionsCommand implements Command {
  readonly type = "geometry.setPositions";
  readonly label: string;
  readonly memoryCost: number;
  private readonly nodeId: Uuid;
  private readonly meshId: Uuid;
  private readonly indices: number[];
  private readonly before: Float32Array;
  private readonly after: Float32Array;

  constructor(
    nodeId: Uuid,
    meshId: Uuid,
    indices: readonly number[],
    before: Float32Array,
    after: Float32Array,
    label = "Move Components",
  ) {
    this.nodeId = nodeId;
    this.meshId = meshId;
    this.indices = [...indices];
    this.before = before;
    this.after = after;
    this.label = label;
    this.memoryCost = before.byteLength + after.byteLength + this.indices.length * 4;
  }

  execute(doc: Document): void {
    const mesh = meshRegistry.get(this.meshId);
    if (!mesh) return; // mesh gone (converted node deleted) — nothing to redo onto
    scatterPositions(mesh, this.indices, this.after);
    doc.touchNode(this.nodeId);
  }

  undo(doc: Document): void {
    const mesh = meshRegistry.get(this.meshId);
    if (!mesh) return;
    scatterPositions(mesh, this.indices, this.before);
    doc.touchNode(this.nodeId);
  }
}

/**
 * Preview→commit session for a component drag: update() writes vertex
 * positions live (preview-tagged), commit() collapses the drag into ONE
 * SetMeshPositionsCommand, cancel() restores the begin positions exactly.
 * Input: packed xyz for the session's vertex `indices`, mesh-local space.
 */
export class ComponentTransformSession implements InteractiveSession<Float32Array> {
  readonly label: string;
  private readonly nodeId: Uuid;
  private readonly meshId: Uuid;
  private readonly indices: readonly number[];
  private before: Float32Array = new Float32Array(0);

  constructor(nodeId: Uuid, meshId: Uuid, indices: readonly number[], label = "Move Components") {
    this.nodeId = nodeId;
    this.meshId = meshId;
    this.indices = indices;
    this.label = label;
  }

  begin(_doc: Document): void {
    const mesh = meshRegistry.get(this.meshId);
    if (mesh) this.before = gatherPositions(mesh, this.indices);
  }

  update(doc: Document, positions: Float32Array): void {
    const mesh = meshRegistry.get(this.meshId);
    if (!mesh) return;
    scatterPositions(mesh, this.indices, positions);
    doc.touchNode(this.nodeId, true); // preview
  }

  commit(doc: Document): Command | null {
    const mesh = meshRegistry.get(this.meshId);
    if (!mesh) return null;
    const after = gatherPositions(mesh, this.indices);
    let changed = false;
    for (let i = 0; i < after.length; i++) {
      if (after[i] !== this.before[i]) {
        changed = true;
        break;
      }
    }
    if (!changed) return null;
    // final non-preview touch: render side refreshes BVH/derived caches
    doc.touchNode(this.nodeId);
    return new SetMeshPositionsCommand(
      this.nodeId,
      this.meshId,
      this.indices,
      this.before,
      after,
      this.label,
    );
  }

  cancel(doc: Document): void {
    const mesh = meshRegistry.get(this.meshId);
    if (!mesh) return;
    scatterPositions(mesh, this.indices, this.before);
    doc.touchNode(this.nodeId);
  }
}
