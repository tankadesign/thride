import { describe, expect, it } from "vite-plus/test";
import { validateMesh } from "@/geometry/kernel/validate";
import { buildPrimitive } from ".";

describe("disc primitive (center fan + concentric rings)", () => {
  it("has a center vertex fanned to the innermost ring (rings=1)", () => {
    const n = 8;
    const mesh = buildPrimitive({ type: "disc", params: { radius: 1, segments: n, rings: 1 } });
    expect(mesh.vCount).toBe(1 + n); // center + one ring
    expect(mesh.fCount).toBe(n); // all triangles
    expect(mesh.getPosition(0)).toEqual([0, 0, 0]);
    // every face touches the center vertex; center valence = n
    let facesTouchingCenter = 0;
    for (let f = 0; f < mesh.fCount; f++) {
      if (mesh.faceVertices(f).includes(0)) facesTouchingCenter++;
    }
    expect(facesTouchingCenter).toBe(n);
    expect(validateMesh(mesh).ok).toBe(true);
  });

  it("rings subdivide outward: quads between rings, disk topology intact", () => {
    const n = 12;
    const R = 4;
    const mesh = buildPrimitive({ type: "disc", params: { radius: 2, segments: n, rings: R } });
    expect(mesh.vCount).toBe(1 + n * R);
    expect(mesh.fCount).toBe(n * R); // n tris + n*(R-1) quads
    expect(mesh.edgeCount).toBe(2 * n * R);
    // Euler characteristic of a disk with boundary: V − E + F = 1
    expect(mesh.vCount - mesh.edgeCount + mesh.fCount).toBe(1);
    // rings sit at evenly spaced radii
    for (let r = 1; r <= R; r++) {
      const [x, , z] = mesh.getPosition(1 + (r - 1) * n);
      expect(Math.hypot(x, z)).toBeCloseTo((2 * r) / R, 5);
    }
    expect(validateMesh(mesh).ok).toBe(true);
  });

  it("discs saved before the rings param existed build as one ring", () => {
    const mesh = buildPrimitive({ type: "disc", params: { radius: 1, segments: 6 } });
    expect(mesh.vCount).toBe(7);
    expect(mesh.fCount).toBe(6);
    expect(validateMesh(mesh).ok).toBe(true);
  });
});
