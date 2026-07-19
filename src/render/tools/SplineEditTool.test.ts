import { describe, expect, it } from "vite-plus/test";
import type { SplineData } from "@/types/geometry/spline";
import { detachedData } from "./SplineEditTool";

/**
 * Editing a spline's points detaches it from its parametric recipe: the new
 * `spline` is kept, `splinePrimitive` is dropped (so the object-manager glyph
 * reverts from the shape icon to the generic spline icon, and the attributes
 * stop offering the parametric params), and unrelated data (material) survives.
 */
describe("detachedData", () => {
  const spline: SplineData = { points: [], closed: false };
  const next: SplineData = { points: [], closed: true };

  it("drops splinePrimitive and swaps in the edited spline", () => {
    const out = detachedData(
      { spline, splinePrimitive: { type: "circle", radius: 1 }, material: "mat-1" },
      next,
    );
    expect(out.splinePrimitive).toBeUndefined();
    expect(out.spline).toBe(next);
    expect(out.material).toBe("mat-1"); // unrelated payload survives
  });

  it("is a no-op on an already-free spline (no splinePrimitive to drop)", () => {
    const out = detachedData({ spline }, next);
    expect("splinePrimitive" in out).toBe(false);
    expect(out.spline).toBe(next);
  });

  it("handles missing node data", () => {
    expect(detachedData(undefined, next)).toEqual({ spline: next });
  });
});
