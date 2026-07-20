import { BufferGeometry, DynamicDrawUsage, InstancedMesh, type Material } from "three";
import type { Uuid } from "@/types/core";
import type { Document, SceneNode } from "@/core";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
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
 * `applyShading` and pick-parent-walk both work for free). Its capacity is
 * fixed at construction, so a count that outgrows the buffer forces a fresh
 * object with headroom — {@link sync} returns it for the caller to swap into
 * the scene graph. Two WebGPU lifetime rules learned the hard way:
 *   - **Retiring the old InstancedMesh must be deferred well past the in-flight
 *     GPU submit.** Disposing it in the same tick (or even one grow later, when
 *     a fast count-drag fires several grows before a frame is submitted) throws
 *     "buffer used while destroyed" and silently aborts the frame — which
 *     leaves the viewport blank. {@link retire} dumps it on a timer instead.
 *   - **Resizing means a NEW InstancedMesh** — reassigning `instanceMatrix` on
 *     the existing one doesn't re-bind on the WebGPU backend, so the extra
 *     clones never draw.
 * `frustumCulled` is off because the bounding sphere is the base at the origin;
 * instances spread far past it.
 */

interface ClonerRecord {
  inst: InstancedMesh;
  /** Instances the current inst's buffer holds (grown with headroom). */
  capacity: number;
  /** Persistent HEMesh→BufferGeometry bridge for the base template. */
  rm: RenderMesh;
  /** Last template mesh fed to `rm` — a count/effector change reuses its buffer. */
  base: HEMesh | null;
}

/** Grow the instance buffer to count × this, so small bumps don't reallocate. */
const HEADROOM = 1.5;
/** How long a retired InstancedMesh lingers before disposal — many frames, so
 * the GPU is guaranteed past any submit that referenced its buffer. */
const RETIRE_MS = 500;

const asMaterial = (m: Material | Material[]): Material => (Array.isArray(m) ? m[0]! : m);

const makeInstanced = (
  geom: BufferGeometry,
  material: Material,
  capacity: number,
): InstancedMesh => {
  const inst = new InstancedMesh(geom, material, capacity);
  inst.frustumCulled = false;
  inst.castShadow = true;
  inst.receiveShadow = true;
  inst.instanceMatrix.setUsage(DynamicDrawUsage);
  inst.count = 0;
  return inst;
};

export class ClonerSync {
  private readonly doc: Document;
  private readonly records = new Map<Uuid, ClonerRecord>();
  /** Retired InstancedMeshes awaiting deferred disposal (see {@link retire}). */
  private readonly retiring = new Set<InstancedMesh>();
  /** Retired RenderMeshes (base geometry) awaiting deferred disposal — same GPU
   *  lifetime rule as {@link retire}, see {@link retireMesh}. */
  private readonly retiringMeshes = new Set<RenderMesh>();

  constructor(doc: Document) {
    this.doc = doc;
  }

  has(id: Uuid): boolean {
    return this.records.has(id);
  }

  /** Dispose an InstancedMesh only after the GPU is safely done with its buffer. */
  private retire(inst: InstancedMesh): void {
    this.retiring.add(inst);
    setTimeout(() => {
      if (this.retiring.delete(inst)) inst.dispose();
    }, RETIRE_MS);
  }

  /**
   * Dispose a base-geometry RenderMesh only well past any submit that used it.
   * `RenderMesh.rebuild` disposes the old BufferGeometry's GPU buffers, but
   * three's WebGPU backend can still reference them in an in-flight / cached
   * submit for THIS cloner's InstancedMesh — a synchronous dispose throws
   * "buffer used while destroyed", which aborts the frame's command submit. The
   * dropped submit takes the pane's CLEAR with it, so the viewport stops clearing
   * and frames visibly stack (worst on a heavy instancer, where slow frames widen
   * the window). Retiring the whole RenderMesh — instead of letting rebuild()
   * dispose in place — defers that disposal exactly like the InstancedMesh's.
   */
  private retireMesh(rm: RenderMesh): void {
    this.retiringMeshes.add(rm);
    setTimeout(() => {
      if (this.retiringMeshes.delete(rm)) rm.dispose();
    }, RETIRE_MS);
  }

  /** Build the node's initial InstancedMesh (an immediate {@link sync} fills it). */
  build(node: SceneNode, material: Material): InstancedMesh {
    const inst = makeInstanced(new BufferGeometry(), material, 1);
    this.records.set(node.id, { inst, capacity: 1, rm: new RenderMesh(), base: null });
    return this.sync(node, inst);
  }

  /**
   * Refresh the cloner's instances. Returns the InstancedMesh to keep for the
   * node — the SAME object when the count fit the buffer, or a NEW one (with
   * headroom) when it outgrew it; the caller swaps that into the scene graph.
   */
  sync(node: SceneNode, current: InstancedMesh): InstancedMesh {
    let rec = this.records.get(node.id);
    if (!rec) {
      rec = { inst: current, capacity: current.count, rm: new RenderMesh(), base: null };
      this.records.set(node.id, rec);
    }
    const result = evaluateCloner(this.doc, node);
    if (!result) {
      current.count = 0; // no template / no clones → draw nothing
      return current;
    }
    const count = result.matrices.length / 16;
    // Rebuild the base geometry only when the template actually changed — a
    // count/effector edit reuses the same GPU buffer (re-syncing it every frame
    // churns a buffer that may still be in a submitted command). A real template
    // change gets a FRESH RenderMesh with the old one RETIRED (deferred dispose):
    // syncing in place would dispose the old geometry's GPU buffers synchronously
    // while the backend may still submit them for this InstancedMesh — see
    // {@link retireMesh}.
    const templateChanged = rec.base !== result.base;
    if (templateChanged) {
      const nrm = new RenderMesh();
      nrm.sync(result.base);
      this.retireMesh(rec.rm);
      rec.rm = nrm;
      rec.base = result.base;
    }
    const geom = rec.rm.geometry;

    let inst = current;
    // A NEW InstancedMesh is needed both to grow the buffer AND whenever the base
    // geometry changed: three's WebGPU backend caches the draw's vertex-buffer
    // binding per object, and reassigning `.geometry` on a live InstancedMesh
    // leaves it submitting the OLD (now-swapped) buffers — the "used while
    // destroyed" abort that stops the viewport clearing. A fresh object binds the
    // new geometry cleanly; the outgoing one is retired (deferred), never disposed
    // synchronously.
    if (count > rec.capacity || templateChanged) {
      const capacity =
        count > rec.capacity ? Math.max(1, Math.ceil(count * HEADROOM)) : rec.capacity;
      inst = makeInstanced(geom, asMaterial(current.material), capacity);
      this.retire(current);
      rec.capacity = capacity;
    }
    // copy the flat column-major matrices straight into the instance buffer
    inst.instanceMatrix.array.set(result.matrices);
    inst.instanceMatrix.needsUpdate = true;
    inst.count = count;
    // three's InstancedMesh.raycast broad-phases against a cached boundingSphere
    // it never recomputes on matrix changes — clear it so the next pick rebuilds
    // it from the fresh matrices (else spread-out clones become unpickable)
    inst.boundingSphere = null;
    rec.inst = inst;
    return inst;
  }

  remove(id: Uuid): void {
    const rec = this.records.get(id);
    if (!rec) return;
    this.retire(rec.inst); // deferred — a removed cloner may still be mid-frame
    this.retireMesh(rec.rm); // deferred for the same reason (its buffers may still submit)
    this.records.delete(id);
  }

  dispose(): void {
    for (const rec of this.records.values()) {
      rec.inst.dispose();
      rec.rm.dispose();
    }
    this.records.clear();
    for (const inst of this.retiring) inst.dispose();
    this.retiring.clear();
    for (const rm of this.retiringMeshes) rm.dispose();
    this.retiringMeshes.clear();
  }
}
