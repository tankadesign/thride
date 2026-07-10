import { type Camera, type Object3D, type PerspectiveCamera, Vector3 } from "three";
import { edgeVerts, uniqueEdges } from "@/geometry/kernel/components";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import type { PaneRect } from "@/render/viewport/ViewportSystem";

/** Screen-space radius (pane pixels) for the magnet to grab a vertex/edge. */
const SNAP_TOLERANCE_PX = 12;

export interface SnapCandidate {
  meshId: string;
  mesh: HEMesh;
  object: Object3D;
}

export interface SnapHit {
  /** Snapped world position (a vertex, or nearest point on an edge). */
  world: Vector3;
  kind: "vertex" | "edge";
}

const s = new Vector3();
const wp = new Vector3();
const a = new Vector3();
const b = new Vector3();

/**
 * Nearest snap target (vertex preferred, else edge) to a world point, judged
 * by screen-space distance through the pane camera. `exclude` skips the
 * geometry being dragged so it never snaps to itself.
 */
export function findSnap(
  target: Vector3,
  camera: Camera,
  pane: PaneRect,
  candidates: SnapCandidate[],
  exclude: (meshId: string, v: number) => boolean,
): SnapHit | null {
  camera.updateMatrixWorld();
  const project = (w: Vector3): { x: number; y: number } | null => {
    s.copy(w).applyMatrix4(camera.matrixWorldInverse);
    if ((camera as PerspectiveCamera).isPerspectiveCamera && s.z >= -1e-6) return null;
    s.applyMatrix4(camera.projectionMatrix);
    return { x: pane.x + ((s.x + 1) / 2) * pane.w, y: pane.y + ((1 - s.y) / 2) * pane.h };
  };
  const ts = project(target);
  if (!ts) return null;

  // vertex pass (preferred)
  let best: SnapHit | null = null;
  let bestDist = SNAP_TOLERANCE_PX;
  for (const c of candidates) {
    c.object.updateMatrixWorld();
    const m = c.object.matrixWorld;
    for (let v = 0; v < c.mesh.vCount; v++) {
      if (exclude(c.meshId, v)) continue;
      wp.set(c.mesh.vPos[v * 3]!, c.mesh.vPos[v * 3 + 1]!, c.mesh.vPos[v * 3 + 2]!).applyMatrix4(m);
      const p = project(wp);
      if (!p) continue;
      const d = Math.hypot(p.x - ts.x, p.y - ts.y);
      if (d < bestDist) {
        bestDist = d;
        best = { world: wp.clone(), kind: "vertex" };
      }
    }
  }
  if (best) return best;

  // edge pass: the world-space closest point on each edge to the target
  bestDist = SNAP_TOLERANCE_PX;
  const cp = new Vector3();
  for (const c of candidates) {
    const m = c.object.matrixWorld;
    for (const h of uniqueEdges(c.mesh)) {
      const [va, vb] = edgeVerts(c.mesh, h);
      if (exclude(c.meshId, va) && exclude(c.meshId, vb)) continue;
      a.set(c.mesh.vPos[va * 3]!, c.mesh.vPos[va * 3 + 1]!, c.mesh.vPos[va * 3 + 2]!).applyMatrix4(
        m,
      );
      b.set(c.mesh.vPos[vb * 3]!, c.mesh.vPos[vb * 3 + 1]!, c.mesh.vPos[vb * 3 + 2]!).applyMatrix4(
        m,
      );
      closestOnSegment(target, a, b, cp);
      const p = project(cp);
      if (!p) continue;
      const d = Math.hypot(p.x - ts.x, p.y - ts.y);
      if (d < bestDist) {
        bestDist = d;
        best = { world: cp.clone(), kind: "edge" };
      }
    }
  }
  return best;
}

function closestOnSegment(p: Vector3, a: Vector3, b: Vector3, out: Vector3): void {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const lenSq = abx * abx + aby * aby + abz * abz;
  const t =
    lenSq === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lenSq),
        );
  out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
}
