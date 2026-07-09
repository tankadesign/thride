import type { PolygonMeshData } from "@/types/geometry/mesh";
import type { IcosphereParams } from "@/types/geometry/primitives";

const T = (1 + Math.sqrt(5)) / 2;

// canonical icosahedron, outward CCW winding
// biome-ignore format: vertex table
const ICO_POS = [
  -1,
  T,
  0,
  1,
  T,
  0,
  -1,
  -T,
  0,
  1,
  -T,
  0,
  0,
  -1,
  T,
  0,
  1,
  T,
  0,
  -1,
  -T,
  0,
  1,
  -T,
  T,
  0,
  -1,
  T,
  0,
  1,
  -T,
  0,
  -1,
  -T,
  0,
  1,
];
// biome-ignore format: face table
const ICO_FACES = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

export function buildIcosphere({ radius, subdivisions }: IcosphereParams): PolygonMeshData {
  const sub = Math.max(0, Math.min(4, Math.round(subdivisions)));
  let positions = [...ICO_POS];
  let faces = ICO_FACES.map((f) => [...f]);

  for (let s = 0; s < sub; s++) {
    const midCache = new Map<number, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      const cached = midCache.get(key);
      if (cached !== undefined) return cached;
      const i = positions.length / 3;
      positions.push(
        (positions[a * 3]! + positions[b * 3]!) / 2,
        (positions[a * 3 + 1]! + positions[b * 3 + 1]!) / 2,
        (positions[a * 3 + 2]! + positions[b * 3 + 2]!) / 2,
      );
      midCache.set(key, i);
      return i;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces as [number, number, number][]) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }

  // project onto the sphere
  for (let v = 0; v < positions.length / 3; v++) {
    const x = positions[v * 3]!;
    const y = positions[v * 3 + 1]!;
    const z = positions[v * 3 + 2]!;
    const s = radius / (Math.hypot(x, y, z) || 1);
    positions[v * 3] = x * s;
    positions[v * 3 + 1] = y * s;
    positions[v * 3 + 2] = z * s;
  }
  return { positions, faces };
}
