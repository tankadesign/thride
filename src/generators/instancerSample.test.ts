import { describe, expect, it } from "vite-plus/test";
import { identityTransform } from "@/types/core";
import { HEMesh } from "@/geometry/kernel/HEMesh";
import { buildSplinePrimitive } from "@/geometry/splines/primitives";
import { type ClonerParams, defaultClonerParams } from "./cloner";
import { MIN_SPLINE_COUNT, sampleMeshTarget, sampleSplineTarget } from "./instancerSample";

/** A unit quad in the XZ plane (normal points +Y): 4 verts, 1 face, 4 edges. */
function quad(): HEMesh {
  return HEMesh.fromPolygons({
    positions: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1],
    faces: [[0, 1, 2, 3]],
  });
}

const params = (over: Partial<ClonerParams>): ClonerParams => ({
  ...defaultClonerParams(),
  ...over,
});
/** The local +Y column of instance i's basis (the alignment direction). */
const upOf = (basis: number[]): [number, number, number] => [basis[3]!, basis[4]!, basis[5]!];

describe("sampleMeshTarget", () => {
  it("points → one instance per vertex, oriented to the vertex normal", () => {
    const insts = sampleMeshTarget(quad(), identityTransform(), params({ distribution: "points" }));
    expect(insts).toHaveLength(4);
    // the quad's smooth vertex normals are perpendicular to its plane (±Y)
    for (const inst of insts) expect(Math.abs(upOf(inst.basis)[1])).toBeGreaterThan(0.99);
  });

  it("faces → one instance at each polygon center", () => {
    const insts = sampleMeshTarget(quad(), identityTransform(), params({ distribution: "faces" }));
    expect(insts).toHaveLength(1);
    // centroid of the unit quad is the origin
    expect(insts[0]!.position.map((v) => Math.round(v))).toEqual([0, 0, 0]);
    expect(Math.abs(upOf(insts[0]!.basis)[1])).toBeGreaterThan(0.99);
  });

  it("edges → one instance per undirected edge (a quad has 4)", () => {
    const insts = sampleMeshTarget(quad(), identityTransform(), params({ distribution: "edges" }));
    expect(insts).toHaveLength(4);
  });

  it("direction orientation ignores the surface and uses the up vector", () => {
    const insts = sampleMeshTarget(
      quad(),
      identityTransform(),
      params({ distribution: "points", orientation: "direction", upVector: "x+" }),
    );
    for (const inst of insts) {
      const [x, y, z] = upOf(inst.basis);
      expect(x).toBeCloseTo(1, 6);
      expect(y).toBeCloseTo(0, 6);
      expect(z).toBeCloseTo(0, 6);
    }
  });
});

describe("sampleSplineTarget", () => {
  const line = buildSplinePrimitive({ type: "line", length: 4 }); // open, [-2,0,0]..[2,0,0]

  it("points → one instance per anchor", () => {
    const insts = sampleSplineTarget(line, identityTransform(), params({ distribution: "points" }));
    expect(insts).toHaveLength(2);
  });

  it("open count → evenly spaced with a clone at each end", () => {
    const insts = sampleSplineTarget(
      line,
      identityTransform(),
      params({ distribution: "count", count: 4 }),
    );
    expect(insts).toHaveLength(4);
    expect(insts[0]!.position[0]).toBeCloseTo(-2, 5);
    expect(insts[3]!.position[0]).toBeCloseTo(2, 5);
    // even spacing of 4/3 between the four stations
    expect(insts[1]!.position[0]).toBeCloseTo(-2 + 4 / 3, 5);
  });

  it("closed count → count clones with no duplicate at the wrap", () => {
    const circle = buildSplinePrimitive({ type: "circle", radius: 1 });
    const insts = sampleSplineTarget(
      circle,
      identityTransform(),
      params({ distribution: "count", count: 6 }),
    );
    expect(insts).toHaveLength(6);
    // no two consecutive stations coincide (a wrap duplicate would)
    for (let i = 1; i < insts.length; i++) {
      const a = insts[i - 1]!.position;
      const b = insts[i]!.position;
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(1e-3);
    }
  });

  it("count is clamped to a minimum of 2", () => {
    const insts = sampleSplineTarget(
      line,
      identityTransform(),
      params({ distribution: "count", count: 1 }),
    );
    expect(insts).toHaveLength(MIN_SPLINE_COUNT);
  });
});
