import {
  BufferGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  type Material,
} from "three";
import type { Uuid } from "@/types/core";
import type { Document, SceneNode } from "@/core";
import { RenderMesh } from "@/geometry/sync/RenderMesh";
import { evaluateCloner } from "@/generators/graph";

/**
 * The render half of the Cloner generator (F2). A cloner node maps to an
 * `InstancedMesh` (unlike every other mesh/generator, which maps to a plain
 * `Mesh`): the base template's geometry drawn N times, one per matrix from
 * {@link evaluateCloner}. The flat column-major matrix array copies straight
 * onto the instance buffer — no per-instance `setMatrixAt` Matrix4 round-trip,
 * which is what keeps a 100k count-drag smooth.
 *
 * The InstancedMesh IS the node's object (so material resolution in
 * `applyShading` and pick-parent-walk both work for free), but its capacity is
 * fixed at construction — so a count that outgrows the buffer forces a fresh
 * object with headroom, and {@link sync} returns it for the caller to swap into
 * the scene graph. `frustumCulled` is off because the bounding sphere is the
 * base geometry at the origin; instances spread far past it and would otherwise
 * cull as a group.
 */

interface ClonerRecord {
  inst: InstancedMesh;
  /** Max instances the current inst's buffer holds (grown with headroom). */
  capacity: number;
  /** Persistent HEMesh→BufferGeometry bridge for the base template. */
  rm: RenderMesh;
}

/** Grow the instance buffer to count × this, so small bumps don't reallocate. */
const HEADROOM = 1.5;

const asMaterial = (m: Material | Material[]): Material => (Array.isArray(m) ? m[0]! : m);

export class ClonerSync {
  private readonly doc: Document;
  private readonly records = new Map<Uuid, ClonerRecord>();

  constructor(doc: Document) {
    this.doc = doc;
  }

  has(id: Uuid): boolean {
    return this.records.has(id);
  }

  /** Build the node's InstancedMesh (an immediate {@link sync} fills it). */
  build(node: SceneNode, material: Material): InstancedMesh {
    const inst = new InstancedMesh(new BufferGeometry(), material, 0);
    inst.frustumCulled = false;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.count = 0;
    this.records.set(node.id, { inst, capacity: 0, rm: new RenderMesh() });
    return this.sync(node, inst);
  }

  /**
   * Refresh the cloner's instances. Returns the InstancedMesh to keep for the
   * node — the SAME object when the count fit the existing capacity, or a NEW
   * one (with headroom) when it outgrew the buffer; the caller swaps that into
   * the scene graph.
   */
  sync(node: SceneNode, current: InstancedMesh): InstancedMesh {
    let rec = this.records.get(node.id);
    if (!rec) {
      rec = { inst: current, capacity: current.count, rm: new RenderMesh() };
      this.records.set(node.id, rec);
    }
    const result = evaluateCloner(this.doc, node);
    if (!result) {
      current.count = 0; // no template / no clones → draw nothing
      return current;
    }
    const count = result.matrices.length / 16;
    rec.rm.sync(result.base);
    const geom = rec.rm.geometry;

    let inst = current;
    if (count > rec.capacity) {
      // InstancedMesh capacity is fixed at construction — recreate with headroom
      const capacity = Math.max(1, Math.ceil(count * HEADROOM));
      const next = new InstancedMesh(geom, asMaterial(current.material), capacity);
      next.frustumCulled = false;
      next.castShadow = true;
      next.receiveShadow = true;
      next.instanceMatrix.setUsage(DynamicDrawUsage);
      current.dispose(); // frees old instance buffers (the base geometry is rec.rm's, kept)
      rec.capacity = capacity;
      inst = next;
    } else {
      inst.geometry = geom; // template may have been edited under the same count
    }
    // copy the flat column-major matrices straight into the instance buffer
    inst.instanceMatrix.array.set(result.matrices);
    inst.instanceMatrix.needsUpdate = true;
    inst.count = count;
    rec.inst = inst;
    return inst;
  }

  remove(id: Uuid): void {
    const rec = this.records.get(id);
    if (!rec) return;
    rec.inst.dispose();
    rec.rm.dispose();
    this.records.delete(id);
  }

  dispose(): void {
    for (const rec of this.records.values()) {
      rec.inst.dispose();
      rec.rm.dispose();
    }
    this.records.clear();
  }
}
