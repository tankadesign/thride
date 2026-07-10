import { describe, expect, it } from "vite-plus/test";
import { validateMesh } from "@/geometry/kernel/validate";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { buildPrimitive } from ".";

const boundaryEdges = (m: HEMesh): number => {
  let n = 0;
  for (let h = 0; h < m.heCount; h++) if (m.heTwin[h] === -1) n++;
  return n;
};

describe("combined sphere primitive", () => {
  it("standard mode is unchanged (closed, Euler 2) and legacy params still build", () => {
    const legacy = buildPrimitive({ type: "sphere", params: { radius: 1, segments: 16, rings: 8 } });
    expect(boundaryEdges(legacy)).toBe(0);
    expect(legacy.vCount - legacy.edgeCount + legacy.fCount).toBe(2);
    expect(validateMesh(legacy).ok).toBe(true);
  });

  it("icosa mode matches the standalone icosphere", () => {
    const combined = buildPrimitive({
      type: "sphere",
      params: { radius: 1, icosa: true, segments: 32, rings: 16, subdivisions: 2 },
    });
    const standalone = buildPrimitive({ type: "icosphere", params: { radius: 1, subdivisions: 2 } });
    expect(combined.vCount).toBe(standalone.vCount);
    expect(combined.fCount).toBe(standalone.fCount);
    expect(validateMesh(combined).ok).toBe(true);
  });

  it("hemisphere is an open disk: boundary at the equator, Euler 1", () => {
    const n = 16;
    const r = 6;
    const mesh = buildPrimitive({
      type: "sphere",
      params: { radius: 2, segments: n, rings: r, hemisphere: true },
    });
    expect(mesh.vCount).toBe(n * r + 1); // r latitude rings + top pole
    expect(mesh.fCount).toBe(n * r); // n pole tris + n*(r-1) quads
    expect(boundaryEdges(mesh)).toBe(n); // the open equator
    expect(mesh.vCount - mesh.edgeCount + mesh.fCount).toBe(1);
    // every vertex sits on or above the equator plane
    for (let v = 0; v < mesh.vCount; v++) expect(mesh.vPos[v * 3 + 1]!).toBeGreaterThanOrEqual(-1e-6);
    expect(validateMesh(mesh).ok).toBe(true);
  });

  it("filled hemisphere closes the hole with a center-point fan (Euler 2)", () => {
    const n = 16;
    const r = 6;
    const mesh = buildPrimitive({
      type: "sphere",
      params: { radius: 2, segments: n, rings: r, hemisphere: true, filled: true },
    });
    expect(mesh.vCount).toBe(n * r + 2); // + the cap's center vertex
    expect(boundaryEdges(mesh)).toBe(0); // watertight
    expect(mesh.vCount - mesh.edgeCount + mesh.fCount).toBe(2);
    // the cap center sits at the equator-plane origin
    const center = mesh.getPosition(mesh.vCount - 1);
    expect(center).toEqual([0, 0, 0]);
    expect(validateMesh(mesh).ok).toBe(true);
  });
});
