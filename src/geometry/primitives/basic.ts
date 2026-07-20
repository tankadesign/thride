import type { PolygonMeshData } from "@/types/geometry/mesh";
import type {
  CubeParams,
  DiscParams,
  PlaneParams,
  PyramidParams,
} from "@/types/geometry/primitives";

/**
 * Winding convention (whole module): faces are CCW viewed from OUTSIDE.
 * Ring loops built with P(φ)=(r·cosφ, y, r·sinφ) read clockwise from +Y,
 * so top-facing caps reverse the ring order and bottom caps keep it.
 */

export function buildCube({
  width: w,
  height: h,
  depth: d,
  segmentsW,
  segmentsH,
  segmentsD,
}: CubeParams): PolygonMeshData {
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  const sw = Math.max(1, Math.round(segmentsW ?? 1));
  const sh = Math.max(1, Math.round(segmentsH ?? 1));
  const sd = Math.max(1, Math.round(segmentsD ?? 1));
  // fast path: a plain box keeps the exact 8-vertex manifold (welded corners)
  if (sw === 1 && sh === 1 && sd === 1) {
    // biome-ignore format: vertex table
    const positions = [
      -x,
      -y,
      -z,
      x,
      -y,
      -z,
      x,
      y,
      -z,
      -x,
      y,
      -z,
      -x,
      -y,
      z,
      x,
      -y,
      z,
      x,
      y,
      z,
      -x,
      y,
      z,
    ];
    const faces = [
      [4, 5, 6, 7], // +z
      [1, 0, 3, 2], // -z
      [5, 1, 2, 6], // +x
      [0, 4, 7, 3], // -x
      [7, 6, 2, 3], // +y
      [0, 1, 5, 4], // -y
    ];
    const quadUV = [0, 0, 1, 0, 1, 1, 0, 1];
    return { positions, faces, faceUVs: faces.map(() => quadUV) };
  }
  // segmented: each face is a grid; vertices are welded by position so shared
  // edges/corners are one vertex (a clean manifold, editable). Each face's
  // (du × dv) points outward, so the quad order below is CCW from outside.
  const positions: number[] = [];
  const index = new Map<string, number>();
  const vert = (a: number, b: number, c: number): number => {
    const k = `${Math.round(a * 1e5)}_${Math.round(b * 1e5)}_${Math.round(c * 1e5)}`;
    let i = index.get(k);
    if (i === undefined) {
      i = positions.length / 3;
      positions.push(a, b, c);
      index.set(k, i);
    }
    return i;
  };
  const faces: number[][] = [];
  const faceUVs: number[][] = [];
  type V3 = [number, number, number];
  const face = (o: V3, du: V3, dv: V3, su: number, sv: number): void => {
    const at = (i: number, j: number): number =>
      vert(
        o[0] + (i / su) * du[0] + (j / sv) * dv[0],
        o[1] + (i / su) * du[1] + (j / sv) * dv[1],
        o[2] + (i / su) * du[2] + (j / sv) * dv[2],
      );
    for (let j = 0; j < sv; j++) {
      for (let i = 0; i < su; i++) {
        faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
        const u0 = i / su;
        const u1 = (i + 1) / su;
        const w0 = j / sv;
        const w1 = (j + 1) / sv;
        faceUVs.push([u0, w0, u1, w0, u1, w1, u0, w1]);
      }
    }
  };
  face([-x, -y, z], [w, 0, 0], [0, h, 0], sw, sh); // +z
  face([x, -y, -z], [-w, 0, 0], [0, h, 0], sw, sh); // -z
  face([x, -y, z], [0, 0, -d], [0, h, 0], sd, sh); // +x
  face([-x, -y, -z], [0, 0, d], [0, h, 0], sd, sh); // -x
  face([-x, y, z], [w, 0, 0], [0, 0, -d], sw, sd); // +y
  face([-x, -y, -z], [w, 0, 0], [0, 0, d], sw, sd); // -y
  return { positions, faces, faceUVs };
}

export function buildPlane({ width, depth, segmentsX, segmentsZ }: PlaneParams): PolygonMeshData {
  const sx = Math.max(1, Math.round(segmentsX));
  const sz = Math.max(1, Math.round(segmentsZ));
  const positions: number[] = [];
  for (let j = 0; j <= sz; j++) {
    for (let i = 0; i <= sx; i++) {
      positions.push((i / sx - 0.5) * width, 0, (j / sz - 0.5) * depth);
    }
  }
  const v = (i: number, j: number) => j * (sx + 1) + i;
  const faces: number[][] = [];
  const faceUVs: number[][] = [];
  for (let j = 0; j < sz; j++) {
    for (let i = 0; i < sx; i++) {
      faces.push([v(i, j), v(i, j + 1), v(i + 1, j + 1), v(i + 1, j)]);
      const u0 = i / sx;
      const u1 = (i + 1) / sx;
      const w0 = 1 - j / sz;
      const w1 = 1 - (j + 1) / sz;
      faceUVs.push([u0, w0, u0, w1, u1, w1, u1, w0]);
    }
  }
  return { positions, faces, faceUVs };
}

export function buildDisc({ radius, segments, rings }: DiscParams): PolygonMeshData {
  const n = Math.max(3, Math.round(segments));
  const R = Math.max(1, Math.round(rings ?? 1)); // pre-rings discs load as 1
  // center vertex + R concentric rings of n vertices; innermost ring fans
  // to the center as triangles, ring→ring bands are quads
  const positions: number[] = [0, 0, 0];
  const cos: number[] = [];
  const sin: number[] = [];
  for (let k = 0; k < n; k++) {
    const phi = (-k / n) * Math.PI * 2; // reversed φ: CCW from +Y (see module note)
    cos.push(Math.cos(phi));
    sin.push(Math.sin(phi));
  }
  for (let r = 1; r <= R; r++) {
    const rad = (radius * r) / R;
    for (let k = 0; k < n; k++) positions.push(rad * cos[k]!, 0, rad * sin[k]!);
  }
  const v = (r: number, k: number) => 1 + (r - 1) * n + (k % n);
  const uvOf = (r: number, k: number): [number, number] => {
    if (r === 0) return [0.5, 0.5];
    const t = r / R / 2;
    return [0.5 + cos[k % n]! * t, 0.5 - sin[k % n]! * t];
  };

  const faces: number[][] = [];
  const faceUVs: number[][] = [];
  for (let k = 0; k < n; k++) {
    // fan triangle: center → ring-1 edge k→k+1 keeps the +Y-facing winding
    faces.push([0, v(1, k), v(1, k + 1)]);
    faceUVs.push([...uvOf(0, 0), ...uvOf(1, k), ...uvOf(1, k + 1)]);
  }
  for (let r = 1; r < R; r++) {
    for (let k = 0; k < n; k++) {
      // band quad traverses the inner ring k+1→k (antiparallel to the face
      // inside it) so shared edges twin up and the normal stays +Y
      faces.push([v(r, k + 1), v(r, k), v(r + 1, k), v(r + 1, k + 1)]);
      faceUVs.push([...uvOf(r, k + 1), ...uvOf(r, k), ...uvOf(r + 1, k), ...uvOf(r + 1, k + 1)]);
    }
  }
  return { positions, faces, faceUVs };
}

export function buildPyramid({ width, height, depth }: PyramidParams): PolygonMeshData {
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const positions = [-x, -y, -z, x, -y, -z, x, -y, z, -x, -y, z, 0, y, 0];
  const A = 0;
  const B = 1;
  const C = 2;
  const D = 3;
  const APEX = 4;
  // base loop [A,B,C,D] faces -Y; sides are [next, cur, apex] per base edge
  const faces = [
    [A, B, C, D],
    [B, A, APEX],
    [C, B, APEX],
    [D, C, APEX],
    [A, D, APEX],
  ];
  const triUV = [0, 0, 1, 0, 0.5, 1];
  const faceUVs = [[0, 0, 1, 0, 1, 1, 0, 1], triUV, triUV, triUV, triUV];
  return { positions, faces, faceUVs };
}
