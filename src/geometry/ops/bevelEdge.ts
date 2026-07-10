import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { canonicalEdge } from "@/geometry/kernel/components";
import { adoptSoup, type OpResult } from "./soup";

type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export type BevelMode = "chamfer" | "straight";

export interface BevelEdgeOpts {
  width: number;
  /**
   * Skip edges whose dihedral (deviation between the two adjacent face
   * normals, 0° = coplanar) is below this — so flat surface edges are left
   * alone. Default 0 (bevel every selected edge).
   */
  angleDeg?: number;
  /** Ring subdivisions across the bevel (1 = a flat chamfer). Default 1. */
  segments?: number;
  /** chamfer replaces the selected edge; straight keeps it. Default chamfer. */
  mode?: BevelMode;
}

/**
 * Edge bevel (chamfer), 1 segment. Each selected edge is replaced by a quad
 * strip and the faces on either side recede. The receded corner of every face
 * is found by **planar offset-intersect**: in the face's plane, each selected
 * boundary edge's line is offset inward by `width`, non-selected edges stay
 * put, and the new corner is the intersection of a corner's two (offset-or-
 * original) edge lines. Points that land on the same spot (a non-beveled edge
 * shared by two faces on a symmetric solid) are welded, so the shared edge
 * stays a single edge; the leftover vertex holes are filled by cap faces.
 *
 * Scoped to interior edges on planar convex faces (cube / cylinder — the M1
 * acceptance bar). Anything else — a boundary edge, a non-planar or concave
 * face, a degenerate corner, or a junction that can't be capped into a simple
 * loop — aborts with the mesh untouched (adoptSoup / explicit guards).
 *
 * Records `lift` (base = original vertex, dir = corner travel per unit width,
 * a single shared clamp) so width can be driven by the interactive modal.
 */
export function bevelEdges(mesh: HEMesh, edgeIds: number[], opts: BevelEdgeOpts): OpResult | null {
  const { width } = opts;
  const angleDeg = opts.angleDeg ?? 0;
  const pos = (v: number): Vec3 => [
    mesh.vPos[v * 3]!,
    mesh.vPos[v * 3 + 1]!,
    mesh.vPos[v * 3 + 2]!,
  ];

  const sel = new Set<number>();
  for (const h of edgeIds) {
    if (h >= 0 && h < mesh.heCount) sel.add(canonicalEdge(mesh, h));
  }
  if (sel.size === 0) return null;
  for (const e of sel) if (mesh.heTwin[e] === -1) return null; // boundary edge: abort

  // angle threshold: drop edges flatter than angleDeg (deviation between the
  // two adjacent face normals). This lets "bevel everything" on a panel skip
  // the flat grid edges and only chamfer the sharp feature edges.
  if (angleDeg > 0) {
    const cos = Math.cos((angleDeg * Math.PI) / 180);
    const n1: Vec3 = [0, 0, 0];
    const n2: Vec3 = [0, 0, 0];
    for (const e of [...sel]) {
      mesh.faceNormal(mesh.heFace[e]!, n1);
      mesh.faceNormal(mesh.heFace[mesh.heTwin[e]!]!, n2);
      if (dot(norm(n1), norm(n2)) > cos) sel.delete(e); // deviation < threshold → flat
    }
    if (sel.size === 0) return null;
  }

  const selected = (h: number) => sel.has(canonicalEdge(mesh, h));

  // shortest incident edge over all endpoints of selected edges → shared clamp
  let clamp = Number.POSITIVE_INFINITY;
  for (const e of sel) {
    for (const v of [mesh.heVert[e]!, mesh.heVert[mesh.heNext[e]!]!]) {
      for (let h = 0; h < mesh.heCount; h++) {
        if (mesh.heVert[h] === v) {
          const w = mesh.heVert[mesh.heNext[h]!]!;
          clamp = Math.min(clamp, Math.hypot(...(sub(pos(w), pos(v)) as Vec3)));
        }
      }
    }
  }
  const maxWidth = 0.5 * (Number.isFinite(clamp) ? clamp : 1);
  const w = Math.min(width, maxWidth);

  // --- per-corner offset-intersect point (one per half-edge, keyed by the
  // OUTGOING half-edge at that corner) ------------------------------------
  const cornerPos = new Map<number, Vec3>(); // he → 3D point
  const cornerBase = new Map<number, number>(); // he → owning vertex (for lift)
  for (let f = 0; f < mesh.fCount; f++) {
    const loop = mesh.faceHalfEdges(f);
    const n: Vec3 = [0, 0, 0];
    mesh.faceNormal(f, n);
    const N = norm(n);
    for (let i = 0; i < loop.length; i++) {
      const h = loop[i]!; // outgoing at V
      const hPrev = loop[(i - 1 + loop.length) % loop.length]!; // incoming at V
      const V = mesh.heVert[h]!;
      const Wn = mesh.heVert[mesh.heNext[h]!]!;
      const U = mesh.heVert[hPrev]!;
      const Pv = pos(V);
      const selOut = selected(h);
      const selIn = selected(hPrev);
      cornerBase.set(h, V);
      if (!selOut && !selIn) {
        cornerPos.set(h, Pv);
        continue;
      }
      const dirOut = norm(sub(pos(Wn), Pv));
      const dirIn = norm(sub(Pv, pos(U)));
      const inwardOut = norm(cross(N, dirOut));
      const inwardIn = norm(cross(N, dirIn));
      const offOut: Vec3 = selOut
        ? [inwardOut[0] * w, inwardOut[1] * w, inwardOut[2] * w]
        : [0, 0, 0];
      const offIn: Vec3 = selIn ? [inwardIn[0] * w, inwardIn[1] * w, inwardIn[2] * w] : [0, 0, 0];
      // 2D solve in (u = dirOut, vv = N × dirOut) with origin Pv
      const u = dirOut;
      const vv = norm(cross(N, dirOut));
      const a0 = [dot(offOut, u), dot(offOut, vv)];
      const b0 = [dot(offIn, u), dot(offIn, vv)];
      const dIn2 = [dot(dirIn, u), dot(dirIn, vv)];
      if (Math.abs(dIn2[1]!) < 1e-9) return null; // collinear corner — abort
      const t = (a0[1]! - b0[1]!) / dIn2[1]!;
      const px = b0[0]! + t * dIn2[0]!;
      const py = b0[1]! + t * dIn2[1]!;
      cornerPos.set(h, [
        Pv[0] + px * u[0] + py * vv[0],
        Pv[1] + px * u[1] + py * vv[1],
        Pv[2] + px * u[2] + py * vv[2],
      ]);
    }
  }

  // --- weld coincident corner points → soup vertices ----------------------
  const eps = Math.max(1e-6, 1e-4 * (Number.isFinite(clamp) ? clamp : 1));
  const q = (n: number) => Math.round(n / eps);
  const weldKey = new Map<string, number>();
  const positions: number[] = [];
  const lift = { verts: [] as number[], base: [] as number[], dirs: [] as number[] };
  const indexOfHE = new Map<number, number>();
  for (const [h, p] of cornerPos) {
    const key = `${q(p[0])},${q(p[1])},${q(p[2])}`;
    let idx = weldKey.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      positions.push(p[0], p[1], p[2]);
      weldKey.set(key, idx);
      const V = cornerBase.get(h)!;
      const bv = pos(V);
      lift.verts.push(idx);
      lift.base.push(bv[0], bv[1], bv[2]);
      lift.dirs.push((p[0] - bv[0]) / w, (p[1] - bv[1]) / w, (p[2] - bv[2]) / w);
    }
    indexOfHE.set(h, idx);
  }

  // --- shrunk faces (dedup consecutive) -----------------------------------
  const faces: number[][] = [];
  const faceUVs: number[][] = [];
  for (let f = 0; f < mesh.fCount; f++) {
    const loop = mesh.faceHalfEdges(f);
    const nl: number[] = [];
    const nu: number[] = [];
    for (const h of loop) {
      const idx = indexOfHE.get(h)!;
      if (nl.length > 0 && nl[nl.length - 1] === idx) continue;
      nl.push(idx);
      nu.push(mesh.heUV[h * 2]!, mesh.heUV[h * 2 + 1]!);
    }
    while (nl.length > 1 && nl[0] === nl[nl.length - 1]) {
      nl.pop();
      nu.pop();
      nu.pop();
    }
    if (nl.length >= 3) {
      faces.push(nl);
      faceUVs.push(nu);
    }
  }

  // --- strips: one quad per selected edge ---------------------------------
  // for edge e (half-edges e / twin), the outgoing-at-V corner on each side
  for (const e of sel) {
    const tw = mesh.heTwin[e]!;
    // e goes V→W in face F1; tw goes W→V in face F2
    const eNext = mesh.heNext[e]!;
    const twNext = mesh.heNext[tw]!;
    const f1V = indexOfHE.get(e)!; // corner at V on F1 (F1 has edge f1V→f1W)
    const f1W = indexOfHE.get(eNext)!; // corner at W on F1
    const f2W = indexOfHE.get(tw)!; // corner at W on F2 (F2 has edge f2W→f2V)
    const f2V = indexOfHE.get(twNext)!; // corner at V on F2
    // wind the strip so it twins both shrunk faces' shared edges (opposite dir)
    const quad = [f1W, f1V, f2V, f2W];
    if (new Set(quad).size === 4) {
      faces.push(quad);
      faceUVs.push([0, 0, 1, 0, 1, 1, 0, 1]);
    }
  }

  // pre-existing mesh boundaries (open meshes like a plane) must stay open —
  // only the NEW vertex holes the bevel opened get capped
  const keepOpen = new Set<number>();
  const BIG = 1 << 26;
  for (let h = 0; h < mesh.heCount; h++) {
    if (mesh.heTwin[h] !== -1) continue;
    const a = indexOfHE.get(h);
    const b = indexOfHE.get(mesh.heNext[h]!);
    if (a !== undefined && b !== undefined && a !== b) keepOpen.add(a * BIG + b);
  }

  // --- fill vertex holes: any boundary loop left after strips + faces ------
  if (!fillHoles(faces, faceUVs, keepOpen)) return null;

  const soup = { positions, faces, faceUVs };
  if (!adoptSoup(mesh, soup)) return null;
  return {
    mode: "edge",
    ids: [], // edge ids are unstable post-rebuild; leave selection cleared
    lift: {
      verts: lift.verts,
      base: new Float32Array(lift.base),
      dir: new Float32Array(lift.dirs),
      max: new Float32Array(lift.verts.length).fill(maxWidth),
    },
  };
}

/**
 * Close every open boundary of the soup with a single cap face. A directed
 * edge with no opposite twin is a hole edge; chain them into loops and add the
 * reversed loop as a face. Returns false if a hole can't be closed into a
 * simple loop (non-manifold junction → the whole op aborts).
 */
function fillHoles(faces: number[][], faceUVs: number[][], keepOpen: Set<number>): boolean {
  const BIG = 1 << 26;
  const key = (a: number, b: number) => a * BIG + b;
  const dirEdges = new Set<number>();
  for (const loop of faces) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      dirEdges.add(key(a, b));
    }
  }
  // boundary edge a→b : no opposite b→a, excluding pre-existing open boundaries
  const boundary = new Map<number, number>(); // a → b
  for (const loop of faces) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      if (keepOpen.has(key(a, b))) continue; // original mesh boundary — leave open
      if (!dirEdges.has(key(b, a))) {
        if (boundary.has(a)) return false; // fan-out: not a simple boundary
        boundary.set(a, b);
      }
    }
  }
  const visited = new Set<number>();
  for (const [start] of boundary) {
    if (visited.has(start)) continue;
    const loop: number[] = [];
    let cur = start;
    let guard = 0;
    while (!visited.has(cur)) {
      visited.add(cur);
      loop.push(cur);
      const nxt = boundary.get(cur);
      if (nxt === undefined) return false;
      cur = nxt;
      if (++guard > boundary.size + 1) return false;
    }
    if (cur !== start || loop.length < 3) return false;
    // cap fills the hole → reverse of the boundary traversal
    const cap = [...loop].reverse();
    faces.push(cap);
    faceUVs.push(new Array(cap.length * 2).fill(0));
  }
  return true;
}
