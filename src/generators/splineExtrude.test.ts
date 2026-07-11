import { describe, expect, it } from "vite-plus/test";
import type { SplineData } from "@/types/geometry/spline";
import { validateMesh } from "@/geometry/kernel/validate";
import { buildSplineExtrude, defaultSplineExtrudeParams } from "./splineExtrude";

const square = (closed = true): SplineData => ({
  closed,
  points: [
    { position: [0, 0, 0], inHandle: [0, 0, 0], outHandle: [0, 0, 0], mode: "linear" },
    { position: [1, 0, 0], inHandle: [0, 0, 0], outHandle: [0, 0, 0], mode: "linear" },
    { position: [1, 1, 0], inHandle: [0, 0, 0], outHandle: [0, 0, 0], mode: "linear" },
    { position: [0, 1, 0], inHandle: [0, 0, 0], outHandle: [0, 0, 0], mode: "linear" },
  ],
});

const roundedSquare = (): SplineData => ({
  closed: true,
  points: square().points.map((p) => ({
    ...p,
    mode: "smooth",
    inHandle: [-0.15, 0, 0],
    outHandle: [0.15, 0, 0],
  })),
});

describe("buildSplineExtrude", () => {
  it("closed linear profile → capped box, valid kernel", () => {
    const mesh = buildSplineExtrude(square(), { ...defaultSplineExtrudeParams(), depth: 1 });
    expect(mesh).not.toBeNull();
    const v = validateMesh(mesh!);
    expect(v.errors).toEqual([]);
    expect(v.boundaryEdges).toBe(0); // watertight
    expect(mesh!.fCount).toBe(6); // 4 walls + 2 n-gon caps
    expect(mesh!.vCount).toBe(8);
  });

  it("bevel adds rounded rings, stays watertight", () => {
    const mesh = buildSplineExtrude(square(), {
      ...defaultSplineExtrudeParams(),
      depth: 1,
      bevelSize: 0.1,
      bevelSegments: 3,
      caps: true,
    });
    expect(mesh).not.toBeNull();
    const v = validateMesh(mesh!);
    expect(v.errors).toEqual([]);
    expect(v.boundaryEdges).toBe(0);
    // rings: 2*(segs+1) → wall bands n*(rings-1), plus 2 caps
    expect(mesh!.fCount).toBe(4 * (2 * 4 - 1) + 2);
  });

  it("height segments subdivide the wall (default 1 = unchanged)", () => {
    const one = buildSplineExtrude(square(), { ...defaultSplineExtrudeParams(), depth: 1 });
    const four = buildSplineExtrude(square(), {
      ...defaultSplineExtrudeParams(),
      depth: 1,
      heightSegments: 4,
    });
    expect(one!.fCount).toBe(6); // 4 walls + 2 caps
    // 4 wall bands × 4 sides + 2 caps
    expect(four!.fCount).toBe(4 * 4 + 2);
    expect(validateMesh(four!).errors).toEqual([]);
    expect(validateMesh(four!).boundaryEdges).toBe(0);
  });

  it("height segments compose with bevel, stay watertight", () => {
    const mesh = buildSplineExtrude(square(), {
      ...defaultSplineExtrudeParams(),
      depth: 1,
      bevelSize: 0.1,
      bevelSegments: 3,
      heightSegments: 3,
    });
    expect(mesh).not.toBeNull();
    const v = validateMesh(mesh!);
    expect(v.errors).toEqual([]);
    expect(v.boundaryEdges).toBe(0);
    // 2*(segs+1) arc rings + (heightSegs-1) interior wall rings
    const ringCount = 2 * 4 + (3 - 1);
    expect(mesh!.fCount).toBe(4 * (ringCount - 1) + 2);
  });

  it("missing heightSegments (legacy project) defaults to 1", () => {
    const legacy = { depth: 1, bevelSize: 0, bevelSegments: 2, caps: true } as Parameters<
      typeof buildSplineExtrude
    >[1];
    const mesh = buildSplineExtrude(square(), legacy);
    expect(mesh).not.toBeNull();
    expect(mesh!.fCount).toBe(6);
  });

  it("tilted-planar profile extrudes along its own normal (not flattened to XY)", () => {
    // unit square rotated 45° about X → a planar profile whose normal is
    // (0, -sin45, cos45). The old XY-drop would squash it; best-fit keeps it.
    const c = Math.cos(Math.PI / 4);
    const s = Math.sin(Math.PI / 4);
    const tilted: SplineData = {
      closed: true,
      points: [
        [0, 0, 0],
        [1, 0, 0],
        [1, c, s],
        [0, c, s],
      ].map((p) => ({
        position: p as [number, number, number],
        inHandle: [0, 0, 0],
        outHandle: [0, 0, 0],
        mode: "linear",
      })),
    };
    const mesh = buildSplineExtrude(tilted, { ...defaultSplineExtrudeParams(), depth: 1 });
    expect(mesh).not.toBeNull();
    const v = validateMesh(mesh!);
    expect(v.errors).toEqual([]);
    expect(v.boundaryEdges).toBe(0);
    expect(mesh!.fCount).toBe(6);
    // bottom cap = verts 0..3, top cap = verts 4..7; the extrude direction is
    // the vector between their centroids — it must tilt (non-zero Y), which a
    // flatten-to-XY-then-extrude-along-Z result could never have
    const centroid = (lo: number) => {
      let y = 0;
      let z = 0;
      for (let i = lo; i < lo + 4; i++) {
        y += mesh!.vPos[i * 3 + 1]!;
        z += mesh!.vPos[i * 3 + 2]!;
      }
      return { y: y / 4, z: z / 4 };
    };
    const dir = centroid(4);
    const base = centroid(0);
    expect(Math.abs(dir.y - base.y)).toBeGreaterThan(0.3); // tilted, not axis-aligned
  });

  it("smooth profile samples curves (vert count grows)", () => {
    const mesh = buildSplineExtrude(roundedSquare(), {
      ...defaultSplineExtrudeParams(),
      depth: 0.5,
    });
    expect(mesh).not.toBeNull();
    expect(validateMesh(mesh!).errors).toEqual([]);
    expect(mesh!.vCount).toBeGreaterThan(20); // sampled bezier corners
  });

  it("open profile → ribbon with open boundary, no caps", () => {
    const mesh = buildSplineExtrude(square(false), {
      ...defaultSplineExtrudeParams(),
      depth: 1,
    });
    expect(mesh).not.toBeNull();
    const v = validateMesh(mesh!);
    expect(v.errors).toEqual([]);
    expect(v.boundaryEdges).toBeGreaterThan(0); // open sheet
    expect(mesh!.fCount).toBe(3); // 3 wall quads for a 4-point open polyline
  });

  it("degenerate input → null", () => {
    const two: SplineData = { closed: true, points: square().points.slice(0, 2) };
    expect(buildSplineExtrude(two, defaultSplineExtrudeParams())).toBeNull();
  });
});
