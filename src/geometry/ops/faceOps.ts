import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { adoptSoup, compactSoup, meshToSoup, type OpResult } from "./soup";

const WALL_UV = [0, 0, 1, 0, 1, 1, 0, 1];

/**
 * Region extrude (C4D semantics): vertices of the selected faces are
 * duplicated and pushed `offset` along the averaged selected-face normal;
 * wall quads grow only along the REGION boundary (interior edges between
 * two selected faces get no wall). Where the selection touches itself at
 * a single vertex (two disc fan triangles at the center), each contiguous
 * FAN SECTOR of selected faces gets its own duplicate — one shared dup
 * would emit duplicate wall edges (non-manifold). Caps stay selected so
 * the gizmo can drag them. Returns null (mesh untouched) on bad input.
 */
export function extrudeFaces(mesh: HEMesh, faceIds: number[], offset: number): OpResult | null {
  const selected = new Set(faceIds.filter((f) => f >= 0 && f < mesh.fCount));
  if (selected.size === 0) return null;
  const soup = meshToSoup(mesh);

  // per-vertex offset direction: average of adjacent selected-face normals
  const dir = new Float64Array(mesh.vCount * 3);
  const n: [number, number, number] = [0, 0, 0];
  for (const f of selected) {
    mesh.faceNormal(f, n);
    for (const v of mesh.faceVertices(f)) {
      dir[v * 3] = dir[v * 3]! + n[0];
      dir[v * 3 + 1] = dir[v * 3 + 1]! + n[1];
      dir[v * 3 + 2] = dir[v * 3 + 2]! + n[2];
    }
  }

  // sectorOf(v, f): connected component of f among the SELECTED faces
  // around v, linked only via shared selected interior edges incident to v
  const sectors = new Map<number, Map<number, number>>(); // vert → face → sector
  const sectorOf = (v: number, f: number): number => {
    let byFace = sectors.get(v);
    if (!byFace) {
      byFace = new Map();
      const touching: number[] = [];
      for (const sf of selected) if (mesh.faceVertices(sf).includes(v)) touching.push(sf);
      // union faces sharing a selected interior edge that touches v
      const parent = new Map<number, number>(touching.map((x) => [x, x]));
      const find = (x: number): number => {
        let r = x;
        while (parent.get(r) !== r) r = parent.get(r)!;
        return r;
      };
      for (const sf of touching) {
        for (const h of mesh.faceHalfEdges(sf)) {
          const t = mesh.heTwin[h]!;
          if (t === -1) continue;
          const other = mesh.heFace[t]!;
          if (!selected.has(other) || !parent.has(other)) continue;
          const a = mesh.heVert[h]!;
          const b = mesh.heVert[mesh.heNext[h]!]!;
          if (a !== v && b !== v) continue;
          parent.set(find(sf), find(other));
        }
      }
      for (const sf of touching) byFace.set(sf, find(sf));
      sectors.set(v, byFace);
    }
    return byFace.get(f)!;
  };

  const dup = new Map<string, number>(); // `${vert}:${sector}` → new vert id
  const lift = { verts: [] as number[], base: [] as number[], dirs: [] as number[] };
  const dupOf = (v: number, f: number): number => {
    const key = `${v}:${sectorOf(v, f)}`;
    let d = dup.get(key);
    if (d === undefined) {
      const len = Math.hypot(dir[v * 3]!, dir[v * 3 + 1]!, dir[v * 3 + 2]!) || 1;
      d = soup.positions.length / 3;
      soup.positions.push(
        soup.positions[v * 3]! + (dir[v * 3]! / len) * offset,
        soup.positions[v * 3 + 1]! + (dir[v * 3 + 1]! / len) * offset,
        soup.positions[v * 3 + 2]! + (dir[v * 3 + 2]! / len) * offset,
      );
      dup.set(key, d);
      lift.verts.push(d);
      lift.base.push(
        soup.positions[v * 3]!,
        soup.positions[v * 3 + 1]!,
        soup.positions[v * 3 + 2]!,
      );
      lift.dirs.push(dir[v * 3]! / len, dir[v * 3 + 1]! / len, dir[v * 3 + 2]! / len);
    }
    return d;
  };

  const faces: number[][] = [];
  const faceUVs: number[][] = [];
  for (let f = 0; f < mesh.fCount; f++) {
    if (selected.has(f)) continue;
    faces.push(soup.faces[f]!);
    faceUVs.push(soup.faceUVs[f]!);
  }
  // walls along the region boundary: supply a→b (twin of the unselected
  // neighbour's b→a) and b'→a' (twin of the lifted cap's a'→b')
  for (const f of selected) {
    for (const h of mesh.faceHalfEdges(f)) {
      const t = mesh.heTwin[h]!;
      if (t !== -1 && selected.has(mesh.heFace[t]!)) continue;
      const a = mesh.heVert[h]!;
      const b = mesh.heVert[mesh.heNext[h]!]!;
      faces.push([a, b, dupOf(b, f), dupOf(a, f)]);
      faceUVs.push(WALL_UV);
    }
  }
  const capStart = faces.length;
  for (const f of [...selected].sort((x, y) => x - y)) {
    const hs = mesh.faceHalfEdges(f);
    faces.push(hs.map((h) => dupOf(mesh.heVert[h]!, f)));
    faceUVs.push(soup.faceUVs[f]!);
  }
  soup.faces = faces;
  soup.faceUVs = faceUVs;
  if (!adoptSoup(mesh, soup)) return null;
  return {
    mode: "polygon",
    ids: [...Array(selected.size).keys()].map((i) => capStart + i),
    lift: {
      verts: lift.verts,
      base: new Float32Array(lift.base),
      dir: new Float32Array(lift.dirs),
      max: new Float32Array(lift.verts.length).fill(Number.POSITIVE_INFINITY),
    },
  };
}

/**
 * Per-face inset: each selected face is replaced by a smaller inner copy
 * (corners pulled toward the face centroid by `amount`, clamped so the
 * face can never invert) ringed by quads. Inner faces stay selected.
 */
export function insetFaces(mesh: HEMesh, faceIds: number[], amount: number): OpResult | null {
  const selected = new Set(faceIds.filter((f) => f >= 0 && f < mesh.fCount));
  if (selected.size === 0) return null;
  const soup = meshToSoup(mesh);

  const faces: number[][] = [];
  const faceUVs: number[][] = [];
  for (let f = 0; f < mesh.fCount; f++) {
    if (selected.has(f)) continue;
    faces.push(soup.faces[f]!);
    faceUVs.push(soup.faceUVs[f]!);
  }
  const inner: { loop: number[]; uv: number[] }[] = [];
  const lift = {
    verts: [] as number[],
    base: [] as number[],
    dirs: [] as number[],
    max: [] as number[],
  };
  for (const f of [...selected].sort((x, y) => x - y)) {
    const loop = soup.faces[f]!;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const v of loop) {
      cx += soup.positions[v * 3]!;
      cy += soup.positions[v * 3 + 1]!;
      cz += soup.positions[v * 3 + 2]!;
    }
    cx /= loop.length;
    cy /= loop.length;
    cz /= loop.length;
    const innerLoop = loop.map((v) => {
      const x = soup.positions[v * 3]!;
      const y = soup.positions[v * 3 + 1]!;
      const z = soup.positions[v * 3 + 2]!;
      const dist = Math.hypot(cx - x, cy - y, cz - z) || 1;
      const t = Math.min(0.45, amount / dist);
      const w = soup.positions.length / 3;
      soup.positions.push(x + (cx - x) * t, y + (cy - y) * t, z + (cz - z) * t);
      lift.verts.push(w);
      lift.base.push(x, y, z);
      lift.dirs.push((cx - x) / dist, (cy - y) / dist, (cz - z) / dist);
      lift.max.push(0.45 * dist);
      return w;
    });
    for (let i = 0; i < loop.length; i++) {
      const j = (i + 1) % loop.length;
      faces.push([loop[i]!, loop[j]!, innerLoop[j]!, innerLoop[i]!]);
      faceUVs.push(WALL_UV);
    }
    inner.push({ loop: innerLoop, uv: soup.faceUVs[f]! });
  }
  const innerStart = faces.length;
  for (const item of inner) {
    faces.push(item.loop);
    faceUVs.push(item.uv);
  }
  soup.faces = faces;
  soup.faceUVs = faceUVs;
  if (!adoptSoup(mesh, soup)) return null;
  return {
    mode: "polygon",
    ids: [...Array(inner.length).keys()].map((i) => innerStart + i),
    lift: {
      verts: lift.verts,
      base: new Float32Array(lift.base),
      dir: new Float32Array(lift.dirs),
      max: new Float32Array(lift.max),
    },
  };
}

/** Delete faces; orphaned vertices are compacted away. Selection clears. */
export function deleteFaces(mesh: HEMesh, faceIds: number[]): OpResult | null {
  const selected = new Set(faceIds.filter((f) => f >= 0 && f < mesh.fCount));
  if (selected.size === 0) return null;
  const soup = meshToSoup(mesh);
  const faces: number[][] = [];
  const faceUVs: number[][] = [];
  for (let f = 0; f < mesh.fCount; f++) {
    if (selected.has(f)) continue;
    faces.push(soup.faces[f]!);
    faceUVs.push(soup.faceUVs[f]!);
  }
  soup.faces = faces;
  soup.faceUVs = faceUVs;
  compactSoup(soup);
  if (soup.faces.length === 0) return null; // deleting everything = delete the node instead
  if (!adoptSoup(mesh, soup)) return null;
  return { mode: "polygon", ids: [] };
}
