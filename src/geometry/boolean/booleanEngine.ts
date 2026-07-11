import type { TransformDTO } from "@/types/core";
import { HEMesh } from "@/geometry/kernel/HEMesh";
import { triangulate } from "@/geometry/sync/triangulate";

export type BooleanOp = "union" | "subtract" | "intersect";

export interface TriMeshData {
  positions: Float32Array;
  triVerts: Uint32Array;
}

/**
 * Client for the Manifold boolean worker: one in-flight promise per job id.
 * The worker owns the WASM; the main thread never blocks on CSG.
 */
class BooleanEngine {
  private worker: Worker | null = null;
  private jobs = new Map<number, { resolve: (r: TriMeshData | null) => void }>();
  private nextId = 1;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("../../workers/boolean.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (
        e: MessageEvent<{
          jobId: number;
          ok: boolean;
          positions?: Float32Array;
          triVerts?: Uint32Array;
        }>,
      ) => {
        const job = this.jobs.get(e.data.jobId);
        if (!job) return;
        this.jobs.delete(e.data.jobId);
        job.resolve(
          e.data.ok && e.data.positions && e.data.triVerts
            ? { positions: e.data.positions, triVerts: e.data.triVerts }
            : null,
        );
      };
    }
    return this.worker;
  }

  /** Run one boolean op; resolves null on non-manifold input / engine error. */
  run(op: BooleanOp, a: TriMeshData, b: TriMeshData): Promise<TriMeshData | null> {
    const worker = this.ensureWorker();
    const jobId = this.nextId++;
    return new Promise((resolve) => {
      this.jobs.set(jobId, { resolve });
      worker.postMessage({ jobId, op, a, b }, [
        a.positions.buffer,
        a.triVerts.buffer,
        b.positions.buffer,
        b.triVerts.buffer,
      ]);
    });
  }
}

export const booleanEngine = new BooleanEngine();

/**
 * HEMesh → transformed triangle soup for the worker. Applies the node's
 * LOCAL transform (children of a boolean are expressed in its space).
 */
export function hemeshToTris(mesh: HEMesh, transform: TransformDTO): TriMeshData {
  const tri = triangulate(mesh);
  const triVerts = new Uint32Array(tri.corners.length);
  for (let i = 0; i < tri.corners.length; i++) triVerts[i] = mesh.heVert[tri.corners[i]!]!;
  const positions = new Float32Array(mesh.vCount * 3);
  const m = composeTRS(transform);
  for (let v = 0; v < mesh.vCount; v++) {
    const x = mesh.vPos[v * 3]!;
    const y = mesh.vPos[v * 3 + 1]!;
    const z = mesh.vPos[v * 3 + 2]!;
    positions[v * 3] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    positions[v * 3 + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    positions[v * 3 + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  }
  return { positions, triVerts };
}

/** Worker result (welded triangles) → kernel mesh. */
export function trisToHEMesh(tris: TriMeshData): HEMesh | null {
  const faces: number[][] = [];
  for (let t = 0; t < tris.triVerts.length; t += 3) {
    faces.push([tris.triVerts[t]!, tris.triVerts[t + 1]!, tris.triVerts[t + 2]!]);
  }
  if (faces.length === 0) return null;
  const faceUVs = faces.map(() => [0, 0, 0, 0, 0, 0]);
  try {
    return HEMesh.fromPolygons({ positions: Array.from(tris.positions), faces, faceUVs });
  } catch {
    return null;
  }
}

/** Column-major TRS matrix from a TransformDTO (XYZ euler) — no three dep. */
export function composeTRS(t: TransformDTO): number[] {
  const [rx, ry, rz] = t.rotation;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  // R = Rz * Ry * Rx (three.js XYZ euler order convention)
  const r00 = cy * cz;
  const r01 = sx * sy * cz - cx * sz;
  const r02 = cx * sy * cz + sx * sz;
  const r10 = cy * sz;
  const r11 = sx * sy * sz + cx * cz;
  const r12 = cx * sy * sz - sx * cz;
  const r20 = -sy;
  const r21 = sx * cy;
  const r22 = cx * cy;
  const [sX, sY, sZ] = t.scale;
  return [
    r00 * sX,
    r10 * sX,
    r20 * sX,
    0,
    r01 * sY,
    r11 * sY,
    r21 * sY,
    0,
    r02 * sZ,
    r12 * sZ,
    r22 * sZ,
    0,
    t.position[0],
    t.position[1],
    t.position[2],
    1,
  ];
}
