import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { adoptSoup, compactSoup, meshToSoup, type OpResult } from "./soup";

/**
 * Vertex-merge ops. `dissolveVertices` collapses a selection to its
 * centroid (the Mesh menu "Dissolve" action); `weldVerticesTo` is the Weld
 * TOOL's op — source verts merge INTO a target vertex, keeping the
 * target's exact position (C4D weld-to-point). Faces that degenerate
 * collapse away: consecutive repeats merge, loops shorter than 3 or with
 * non-adjacent repeats (bowties) drop. Both return null — mesh untouched —
 * on bad input or a non-manifold result.
 */

function mergeInto(
  mesh: HEMesh,
  merged: ReadonlySet<number>,
  target: number,
  targetPos: [number, number, number],
): OpResult | null {
  const soup = meshToSoup(mesh);
  soup.positions[target * 3] = targetPos[0];
  soup.positions[target * 3 + 1] = targetPos[1];
  soup.positions[target * 3 + 2] = targetPos[2];

  const faces: number[][] = [];
  const faceUVs: number[][] = [];
  for (let f = 0; f < soup.faces.length; f++) {
    const srcLoop = soup.faces[f]!;
    const srcUV = soup.faceUVs[f]!;
    // remap, collapsing consecutive duplicates (uv rides along per corner)
    const loop: number[] = [];
    const uv: number[] = [];
    for (let i = 0; i < srcLoop.length; i++) {
      const v = merged.has(srcLoop[i]!) ? target : srcLoop[i]!;
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
  if (map[target] === -1) return null; // merged vert lost every face
  if (!adoptSoup(mesh, soup)) return null;
  return { mode: "point", ids: [map[target]!] };
}

/** Collapse the selected vertices to their centroid ("Dissolve"). */
export function dissolveVertices(mesh: HEMesh, vertIds: number[]): OpResult | null {
  const selected = new Set(vertIds.filter((v) => v >= 0 && v < mesh.vCount));
  if (selected.size < 2) return null;
  const target = Math.min(...selected);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const v of selected) {
    cx += mesh.vPos[v * 3]!;
    cy += mesh.vPos[v * 3 + 1]!;
    cz += mesh.vPos[v * 3 + 2]!;
  }
  const n = selected.size;
  return mergeInto(mesh, selected, target, [cx / n, cy / n, cz / n]);
}

/** Weld `sourceIds` INTO `target`, keeping the target's position (Weld tool). */
export function weldVerticesTo(mesh: HEMesh, sourceIds: number[], target: number): OpResult | null {
  if (target < 0 || target >= mesh.vCount) return null;
  const merged = new Set(sourceIds.filter((v) => v >= 0 && v < mesh.vCount && v !== target));
  if (merged.size === 0) return null;
  merged.add(target);
  return mergeInto(mesh, merged, target, [
    mesh.vPos[target * 3]!,
    mesh.vPos[target * 3 + 1]!,
    mesh.vPos[target * 3 + 2]!,
  ]);
}
