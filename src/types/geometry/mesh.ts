/** Raw polygon soup used to construct a half-edge mesh. */
export interface PolygonMeshData {
  /** xyz triplets. */
  positions: number[] | Float32Array;
  /** Vertex-index loops, CCW when viewed from outside. N-gons allowed. */
  faces: number[][];
  /** Optional per-face-corner UVs, parallel to `faces` (uv pairs per corner). */
  faceUVs?: number[][];
}

/** Kernel dirty flags — drive partial vs full render-sync updates. */
export const DIRTY_POSITIONS = 1;
export const DIRTY_TOPOLOGY = 2;
export const DIRTY_UVS = 4;
export const DIRTY_NORMALS = 8;
export const DIRTY_ALL = DIRTY_POSITIONS | DIRTY_TOPOLOGY | DIRTY_UVS | DIRTY_NORMALS;
