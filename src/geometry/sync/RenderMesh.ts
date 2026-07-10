import { BufferAttribute, BufferGeometry } from "three";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { DIRTY_POSITIONS, DIRTY_TOPOLOGY } from "@/types/geometry/mesh";
import { type Triangulation, triangulate } from "./triangulate";

/**
 * Kernel → renderable BufferGeometry sync. Non-indexed (per-corner UVs need
 * split corners anyway). Dirty routing: POSITIONS rewrites position+normal
 * attributes in place; TOPOLOGY rebuilds everything.
 *
 * NOTE: BufferGeometry/BufferAttribute are three DATA classes — allowed in
 * geometry/ (the no-Three rule bans scene objects, not buffers).
 */
export class RenderMesh {
  /**
   * REPLACED (fresh object) on every topology rebuild: swapping
   * different-sized attributes on one BufferGeometry leaves three's WebGPU
   * backend drawing its cached buffers — consumers must re-read `geometry`
   * after sync() (SceneSynchronizer reassigns it to the Mesh each pass).
   */
  geometry = new BufferGeometry();
  private tri: Triangulation | null = null;
  private topologyVersion = -1;

  /** Kernel face index per rendered triangle (picking). */
  get triFace(): Uint32Array {
    return this.tri?.triFace ?? new Uint32Array(0);
  }

  /** Bring the geometry up to date with the kernel; cheap when clean. */
  sync(mesh: HEMesh): void {
    const topologyChanged = this.topologyVersion !== mesh.topologyVersion || !this.tri;
    if (topologyChanged || mesh.dirty & DIRTY_TOPOLOGY) {
      this.rebuild(mesh);
    } else if (mesh.dirty & DIRTY_POSITIONS) {
      this.updatePositions(mesh);
    }
    mesh.clearDirty();
  }

  private rebuild(mesh: HEMesh): void {
    this.tri = triangulate(mesh);
    this.topologyVersion = mesh.topologyVersion;
    const { triCount } = this.tri;
    const positions = new Float32Array(triCount * 9);
    const normals = new Float32Array(triCount * 9);
    const uvs = new Float32Array(triCount * 6);
    this.geometry.dispose();
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", new BufferAttribute(positions, 3));
    this.geometry.setAttribute("normal", new BufferAttribute(normals, 3));
    this.geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    this.writeAll(mesh);
  }

  private updatePositions(mesh: HEMesh): void {
    this.writeAll(mesh); // positions + normals; uv untouched unless topology changed
    const pos = this.geometry.getAttribute("position") as BufferAttribute;
    const nor = this.geometry.getAttribute("normal") as BufferAttribute;
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }

  private writeAll(mesh: HEMesh): void {
    const { corners } = this.tri!;
    const pos = (this.geometry.getAttribute("position") as BufferAttribute).array as Float32Array;
    const nor = (this.geometry.getAttribute("normal") as BufferAttribute).array as Float32Array;
    const uv = (this.geometry.getAttribute("uv") as BufferAttribute).array as Float32Array;
    const vertexNormals = mesh.computeVertexNormals();

    for (let c = 0; c < corners.length; c++) {
      const h = corners[c]!;
      const v = mesh.heVert[h]!;
      pos[c * 3] = mesh.vPos[v * 3]!;
      pos[c * 3 + 1] = mesh.vPos[v * 3 + 1]!;
      pos[c * 3 + 2] = mesh.vPos[v * 3 + 2]!;
      nor[c * 3] = vertexNormals[v * 3]!;
      nor[c * 3 + 1] = vertexNormals[v * 3 + 1]!;
      nor[c * 3 + 2] = vertexNormals[v * 3 + 2]!;
      uv[c * 2] = mesh.heUV[h * 2]!;
      uv[c * 2 + 1] = mesh.heUV[h * 2 + 1]!;
    }
    const posAttr = this.geometry.getAttribute("position") as BufferAttribute;
    posAttr.needsUpdate = true;
    (this.geometry.getAttribute("normal") as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("uv") as BufferAttribute).needsUpdate = true;
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
