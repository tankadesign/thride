import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { adoptSoup, compactSoup, meshToSoup, type OpResult } from "./soup";

type Vec3 = [number, number, number];

/** Newell normal of a face loop over a positions array (need not be planar). */
function newell(loop: number[], pos: readonly number[], out: Vec3): void {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]! * 3;
    const b = loop[(i + 1) % loop.length]! * 3;
    out[0] += (pos[a + 1]! - pos[b + 1]!) * (pos[a + 2]! + pos[b + 2]!);
    out[1] += (pos[a + 2]! - pos[b + 2]!) * (pos[a]! + pos[b]!);
    out[2] += (pos[a]! - pos[b]!) * (pos[a + 1]! + pos[b + 1]!);
  }
}

/**
 * Vertex bevel (truncation): each selected vertex is replaced by a face
 * (its "cut"), with one new point per incident edge slid `width` along that
 * edge from the vertex. Every incident face swaps its corner at the vertex
 * for the two points of that corner's two edges (the points are SHARED with
 * the neighbouring faces — no gap strip, unlike edge bevel — so the result
 * stays manifold on convex corners). The cut face caps the hole in umbrella
 * order. Width is clamped per vertex to half the shortest incident edge so a
 * cut never overshoots its neighbours. Boundary/irregular fans (a vertex
 * whose incident faces don't close into a single ring) abort untouched.
 *
 * Records `lift` so the amount can be driven interactively (base = vertex,
 * dir = unit edge direction, max = the per-vertex clamp).
 */
export function bevelVertices(mesh: HEMesh, vertIds: number[], width: number): OpResult | null {
  const selected = new Set(vertIds.filter((v) => v >= 0 && v < mesh.vCount));
  if (selected.size === 0) return null;
  const soup = meshToSoup(mesh);
  const pos = soup.positions; // grows as bevel points are appended
  const origFaces = soup.faces.length;

  // per selected vertex: accumulated normal (cut winding) + shortest edge (clamp)
  const vnormal = new Map<number, Vec3>();
  const shortest = new Map<number, number>();
  for (const v of selected) {
    vnormal.set(v, [0, 0, 0]);
    shortest.set(v, Number.POSITIVE_INFINITY);
  }
  const dist = (a: number, b: number) =>
    Math.hypot(
      pos[a * 3]! - pos[b * 3]!,
      pos[a * 3 + 1]! - pos[b * 3 + 1]!,
      pos[a * 3 + 2]! - pos[b * 3 + 2]!,
    );
  const n: Vec3 = [0, 0, 0];
  for (let f = 0; f < origFaces; f++) {
    const loop = soup.faces[f]!;
    if (!loop.some((v) => selected.has(v))) continue;
    newell(loop, pos, n);
    for (let i = 0; i < loop.length; i++) {
      const v = loop[i]!;
      if (!selected.has(v)) continue;
      const vn = vnormal.get(v)!;
      vn[0] += n[0];
      vn[1] += n[1];
      vn[2] += n[2];
      const nx = loop[(i + 1) % loop.length]!;
      const pv = loop[(i - 1 + loop.length) % loop.length]!;
      shortest.set(v, Math.min(shortest.get(v)!, dist(v, nx), dist(v, pv)));
    }
  }

  const bp = new Map<string, number>(); // `${vert}:${neighbour}` → new soup index
  const lift = {
    verts: [] as number[],
    base: [] as number[],
    dirs: [] as number[],
    max: [] as number[],
  };
  const bevelPoint = (v: number, other: number): number => {
    const key = `${v}:${other}`;
    const existing = bp.get(key);
    if (existing !== undefined) return existing;
    const dx = pos[other * 3]! - pos[v * 3]!;
    const dy = pos[other * 3 + 1]! - pos[v * 3 + 1]!;
    const dz = pos[other * 3 + 2]! - pos[v * 3 + 2]!;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    const cap = 0.5 * (shortest.get(v) ?? len); // don't cross the edge midpoint
    const t = Math.min(width, cap);
    const idx = pos.length / 3;
    pos.push(pos[v * 3]! + ux * t, pos[v * 3 + 1]! + uy * t, pos[v * 3 + 2]! + uz * t);
    bp.set(key, idx);
    lift.verts.push(idx);
    lift.base.push(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
    lift.dirs.push(ux, uy, uz);
    lift.max.push(cap);
    return idx;
  };

  const faces: number[][] = [];
  const faceUVs: number[][] = [];
  // per selected vertex, the cut-face edges: each incident face contributes a
  // link between its corner's prev- and next-neighbour bevel points
  const links = new Map<number, [number, number][]>();
  for (const v of selected) links.set(v, []);

  for (let f = 0; f < origFaces; f++) {
    const loop = soup.faces[f]!;
    const uv = soup.faceUVs[f]!;
    const nl: number[] = [];
    const nu: number[] = [];
    for (let i = 0; i < loop.length; i++) {
      const v = loop[i]!;
      const u0 = uv[i * 2]!;
      const u1 = uv[i * 2 + 1]!;
      if (!selected.has(v)) {
        nl.push(v);
        nu.push(u0, u1);
        continue;
      }
      const prevV = loop[(i - 1 + loop.length) % loop.length]!;
      const nextV = loop[(i + 1) % loop.length]!;
      nl.push(bevelPoint(v, prevV), bevelPoint(v, nextV));
      nu.push(u0, u1, u0, u1);
      links.get(v)!.push([prevV, nextV]);
    }
    if (nl.length < 3) return null;
    faces.push(nl);
    faceUVs.push(nu);
  }

  // build each cut face by walking its neighbour cycle
  for (const v of selected) {
    const edges = links.get(v)!;
    if (edges.length < 3) return null; // boundary or degenerate valence
    const adj = new Map<number, number[]>();
    const link = (a: number, b: number) => {
      const list = adj.get(a);
      if (list) list.push(b);
      else adj.set(a, [b]);
    };
    for (const [a, b] of edges) {
      link(a, b);
      link(b, a);
    }
    for (const [, ns] of adj) if (ns.length !== 2) return null; // fan not a closed ring
    const start = edges[0]![0];
    const order: number[] = [];
    let prev = -1;
    let cur = start;
    do {
      order.push(cur);
      const ns = adj.get(cur)!;
      const nxt = ns[0] === prev ? ns[1]! : ns[0]!;
      prev = cur;
      cur = nxt;
    } while (cur !== start && order.length <= edges.length);
    if (order.length !== adj.size) return null; // more than one ring

    // winding: order the cut so its normal agrees with the vertex normal
    let cx = 0;
    let cy = 0;
    let cz = 0;
    const dir: Vec3[] = order.map((nbr) => {
      const dx = pos[nbr * 3]! - pos[v * 3]!;
      const dy = pos[nbr * 3 + 1]! - pos[v * 3 + 1]!;
      const dz = pos[nbr * 3 + 2]! - pos[v * 3 + 2]!;
      const l = Math.hypot(dx, dy, dz) || 1;
      return [dx / l, dy / l, dz / l];
    });
    for (let i = 0; i < dir.length; i++) {
      const a = dir[i]!;
      const b = dir[(i + 1) % dir.length]!;
      cx += (a[1] - b[1]) * (a[2] + b[2]);
      cy += (a[2] - b[2]) * (a[0] + b[0]);
      cz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const vn = vnormal.get(v)!;
    const ring = cx * vn[0] + cy * vn[1] + cz * vn[2] < 0 ? [...order].reverse() : order;
    faces.push(ring.map((nbr) => bevelPoint(v, nbr)));
    faceUVs.push(new Array(ring.length * 2).fill(0));
  }

  soup.faces = faces;
  soup.faceUVs = faceUVs;
  const map = compactSoup(soup);
  if (!adoptSoup(mesh, soup)) return null;
  const verts = lift.verts.map((idx) => map[idx]!);
  return {
    mode: "point",
    ids: verts,
    lift: {
      verts,
      base: new Float32Array(lift.base),
      dir: new Float32Array(lift.dirs),
      max: new Float32Array(lift.max),
    },
  };
}
