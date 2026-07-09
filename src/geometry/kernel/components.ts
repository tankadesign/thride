import type { ComponentMode } from "@/types/core";
import type { Bitset } from "@/core/selection/Bitset";
import type { HEMesh } from "./HEMesh";

/**
 * Component addressing over the half-edge kernel.
 *
 * - Points are vertex indices, polygons are face indices.
 * - Edges are CANONICAL halfedge handles: a boundary halfedge (twin === -1)
 *   or the smaller index of a twinned pair. Selection bitsets index these
 *   directly, so edge ids stay stable as long as topologyVersion does.
 */

/** Canonical halfedge handle for every undirected edge. */
export function uniqueEdges(mesh: HEMesh): number[] {
  const out: number[] = [];
  for (let h = 0; h < mesh.heCount; h++) {
    const t = mesh.heTwin[h]!;
    if (t === -1 || h < t) out.push(h);
  }
  return out;
}

/** The two endpoint vertices of the edge owning halfedge h. */
export function edgeVerts(mesh: HEMesh, h: number): [number, number] {
  return [mesh.heVert[h]!, mesh.heVert[mesh.heNext[h]!]!];
}

/** Canonical edge handle for any halfedge. */
export function canonicalEdge(mesh: HEMesh, h: number): number {
  const t = mesh.heTwin[h]!;
  return t === -1 || h < t ? h : t;
}

/** Distinct vertex indices affected by a component selection (drag targets). */
export function vertsForSelection(mesh: HEMesh, mode: ComponentMode, bits: Bitset): number[] {
  const verts = new Set<number>();
  if (mode === "point") {
    bits.forEach((v) => {
      if (v < mesh.vCount) verts.add(v);
    });
  } else if (mode === "edge") {
    bits.forEach((h) => {
      if (h < mesh.heCount) {
        const [a, b] = edgeVerts(mesh, h);
        verts.add(a);
        verts.add(b);
      }
    });
  } else {
    bits.forEach((f) => {
      if (f < mesh.fCount) for (const v of mesh.faceVertices(f)) verts.add(v);
    });
  }
  return [...verts];
}

/** Centroid of a vertex set in mesh-local space ([0,0,0] for empty). */
export function vertexCentroid(mesh: HEMesh, verts: readonly number[]): [number, number, number] {
  const c: [number, number, number] = [0, 0, 0];
  if (verts.length === 0) return c;
  for (const v of verts) {
    c[0] += mesh.vPos[v * 3]!;
    c[1] += mesh.vPos[v * 3 + 1]!;
    c[2] += mesh.vPos[v * 3 + 2]!;
  }
  c[0] /= verts.length;
  c[1] /= verts.length;
  c[2] /= verts.length;
  return c;
}
