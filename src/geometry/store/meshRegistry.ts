import type { Uuid } from "@/types/core";
import type { HEMesh } from "@/geometry/kernel/HEMesh";

/**
 * Registry of editable kernel meshes, keyed by mesh id (referenced from
 * scene nodes as node.data.mesh.id). Lives in the geometry layer because
 * core must not import the kernel (import direction: geometry → core).
 * Serialization into the .thride package arrives with chunk H1.
 */
const meshes = new Map<Uuid, HEMesh>();

export const meshRegistry = {
  get(id: Uuid): HEMesh | undefined {
    return meshes.get(id);
  },
  register(id: Uuid, mesh: HEMesh): void {
    meshes.set(id, mesh);
  },
  unregister(id: Uuid): void {
    meshes.delete(id);
  },
  has(id: Uuid): boolean {
    return meshes.has(id);
  },
};

/** Approximate retained bytes of a kernel mesh (history memory budgeting). */
export function meshBytes(m: HEMesh): number {
  return (
    m.heNext.byteLength +
    m.heTwin.byteLength +
    m.heVert.byteLength +
    m.heFace.byteLength +
    m.heUV.byteLength +
    m.vPos.byteLength +
    m.vHE.byteLength +
    m.fHE.byteLength
  );
}
