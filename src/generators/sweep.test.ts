import { describe, expect, it } from "vitest";
import type { Vec3 } from "@/types/core";
import { validateMesh } from "@/geometry/kernel/validate";
import { buildSweep, type SweepCurve } from "./sweep";

const circleProfile = (r = 0.3, n = 24): SweepCurve => {
  const points: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    points.push([r * Math.cos(a), r * Math.sin(a), 0]);
  }
  return { points, closed: true };
};

const linePath = (len = 4, n = 10): SweepCurve => {
  const points: Vec3[] = [];
  for (let i = 0; i <= n; i++) points.push([0, 0, (i / n) * len]);
  return { points, closed: false };
};

describe("buildSweep", () => {
  it("closed profile on an open path → watertight capped tube", () => {
    const mesh = buildSweep(circleProfile(), linePath(), {
      pathSegments: 16,
      profileSegments: 12,
    });
    expect(mesh).not.toBeNull();
    const v = validateMesh(mesh!);
    expect(v.errors).toEqual([]);
    expect(v.boundaryEdges).toBe(0); // caps close both ends
    // 17 rings × 12 ring points
    expect(mesh!.vCount).toBe(17 * 12);
  });

  it("follows the path (spans its full extent in Z)", () => {
    const mesh = buildSweep(circleProfile(), linePath(4, 8), {
      pathSegments: 12,
      profileSegments: 8,
    })!;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < mesh.vCount; i++) {
      const z = mesh.vPos[i * 3 + 2]!;
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    expect(minZ).toBeCloseTo(0, 4);
    expect(maxZ).toBeCloseTo(4, 4);
  });

  it("open profile on an open path → uncapped sheet (has boundary)", () => {
    const arc: SweepCurve = {
      points: [
        [-0.5, 0, 0],
        [0, 0.5, 0],
        [0.5, 0, 0],
      ],
      closed: false,
    };
    const mesh = buildSweep(arc, linePath(), { pathSegments: 8, profileSegments: 6 });
    expect(mesh).not.toBeNull();
    expect(validateMesh(mesh!).errors).toEqual([]);
    expect(validateMesh(mesh!).boundaryEdges).toBeGreaterThan(0);
  });

  it("bends without self-intersecting on an L-path (RMF stays coherent)", () => {
    const bend: SweepCurve = {
      points: [
        [0, 0, 0],
        [0, 0, 1],
        [0, 0, 2],
        [0.5, 0, 2.5],
        [1, 0, 3],
        [2, 0, 3],
      ],
      closed: false,
    };
    const mesh = buildSweep(circleProfile(0.2), bend, { pathSegments: 24, profileSegments: 10 });
    expect(mesh).not.toBeNull();
    expect(validateMesh(mesh!).errors).toEqual([]);
  });

  it("degenerate input → null", () => {
    expect(
      buildSweep({ points: [[0, 0, 0]], closed: false }, linePath(), {
        pathSegments: 8,
        profileSegments: 6,
      }),
    ).toBeNull();
  });
});
