import { type Camera, type Mesh, type PerspectiveCamera, type Raycaster, Vector3 } from "three";
import type { ComponentMode } from "@/types/core";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { edgeVerts, uniqueEdges } from "@/geometry/kernel/components";
import type { PaneRect } from "@/render/viewport/ViewportSystem";

/** Screen-space pick tolerances (pane pixels). */
const POINT_TOLERANCE_PX = 10;
const EDGE_TOLERANCE_PX = 8;

export interface ComponentPickInput {
  mesh: HEMesh;
  /** The node's rendered Mesh (world matrix + BVH raycast for faces). */
  meshObject: Mesh;
  camera: Camera;
  pane: PaneRect;
  /** Click position in canvas pixels. */
  x: number;
  y: number;
  /** Aimed through the pane camera already (face mode). */
  raycaster: Raycaster;
  /** Triangle→face map of the rendered geometry (face mode). */
  triFace: Uint32Array | null;
}

const world = new Vector3();
const view = new Vector3();

/** World point → pane pixels; false when behind a perspective camera. */
function projectToPane(camera: Camera, pane: PaneRect, out: { x: number; y: number }): boolean {
  view.copy(world).applyMatrix4(camera.matrixWorldInverse);
  if ((camera as PerspectiveCamera).isPerspectiveCamera && view.z >= -1e-6) return false;
  view.applyMatrix4(camera.projectionMatrix);
  out.x = pane.x + ((view.x + 1) / 2) * pane.w;
  out.y = pane.y + ((1 - view.y) / 2) * pane.h;
  return true;
}

/**
 * Pick one component under the cursor, or null. Points/edges use 2D
 * screen-space distance with a pixel tolerance (C4D feel); polygons raycast
 * the rendered triangles (BVH) and map back through triFace.
 */
export function pickComponent(mode: ComponentMode, input: ComponentPickInput): number | null {
  if (mode === "polygon") return pickFace(input);
  input.camera.updateMatrixWorld();
  input.meshObject.updateMatrixWorld();
  return mode === "point" ? pickVertex(input) : pickEdge(input);
}

function pickVertex(input: ComponentPickInput): number | null {
  const { mesh, meshObject, camera, pane, x, y } = input;
  const p = { x: 0, y: 0 };
  let best = -1;
  let bestDist = POINT_TOLERANCE_PX;
  for (let v = 0; v < mesh.vCount; v++) {
    world
      .set(mesh.vPos[v * 3]!, mesh.vPos[v * 3 + 1]!, mesh.vPos[v * 3 + 2]!)
      .applyMatrix4(meshObject.matrixWorld);
    if (!projectToPane(camera, pane, p)) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = v;
    }
  }
  return best === -1 ? null : best;
}

function pickEdge(input: ComponentPickInput): number | null {
  const { mesh, meshObject, camera, pane, x, y } = input;
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  let best = -1;
  let bestDist = EDGE_TOLERANCE_PX;
  for (const h of uniqueEdges(mesh)) {
    const [va, vb] = edgeVerts(mesh, h);
    world
      .set(mesh.vPos[va * 3]!, mesh.vPos[va * 3 + 1]!, mesh.vPos[va * 3 + 2]!)
      .applyMatrix4(meshObject.matrixWorld);
    if (!projectToPane(camera, pane, a)) continue;
    world
      .set(mesh.vPos[vb * 3]!, mesh.vPos[vb * 3 + 1]!, mesh.vPos[vb * 3 + 2]!)
      .applyMatrix4(meshObject.matrixWorld);
    if (!projectToPane(camera, pane, b)) continue;
    const d = pointSegmentDistance(x, y, a.x, a.y, b.x, b.y);
    if (d < bestDist) {
      bestDist = d;
      best = h;
    }
  }
  return best === -1 ? null : best;
}

function pickFace(input: ComponentPickInput): number | null {
  const { meshObject, raycaster, triFace } = input;
  if (!triFace) return null;
  // non-recursive: children are overlays/outlines or child NODES, not this mesh
  const hit = raycaster.intersectObject(meshObject, false)[0];
  if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return null;
  // three-mesh-bvh's computeBoundsTree adds a PERMUTED index over the
  // non-indexed corners, so hit.faceIndex is in BVH order — map back to the
  // authored triangle order (corner i belongs to authored triangle i/3)
  const index = meshObject.geometry.getIndex();
  const tri = index ? Math.floor(index.getX(hit.faceIndex * 3) / 3) : hit.faceIndex;
  const face = triFace[tri];
  return face === undefined ? null : face;
}

function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
