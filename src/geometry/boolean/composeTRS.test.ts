import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { TransformDTO } from "@/types/core";
import { composeTRS } from "./booleanEngine";

// composeTRS must agree with how the renderer applies node transforms:
// obj.rotation.set(x, y, z, "XYZ") → Matrix4.compose. Any divergence makes
// baked generator meshes (spline extrude, boolean) drift from their inputs.
function threeTRS(t: TransformDTO): number[] {
  const m = new Matrix4().compose(
    new Vector3(...t.position),
    new Quaternion().setFromEuler(new Euler(...t.rotation, "XYZ")),
    new Vector3(...t.scale),
  );
  return [...m.elements];
}

const CASES: TransformDTO[] = [
  { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  // single-axis (pen work planes)
  { position: [1.2, 1, 1.2], rotation: [-Math.PI / 2, 0, 0], scale: [1, 1, 1] },
  { position: [0, 2.8, 4.5], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] },
  // multi-axis (gizmo-rotated spline — the regression)
  { position: [3, -1, 2], rotation: [0.5, 0.7, 0.3], scale: [1, 1, 1] },
  { position: [0, 0, 0], rotation: [-1.1, 2.4, 0.9], scale: [2, 0.5, 1.5] },
];

describe("composeTRS", () => {
  it("matches three.js Euler XYZ composition", () => {
    for (const t of CASES) {
      const ours = composeTRS(t);
      const ref = threeTRS(t);
      for (let i = 0; i < 16; i++) {
        expect(ours[i]!, `case ${JSON.stringify(t.rotation)} element ${i}`).toBeCloseTo(
          ref[i]!,
          10,
        );
      }
    }
  });
});
