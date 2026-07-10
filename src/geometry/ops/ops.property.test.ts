import { describe, expect, it } from "vite-plus/test";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import { Document } from "@/core/document/Document";
import { CreateNodeCommand } from "@/core/history/commands/scene";
import { uuidv7 } from "@/core/ids/uuid";
import { HEMesh } from "@/geometry/kernel/HEMesh";
import { validateMesh } from "@/geometry/kernel/validate";
import { buildPrimitive } from "@/geometry/primitives";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { MeshTopologyCommand } from "@/geometry/commands/topology";
import { bevelVertices } from "./bevel";
import { bevelEdges } from "./bevelEdge";
import { deleteFaces, extrudeFaces, insetFaces } from "./faceOps";
import { dissolveVertices, weldVerticesTo } from "./weld";
import { uniqueEdges } from "@/geometry/kernel/components";

/** Deterministic LCG so failures reproduce. */
const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 0xffffffff);
};

const FIXTURES: PrimitiveDescriptor[] = [
  { type: "cube", params: { width: 2, height: 2, depth: 2 } },
  { type: "sphere", params: { radius: 1, segments: 8, rings: 5 } },
  { type: "disc", params: { radius: 1, segments: 8, rings: 2 } },
  {
    type: "cylinder",
    params: { radiusTop: 1, radiusBottom: 1, height: 2, segments: 6, capped: true },
  },
];

const pickSubset = (count: number, max: number, rand: () => number): number[] => {
  const picked = new Set<number>();
  while (picked.size < count) picked.add(Math.floor(rand() * max));
  return [...picked];
};

describe("topology op invariants (randomized)", () => {
  for (const desc of FIXTURES) {
    for (let seed = 1; seed <= 4; seed++) {
      it(`${desc.type} seed ${seed}: extrude/inset/delete/weld keep the kernel valid`, () => {
        const rand = rng(seed * 7919);

        // extrude a random region
        let mesh = buildPrimitive(desc);
        const before = validateMesh(mesh);
        const faces = pickSubset(1 + Math.floor(rand() * 3), mesh.fCount, rand);
        const fBefore = mesh.fCount;
        const ext = extrudeFaces(mesh, faces, 0.15);
        expect(ext).not.toBeNull();
        const vExt = validateMesh(mesh);
        expect(vExt.errors).toEqual([]);
        // caps replace originals; walls add one face per region-boundary edge
        expect(mesh.fCount).toBeGreaterThan(fBefore);
        expect(vExt.boundaryEdges).toBe(before.boundaryEdges); // openness unchanged
        for (const id of ext!.ids) expect(id).toBeLessThan(mesh.fCount);
        // modal-tool lift data: one base/dir triple per lifted vert, unclamped
        const eLift = ext!.lift!;
        expect(eLift.base.length).toBe(eLift.verts.length * 3);
        expect(eLift.dir.length).toBe(eLift.verts.length * 3);
        expect([...eLift.max].every((m) => m === Number.POSITIVE_INFINITY)).toBe(true);

        // inset random faces on a fresh mesh
        mesh = buildPrimitive(desc);
        const insetIds = pickSubset(1 + Math.floor(rand() * 3), mesh.fCount, rand);
        const sumLoop = insetIds.reduce((acc, f) => acc + mesh.faceSize(f), 0);
        const f0 = mesh.fCount;
        const v0 = mesh.vCount;
        const ins = insetFaces(mesh, insetIds, 0.1);
        expect(ins).not.toBeNull();
        expect(validateMesh(mesh).errors).toEqual([]);
        expect(mesh.fCount).toBe(f0 + sumLoop); // one ring quad per corner
        expect(mesh.vCount).toBe(v0 + sumLoop);
        // inset lift: every inner vert clamped to a positive finite max
        const iLift = ins!.lift!;
        expect(iLift.verts.length).toBe(sumLoop);
        expect([...iLift.max].every((m) => m > 0 && Number.isFinite(m))).toBe(true);

        // delete random faces on a fresh mesh: no orphaned vertices remain
        mesh = buildPrimitive(desc);
        const delIds = pickSubset(1 + Math.floor(rand() * 2), mesh.fCount, rand);
        const del = deleteFaces(mesh, delIds);
        expect(del).not.toBeNull();
        const vDel = validateMesh(mesh);
        expect(vDel.errors).toEqual([]);
        const used = new Set<number>();
        for (let f = 0; f < mesh.fCount; f++) for (const v of mesh.faceVertices(f)) used.add(v);
        expect(used.size).toBe(mesh.vCount);

        // dissolve two vertices of one face (guaranteed-adjacent-ish selection)
        mesh = buildPrimitive(desc);
        const loop = mesh.faceVertices(Math.floor(rand() * mesh.fCount));
        const vW = mesh.vCount;
        const weld = dissolveVertices(mesh, [loop[0]!, loop[1]!]);
        if (weld) {
          expect(validateMesh(mesh).errors).toEqual([]);
          expect(mesh.vCount).toBeLessThan(vW);
          expect(weld.ids[0]).toBeLessThan(mesh.vCount);
        }

        // vertex bevel: truncate a couple of random vertices — kernel stays
        // valid, verts grow (each cut adds points), a cut face per vertex
        mesh = buildPrimitive(desc);
        const bevIds = pickSubset(1 + Math.floor(rand() * 2), mesh.vCount, rand);
        const fB = mesh.fCount;
        const vB = mesh.vCount;
        const bev = bevelVertices(mesh, bevIds, 0.15);
        if (bev) {
          expect(validateMesh(mesh).errors).toEqual([]);
          expect(mesh.vCount).toBeGreaterThan(vB - bevIds.length); // cuts add points
          expect(mesh.fCount).toBeGreaterThan(fB); // one cut face per beveled vert
          for (const id of bev.ids) expect(id).toBeLessThan(mesh.vCount);
          const bLift = bev.lift!;
          expect(bLift.base.length).toBe(bLift.verts.length * 3);
          expect([...bLift.max].every((m) => m > 0 && Number.isFinite(m))).toBe(true);
        }

        // edge bevel: chamfer a random edge subset — if it commits, the kernel
        // stays valid and points grow (each corner splits into new points)
        mesh = buildPrimitive(desc);
        const edges = uniqueEdges(mesh);
        const beIds = pickSubset(1 + Math.floor(rand() * 3), edges.length, rand).map(
          (i) => edges[i]!,
        );
        const evB = mesh.vCount;
        const beRes = bevelEdges(mesh, beIds, 0.12);
        if (beRes) {
          expect(validateMesh(mesh).errors).toEqual([]);
          expect(mesh.vCount).toBeGreaterThanOrEqual(evB);
          const beLift = beRes.lift!;
          expect(beLift.base.length).toBe(beLift.verts.length * 3);
        }

        // weld-to-target (the Weld tool op): target keeps its exact position
        mesh = buildPrimitive(desc);
        const wLoop = mesh.faceVertices(Math.floor(rand() * mesh.fCount));
        const source = wLoop[0]!;
        const target = wLoop[1]!;
        const targetPos = [
          mesh.vPos[target * 3]!,
          mesh.vPos[target * 3 + 1]!,
          mesh.vPos[target * 3 + 2]!,
        ];
        const vT = mesh.vCount;
        const weldTo = weldVerticesTo(mesh, [source], target);
        if (weldTo) {
          expect(validateMesh(mesh).errors).toEqual([]);
          expect(mesh.vCount).toBe(vT - 1);
          const t = weldTo.ids[0]!;
          expect([mesh.vPos[t * 3], mesh.vPos[t * 3 + 1], mesh.vPos[t * 3 + 2]]).toEqual(targetPos);
        }
      });
    }
  }

  it("aborted ops leave the mesh untouched (weld below 2 verts, empty sets)", () => {
    const mesh = buildPrimitive(FIXTURES[0]!);
    const snap = JSON.stringify([...mesh.vPos]);
    const dirtyBefore = mesh.dirty;
    const tvBefore = mesh.topologyVersion;
    expect(dissolveVertices(mesh, [0])).toBeNull();
    expect(weldVerticesTo(mesh, [0], 0)).toBeNull(); // source === target
    expect(weldVerticesTo(mesh, [0], 99999)).toBeNull(); // bad target
    expect(extrudeFaces(mesh, [], 0.1)).toBeNull();
    expect(insetFaces(mesh, [99999], 0.1)).toBeNull();
    expect(bevelVertices(mesh, [], 0.1)).toBeNull(); // empty selection
    expect(bevelEdges(mesh, [], 0.1)).toBeNull(); // empty edge selection
    expect(JSON.stringify([...mesh.vPos])).toBe(snap);
    expect(mesh.dirty).toBe(dirtyBefore);
    expect(mesh.topologyVersion).toBe(tvBefore);
  });

  it("edge bevel on an OPEN mesh keeps the outer boundary open (no giant cap)", () => {
    // 3×3 grid plane: an open mesh with a 12-edge outer boundary
    const idx = (r: number, c: number) => r * 4 + c;
    const positions: number[] = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) positions.push(c, 0, r);
    const gridFaces: number[][] = [];
    const gridUVs: number[][] = [];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        gridFaces.push([idx(r, c), idx(r, c + 1), idx(r + 1, c + 1), idx(r + 1, c)]);
        gridUVs.push([0, 0, 1, 0, 1, 1, 0, 1]);
      }
    const mesh = HEMesh.fromPolygons({ positions, faces: gridFaces, faceUVs: gridUVs });
    // the four edges around the center face (all interior) — a clean loop
    const want = [
      [5, 6],
      [6, 10],
      [10, 9],
      [9, 5],
    ];
    const inner = uniqueEdges(mesh).filter((h) => {
      const a = mesh.heVert[h]!;
      const b = mesh.heVert[mesh.heNext[h]!]!;
      return want.some((w) => (w[0] === a && w[1] === b) || (w[0] === b && w[1] === a));
    });
    const before = validateMesh(mesh).boundaryEdges;
    const res = bevelEdges(mesh, inner, 0.15);
    expect(res).not.toBeNull();
    const v = validateMesh(mesh);
    expect(v.errors).toEqual([]);
    expect(v.boundaryEdges).toBe(before); // outer boundary untouched, not capped
  });

  it("MeshTopologyCommand: ONE step, undo restores arrays exactly, redo re-runs", () => {
    const doc = new Document();
    const create = new CreateNodeCommand("mesh", "Cube");
    doc.history.run(create);
    const meshId = uuidv7();
    const mesh = buildPrimitive(FIXTURES[0]!);
    meshRegistry.register(meshId, mesh);
    doc.setNodeData(create.nodeId, { mesh: { id: meshId } });
    const beforePos = [...mesh.vPos];
    const beforeF = mesh.fCount;
    const steps = doc.history.stats.steps;

    doc.history.run(
      new MeshTopologyCommand(create.nodeId, meshId, "Extrude", (m) => extrudeFaces(m, [0], 0.25)),
    );
    expect(doc.history.stats.steps).toBe(steps + 1);
    expect(mesh.fCount).toBe(beforeF + 4); // cap replaces original + 4 walls
    const sel = doc.selection.componentsFor(create.nodeId, "polygon");
    expect(sel?.bits.count).toBe(1); // the cap stays selected
    expect(sel?.topologyVersion).toBe(mesh.topologyVersion);

    doc.history.undo();
    expect(mesh.fCount).toBe(beforeF);
    expect([...mesh.vPos]).toEqual(beforePos);
    expect(validateMesh(mesh).ok).toBe(true);

    doc.history.redo();
    expect(mesh.fCount).toBe(beforeF + 4);
    expect(validateMesh(mesh).ok).toBe(true);
  });
});
