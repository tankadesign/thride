import type { ComponentMode } from "@/types/core";
import type { PolygonMeshData } from "@/types/geometry/mesh";
import { HEMesh } from "@/geometry/kernel/HEMesh";

/** What an op leaves selected (fresh ids — topology ops invalidate stamps). */
export interface OpResult {
  mode: ComponentMode;
  ids: number[];
}

/**
 * D4 topology ops edit in POLYGON-SOUP space and rebuild the kernel: soup
 * edits are plain array manipulation (easy to get right), and fromPolygons
 * re-derives all connectivity. O(n) per op — fine at M1 scales; native
 * half-edge surgery is a later performance pass, not a correctness need.
 */
export interface Soup {
  positions: number[];
  faces: number[][];
  faceUVs: number[][];
}

export function meshToSoup(mesh: HEMesh): Soup {
  const positions = Array.from(mesh.vPos.subarray(0, mesh.vCount * 3));
  const faces: number[][] = [];
  const faceUVs: number[][] = [];
  for (let f = 0; f < mesh.fCount; f++) {
    const hs = mesh.faceHalfEdges(f);
    faces.push(hs.map((h) => mesh.heVert[h]!));
    const uv: number[] = [];
    for (const h of hs) uv.push(mesh.heUV[h * 2]!, mesh.heUV[h * 2 + 1]!);
    faceUVs.push(uv);
  }
  return { positions, faces, faceUVs };
}

/** Drop vertices no face references; remaps face loops in place. */
export function compactSoup(soup: Soup): Int32Array {
  const vCount = soup.positions.length / 3;
  const map = new Int32Array(vCount).fill(-1);
  let next = 0;
  for (const loop of soup.faces) {
    for (const v of loop) if (map[v] === -1) map[v] = next++;
  }
  const positions = new Array<number>(next * 3);
  for (let v = 0; v < vCount; v++) {
    const m = map[v]!;
    if (m === -1) continue;
    positions[m * 3] = soup.positions[v * 3]!;
    positions[m * 3 + 1] = soup.positions[v * 3 + 1]!;
    positions[m * 3 + 2] = soup.positions[v * 3 + 2]!;
  }
  soup.positions = positions;
  for (const loop of soup.faces) {
    for (let i = 0; i < loop.length; i++) loop[i] = map[loop[i]!]!;
  }
  return map;
}

/**
 * Rebuild the kernel from an edited soup. Returns false — with the mesh
 * COMPLETELY untouched — when the result would be non-manifold, so ops can
 * abort cleanly instead of corrupting the kernel.
 */
export function adoptSoup(mesh: HEMesh, soup: PolygonMeshData): boolean {
  try {
    const rebuilt = HEMesh.fromPolygons(soup);
    mesh.restore(rebuilt.snapshot());
    return true;
  } catch {
    return false;
  }
}
