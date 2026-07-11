import type { PolygonMeshData } from "@/types/geometry/mesh";
import { DIRTY_ALL, DIRTY_NORMALS, DIRTY_POSITIONS } from "@/types/geometry/mesh";

/**
 * Array-based half-edge mesh (struct-of-arrays on typed arrays).
 *
 * Conventions:
 * - heVert[h] is the ORIGIN vertex of halfedge h; heNext cycles CCW around
 *   the face; heTwin[h] === -1 on boundary edges (no boundary loops stored).
 * - Indices are the handles. No stable-id indirection: undo restores exact
 *   indices via snapshots. topologyVersion bumps on any connectivity change.
 * - Editing ops (extrude/inset/bevel…) arrive in chunk D4; M0 needs
 *   construction, accessors, normals, snapshots.
 */
export class HEMesh {
  // per half-edge
  heNext!: Int32Array;
  heTwin!: Int32Array;
  heVert!: Int32Array;
  heFace!: Int32Array;
  heUV!: Float32Array; // 2 floats per halfedge (per-corner UVs — seams for free)
  // per vertex
  vPos!: Float32Array; // 3 floats
  vHE!: Int32Array; // one outgoing halfedge (-1 if isolated)
  // per face
  fHE!: Int32Array; // any halfedge of the face loop

  vCount = 0;
  heCount = 0;
  fCount = 0;
  topologyVersion = 0;
  dirty = 0;

  private constructor() {}

  /**
   * Build from polygon soup. Throws on non-manifold input (duplicate
   * directed edge = two faces sharing an edge with the same winding).
   */
  static fromPolygons(data: PolygonMeshData): HEMesh {
    const m = new HEMesh();
    const positions = data.positions;
    m.vCount = positions.length / 3;
    m.vPos = new Float32Array(positions);
    m.vHE = new Int32Array(m.vCount).fill(-1);

    m.fCount = data.faces.length;
    m.fHE = new Int32Array(m.fCount);
    let heTotal = 0;
    for (const f of data.faces) {
      if (f.length < 3) throw new Error("HEMesh: face with fewer than 3 vertices");
      heTotal += f.length;
    }
    m.heCount = heTotal;
    m.heNext = new Int32Array(heTotal);
    m.heTwin = new Int32Array(heTotal).fill(-1);
    m.heVert = new Int32Array(heTotal);
    m.heFace = new Int32Array(heTotal);
    m.heUV = new Float32Array(heTotal * 2);

    // directed-edge map for twin linking: key = a * vCount + b
    const edgeMap = new Map<number, number>();
    let h = 0;
    for (let f = 0; f < m.fCount; f++) {
      const loop = data.faces[f]!;
      const uvs = data.faceUVs?.[f];
      const n = loop.length;
      m.fHE[f] = h;
      for (let i = 0; i < n; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % n]!;
        if (a === b || a < 0 || b < 0 || a >= m.vCount || b >= m.vCount) {
          throw new Error(`HEMesh: bad face loop (face ${f})`);
        }
        const he = h + i;
        m.heVert[he] = a;
        m.heFace[he] = f;
        m.heNext[he] = h + ((i + 1) % n);
        m.vHE[a] = he;
        if (uvs) {
          m.heUV[he * 2] = uvs[i * 2] ?? 0;
          m.heUV[he * 2 + 1] = uvs[i * 2 + 1] ?? 0;
        }
        const key = a * m.vCount + b;
        if (edgeMap.has(key)) throw new Error(`HEMesh: non-manifold edge ${a}->${b}`);
        edgeMap.set(key, he);
        const twinKey = b * m.vCount + a;
        const twin = edgeMap.get(twinKey);
        if (twin !== undefined) {
          if (m.heTwin[twin] !== -1) throw new Error(`HEMesh: non-manifold edge ${a}-${b}`);
          m.heTwin[he] = twin;
          m.heTwin[twin] = he;
        }
      }
      h += n;
    }
    m.dirty = DIRTY_ALL;
    return m;
  }

  // ---- accessors -------------------------------------------------------

  /** Vertex indices of face f, in loop order. */
  faceVertices(f: number): number[] {
    const out: number[] = [];
    const start = this.fHE[f]!;
    let h = start;
    do {
      out.push(this.heVert[h]!);
      h = this.heNext[h]!;
    } while (h !== start);
    return out;
  }

  /** Halfedge handles of face f, in loop order. */
  faceHalfEdges(f: number): number[] {
    const out: number[] = [];
    const start = this.fHE[f]!;
    let h = start;
    do {
      out.push(h);
      h = this.heNext[h]!;
    } while (h !== start);
    return out;
  }

  faceSize(f: number): number {
    let n = 0;
    const start = this.fHE[f]!;
    let h = start;
    do {
      n++;
      h = this.heNext[h]!;
    } while (h !== start);
    return n;
  }

  getPosition(v: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    out[0] = this.vPos[v * 3]!;
    out[1] = this.vPos[v * 3 + 1]!;
    out[2] = this.vPos[v * 3 + 2]!;
    return out;
  }

  setPosition(v: number, x: number, y: number, z: number): void {
    this.vPos[v * 3] = x;
    this.vPos[v * 3 + 1] = y;
    this.vPos[v * 3 + 2] = z;
    this.dirty |= DIRTY_POSITIONS | DIRTY_NORMALS;
  }

  /** Undirected edge count (twinned pairs count once, boundaries once). */
  get edgeCount(): number {
    let boundary = 0;
    for (let h = 0; h < this.heCount; h++) if (this.heTwin[h] === -1) boundary++;
    return (this.heCount - boundary) / 2 + boundary;
  }

  /** Face normal via Newell's method (robust for non-planar n-gons). */
  faceNormal(f: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const start = this.fHE[f]!;
    let h = start;
    do {
      const a = this.heVert[h]!;
      const b = this.heVert[this.heNext[h]!]!;
      const ax = this.vPos[a * 3]!;
      const ay = this.vPos[a * 3 + 1]!;
      const az = this.vPos[a * 3 + 2]!;
      const bx = this.vPos[b * 3]!;
      const by = this.vPos[b * 3 + 1]!;
      const bz = this.vPos[b * 3 + 2]!;
      nx += (ay - by) * (az + bz);
      ny += (az - bz) * (ax + bx);
      nz += (ax - bx) * (ay + by);
      h = this.heNext[h]!;
    } while (h !== start);
    const len = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / len;
    out[1] = ny / len;
    out[2] = nz / len;
    return out;
  }

  /** Area-weighted smooth vertex normals (Float32Array, 3 per vertex). */
  computeVertexNormals(): Float32Array {
    const normals = new Float32Array(this.vCount * 3);
    const fn: [number, number, number] = [0, 0, 0];
    for (let f = 0; f < this.fCount; f++) {
      // Newell normal is area-weighted before normalization; recompute raw
      let nx = 0;
      let ny = 0;
      let nz = 0;
      const start = this.fHE[f]!;
      let h = start;
      do {
        const a = this.heVert[h]!;
        const b = this.heVert[this.heNext[h]!]!;
        nx +=
          (this.vPos[a * 3 + 1]! - this.vPos[b * 3 + 1]!) *
          (this.vPos[a * 3 + 2]! + this.vPos[b * 3 + 2]!);
        ny +=
          (this.vPos[a * 3 + 2]! - this.vPos[b * 3 + 2]!) * (this.vPos[a * 3]! + this.vPos[b * 3]!);
        nz +=
          (this.vPos[a * 3]! - this.vPos[b * 3]!) * (this.vPos[a * 3 + 1]! + this.vPos[b * 3 + 1]!);
        h = this.heNext[h]!;
      } while (h !== start);
      fn[0] = nx;
      fn[1] = ny;
      fn[2] = nz;
      h = start;
      do {
        const i = this.heVert[h]! * 3;
        normals[i] = normals[i]! + fn[0];
        normals[i + 1] = normals[i + 1]! + fn[1];
        normals[i + 2] = normals[i + 2]! + fn[2];
        h = this.heNext[h]!;
      } while (h !== start);
    }
    for (let v = 0; v < this.vCount; v++) {
      const i = v * 3;
      const len = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1;
      normals[i] = normals[i]! / len;
      normals[i + 1] = normals[i + 1]! / len;
      normals[i + 2] = normals[i + 2]! / len;
    }
    return normals;
  }

  /**
   * Per-CORNER (half-edge) normals with crease-angle auto-smoothing: each
   * corner averages only the faces around its vertex whose normal is within
   * `creaseDeg` of the corner's own face. Sharp edges (cube 90°) stay flat;
   * shallow ones (sphere/cylinder segments) smooth. This is also the CORRECT
   * normal for shadow `normalBias` — a per-vertex-averaged cube normal points
   * diagonally and can't offset self-shadow acne off the flat faces.
   * Returned as one xyz per half-edge (index by the triangulation's corner).
   */
  computeCornerNormals(creaseDeg = 50): Float32Array {
    const cosThresh = Math.cos((creaseDeg * Math.PI) / 180);
    const fnRaw = new Float32Array(this.fCount * 3); // area-weighted (Newell)
    const fnUnit = new Float32Array(this.fCount * 3); // normalized
    for (let f = 0; f < this.fCount; f++) {
      let nx = 0;
      let ny = 0;
      let nz = 0;
      const s = this.fHE[f]!;
      let h = s;
      do {
        const a = this.heVert[h]!;
        const b = this.heVert[this.heNext[h]!]!;
        nx +=
          (this.vPos[a * 3 + 1]! - this.vPos[b * 3 + 1]!) *
          (this.vPos[a * 3 + 2]! + this.vPos[b * 3 + 2]!);
        ny +=
          (this.vPos[a * 3 + 2]! - this.vPos[b * 3 + 2]!) * (this.vPos[a * 3]! + this.vPos[b * 3]!);
        nz +=
          (this.vPos[a * 3]! - this.vPos[b * 3]!) * (this.vPos[a * 3 + 1]! + this.vPos[b * 3 + 1]!);
        h = this.heNext[h]!;
      } while (h !== s);
      fnRaw[f * 3] = nx;
      fnRaw[f * 3 + 1] = ny;
      fnRaw[f * 3 + 2] = nz;
      const len = Math.hypot(nx, ny, nz) || 1;
      fnUnit[f * 3] = nx / len;
      fnUnit[f * 3 + 1] = ny / len;
      fnUnit[f * 3 + 2] = nz / len;
    }
    // vertex → the half-edges originating there (one per adjacent face)
    const byVert: number[][] = Array.from({ length: this.vCount }, () => []);
    for (let h = 0; h < this.heCount; h++) byVert[this.heVert[h]!]!.push(h);
    const out = new Float32Array(this.heCount * 3);
    for (let h = 0; h < this.heCount; h++) {
      const f = this.heFace[h]!;
      const fx = fnUnit[f * 3]!;
      const fy = fnUnit[f * 3 + 1]!;
      const fz = fnUnit[f * 3 + 2]!;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (const h2 of byVert[this.heVert[h]!]!) {
        const g = this.heFace[h2]!;
        if (fx * fnUnit[g * 3]! + fy * fnUnit[g * 3 + 1]! + fz * fnUnit[g * 3 + 2]! >= cosThresh) {
          nx += fnRaw[g * 3]!;
          ny += fnRaw[g * 3 + 1]!;
          nz += fnRaw[g * 3 + 2]!;
        }
      }
      const len = Math.hypot(nx, ny, nz) || 1;
      out[h * 3] = nx / len;
      out[h * 3 + 1] = ny / len;
      out[h * 3 + 2] = nz / len;
    }
    return out;
  }

  clearDirty(): void {
    this.dirty = 0;
  }

  // ---- snapshots (undo) --------------------------------------------------

  snapshot(): HEMeshSnapshot {
    return {
      heNext: this.heNext.slice(),
      heTwin: this.heTwin.slice(),
      heVert: this.heVert.slice(),
      heFace: this.heFace.slice(),
      heUV: this.heUV.slice(),
      vPos: this.vPos.slice(),
      vHE: this.vHE.slice(),
      fHE: this.fHE.slice(),
      vCount: this.vCount,
      heCount: this.heCount,
      fCount: this.fCount,
    };
  }

  /** Construct a fresh mesh from a snapshot (deep copies — used by duplicate). */
  static fromSnapshot(s: HEMeshSnapshot): HEMesh {
    const m = new HEMesh();
    m.restore(s);
    return m;
  }

  restore(s: HEMeshSnapshot): void {
    this.heNext = s.heNext.slice();
    this.heTwin = s.heTwin.slice();
    this.heVert = s.heVert.slice();
    this.heFace = s.heFace.slice();
    this.heUV = s.heUV.slice();
    this.vPos = s.vPos.slice();
    this.vHE = s.vHE.slice();
    this.fHE = s.fHE.slice();
    this.vCount = s.vCount;
    this.heCount = s.heCount;
    this.fCount = s.fCount;
    this.topologyVersion++;
    this.dirty = DIRTY_ALL;
  }
}

export interface HEMeshSnapshot {
  heNext: Int32Array;
  heTwin: Int32Array;
  heVert: Int32Array;
  heFace: Int32Array;
  heUV: Float32Array;
  vPos: Float32Array;
  vHE: Int32Array;
  fHE: Int32Array;
  vCount: number;
  heCount: number;
  fCount: number;
}

/** Approximate retained bytes of a snapshot (history memoryCost). */
export function snapshotBytes(s: HEMeshSnapshot): number {
  return (
    s.heNext.byteLength +
    s.heTwin.byteLength +
    s.heVert.byteLength +
    s.heFace.byteLength +
    s.heUV.byteLength +
    s.vPos.byteLength +
    s.vHE.byteLength +
    s.fHE.byteLength
  );
}
