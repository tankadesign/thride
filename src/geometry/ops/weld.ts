import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { adoptSoup, compactSoup, meshToSoup, type OpResult } from "./soup";

/**
 * Weld the selected vertices into one at their centroid (C4D Weld with no
 * target point). Faces that degenerate collapse away: consecutive repeats
 * merge, loops shorter than 3 or with non-adjacent repeats (bowties) drop.
 * Returns null — mesh untouched — for <2 verts or a non-manifold result.
 */
export function weldVertices(mesh: HEMesh, vertIds: number[]): OpResult | null {
  const selected = new Set(vertIds.filter((v) => v >= 0 && v < mesh.vCount));
  if (selected.size < 2) return null;
  const soup = meshToSoup(mesh);

  const target = Math.min(...selected);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const v of selected) {
    cx += soup.positions[v * 3]!;
    cy += soup.positions[v * 3 + 1]!;
    cz += soup.positions[v * 3 + 2]!;
  }
  soup.positions[target * 3] = cx / selected.size;
  soup.positions[target * 3 + 1] = cy / selected.size;
  soup.positions[target * 3 + 2] = cz / selected.size;

  const faces: number[][] = [];
  const faceUVs: number[][] = [];
  for (let f = 0; f < soup.faces.length; f++) {
    const srcLoop = soup.faces[f]!;
    const srcUV = soup.faceUVs[f]!;
    // remap, collapsing consecutive duplicates (uv rides along per corner)
    const loop: number[] = [];
    const uv: number[] = [];
    for (let i = 0; i < srcLoop.length; i++) {
      const v = selected.has(srcLoop[i]!) ? target : srcLoop[i]!;
      if (loop.length > 0 && loop[loop.length - 1] === v) continue;
      loop.push(v);
      uv.push(srcUV[i * 2]!, srcUV[i * 2 + 1]!);
    }
    while (loop.length > 1 && loop[0] === loop[loop.length - 1]) {
      loop.pop();
      uv.pop();
      uv.pop();
    }
    if (loop.length < 3) continue; // fully collapsed
    if (new Set(loop).size !== loop.length) continue; // bowtie — drop
    faces.push(loop);
    faceUVs.push(uv);
  }
  if (faces.length === 0) return null; // would delete the whole mesh
  soup.faces = faces;
  soup.faceUVs = faceUVs;
  const map = compactSoup(soup);
  if (map[target] === -1) return null; // welded vert lost every face
  if (!adoptSoup(mesh, soup)) return null;
  return { mode: "point", ids: [map[target]!] };
}
