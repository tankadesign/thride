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
/** Spherical interpolation between two unit vectors (rounded-bevel arc). */
const slerp = (a: Vec3, b: Vec3, t: number): Vec3 => {
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  const omega = Math.acos(d);
  if (omega < 1e-5) return a;
  const s = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / s;
  const wb = Math.sin(t * omega) / s;
  return norm([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]);
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
 * Edge bevel. Each selected edge's two faces RECEDE (via **planar
 * offset-intersect**: in each face plane, a selected boundary edge's line is
 * offset inward by `width`, non-selected edges stay, and the new corner is the
 * intersection of a corner's two edge lines), then the gap is filled per mode:
 * - **chamfer** replaces the edge with a strip of `segments` quads (1 = flat,
 *   >1 = a slerped arc → rounded edge);
 * - **straight** keeps the original edge and bridges each receded face to it
 *   with a quad (adds edges without moving the selected ones).
 * `angleDeg` drops edges flatter than the threshold. Coincident corner points
 * (a non-beveled edge shared by two faces on a symmetric solid) weld so the
 * shared edge stays single; leftover vertex holes are capped.
 *
 * Scoped to interior edges on planar-convex faces (cube / cylinder). A
 * boundary edge, non-planar/concave face, degenerate corner, or a junction
 * that won't cap into a simple loop aborts with the mesh untouched.
 */
export function bevelEdges(mesh: HEMesh, edgeIds: number[], opts: BevelEdgeOpts): OpResult | null {
  const { width } = opts;
  const angleDeg = opts.angleDeg ?? 0;
  const mode: BevelMode = opts.mode ?? "chamfer";
  const segments = mode === "straight" ? 1 : Math.max(1, Math.round(opts.segments ?? 1));
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

  // reuse the weld map so a kept original vertex coincides with any cP on it
  const origIdx = (v: number): number => {
    const p = pos(v);
    const k = `${q(p[0])},${q(p[1])},${q(p[2])}`;
    let idx = weldKey.get(k);
    if (idx === undefined) {
      idx = positions.length / 3;
      positions.push(p[0], p[1], p[2]);
      weldKey.set(k, idx);
    }
    return idx;
  };
  // append an interpolated ring point (rounded-chamfer segment) with lift
  const ringIdx = (V: number, a: Vec3, b: Vec3, t: number): number => {
    const P = pos(V);
    const da = sub(a, P);
    const db = sub(b, P);
    const dir = slerp(norm(da), norm(db), t);
    const r = Math.hypot(...(da as Vec3)) * (1 - t) + Math.hypot(...(db as Vec3)) * t;
    const p: Vec3 = [P[0] + dir[0] * r, P[1] + dir[1] * r, P[2] + dir[2] * r];
    const idx = positions.length / 3;
    positions.push(p[0], p[1], p[2]);
    lift.verts.push(idx);
    lift.base.push(P[0], P[1], P[2]);
    lift.dirs.push((p[0] - P[0]) / w, (p[1] - P[1]) / w, (p[2] - P[2]) / w);
    return idx;
  };

  for (const e of sel) {
    const tw = mesh.heTwin[e]!;
    const V = mesh.heVert[e]!;
    const W = mesh.heVert[mesh.heNext[e]!]!;
    const f1V = indexOfHE.get(e)!; // corner at V on F1 (F1 has edge f1V→f1W)
    const f1W = indexOfHE.get(mesh.heNext[e]!)!; // corner at W on F1
    const f2W = indexOfHE.get(tw)!; // corner at W on F2 (F2 has edge f2W→f2V)
    const f2V = indexOfHE.get(mesh.heNext[tw]!)!; // corner at V on F2
    if (new Set([f1V, f1W, f2V, f2W]).size !== 4) continue;

    if (mode === "straight") {
      // keep the selected edge (original V–W) and bridge each receded face to it
      const oV = origIdx(V);
      const oW = origIdx(W);
      faces.push([f1W, f1V, oV, oW]);
      faces.push([f2V, f2W, oW, oV]);
      faceUVs.push([0, 0, 1, 0, 1, 1, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1]);
      continue;
    }

    // chamfer: replace the edge with a (possibly rounded) strip of `segments`
    // quads — ring points arc from the F1 corner to the F2 corner at each end
    const ringV: number[] = [f1V];
    const ringW: number[] = [f1W];
    for (let s = 1; s < segments; s++) {
      const t = s / segments;
      ringV.push(ringIdx(V, cornerPos.get(e)!, cornerPos.get(mesh.heNext[tw]!)!, t));
      ringW.push(ringIdx(W, cornerPos.get(mesh.heNext[e]!)!, cornerPos.get(tw)!, t));
    }
    ringV.push(f2V);
    ringW.push(f2W);
    for (let s = 0; s < segments; s++) {
      faces.push([ringW[s]!, ringV[s]!, ringV[s + 1]!, ringW[s + 1]!]);
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
