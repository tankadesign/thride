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
