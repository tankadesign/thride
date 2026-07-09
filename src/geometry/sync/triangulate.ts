import earcut from "earcut";
import type { HEMesh } from "@/geometry/kernel/HEMesh";

export interface Triangulation {
  /** Halfedge handle per triangle corner (3 per tri) — ties corners to UVs/verts. */
  corners: Uint32Array;
  /** Kernel face index per triangle (picking, per-face highlight). */
  triFace: Uint32Array;
  triCount: number;
}

/**
 * Triangulate every face: direct for tris, diagonal split for quads
 * (primitive quads are convex), earcut in the dominant plane of the Newell
 * normal for n-gons — handles concave caps and future boolean output.
 */
export function triangulate(mesh: HEMesh): Triangulation {
  const corners: number[] = [];
  const triFace: number[] = [];
  const n: [number, number, number] = [0, 0, 0];

  for (let f = 0; f < mesh.fCount; f++) {
    const loop = mesh.faceHalfEdges(f);
    if (loop.length === 3) {
      corners.push(loop[0]!, loop[1]!, loop[2]!);
      triFace.push(f);
    } else if (loop.length === 4) {
      corners.push(loop[0]!, loop[1]!, loop[2]!, loop[0]!, loop[2]!, loop[3]!);
      triFace.push(f, f);
    } else {
      mesh.faceNormal(f, n);
      // dominant axis → 2D projection plane; keep orientation consistent
      const ax = Math.abs(n[0]);
      const ay = Math.abs(n[1]);
      const az = Math.abs(n[2]);
      const flat: number[] = [];
      for (const h of loop) {
        const v = mesh.heVert[h]!;
        const x = mesh.vPos[v * 3]!;
        const y = mesh.vPos[v * 3 + 1]!;
        const z = mesh.vPos[v * 3 + 2]!;
        if (ax >= ay && ax >= az) flat.push(n[0] > 0 ? y : z, n[0] > 0 ? z : y);
        else if (ay >= ax && ay >= az) flat.push(n[1] > 0 ? z : x, n[1] > 0 ? x : z);
        else flat.push(n[2] > 0 ? x : y, n[2] > 0 ? y : x);
      }
      const tris = earcut(flat);
      for (let i = 0; i < tris.length; i += 3) {
        corners.push(loop[tris[i]!]!, loop[tris[i + 1]!]!, loop[tris[i + 2]!]!);
        triFace.push(f);
      }
    }
  }

  return {
    corners: new Uint32Array(corners),
    triFace: new Uint32Array(triFace),
    triCount: triFace.length,
  };
}
