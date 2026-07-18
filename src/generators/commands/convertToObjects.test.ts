import { describe, expect, it } from "vite-plus/test";
import type { TransformDTO } from "@/types/core";
import { composeTRS } from "@/geometry/boolean/booleanEngine";
import { decomposeTRS } from "./convertToObjects";

/**
 * `decomposeTRS` is the only genuinely new math on the Convert-to-Objects path
 * (a baked instance matrix → a node TRS). It must round-trip against
 * `composeTRS` (the same column-major, Euler-XYZ convention the renderer uses),
 * including a rotation + uniform-scale case — clones carry the effector's
 * uniform scale.
 */
describe("decomposeTRS", () => {
  const roundTrip = (t: TransformDTO) => {
    const m = Float32Array.from(composeTRS(t));
    const d = decomposeTRS(m, 0);
    // recompose the decomposed TRS; the 4×4 must match (Euler is ambiguous, the matrix is not)
    const m2 = composeTRS(d);
    for (let i = 0; i < 16; i++) expect(m2[i]).toBeCloseTo(m[i]!, 5);
    return d;
  };

  it("round-trips a pure translation", () => {
    const d = roundTrip({ position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(d.position[0]).toBeCloseTo(1, 5);
    expect(d.position[1]).toBeCloseTo(2, 5);
    expect(d.position[2]).toBeCloseTo(3, 5);
  });

  it("round-trips rotation + uniform scale + translation", () => {
    const d = roundTrip({ position: [-4, 0.5, 2], rotation: [0.3, 0.5, -0.2], scale: [2, 2, 2] });
    for (const s of d.scale) expect(s).toBeCloseTo(2, 5);
    expect(d.position).toEqual([
      expect.closeTo(-4, 5),
      expect.closeTo(0.5, 5),
      expect.closeTo(2, 5),
    ]);
  });

  it("handles the gimbal edge (|r02| ≈ 1, y ≈ ±90°)", () => {
    roundTrip({ position: [0, 0, 0], rotation: [0.4, Math.PI / 2, 0], scale: [1, 1, 1] });
  });
});
