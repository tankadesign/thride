import { describe, expect, it } from "vite-plus/test";
import type { SplinePrimitive } from "@/types/geometry/spline";
import { buildSplinePrimitive } from "./primitives";

describe("buildSplinePrimitive", () => {
  it("circle: 4 closed smooth anchors on the radius", () => {
    const s = buildSplinePrimitive({ type: "circle", radius: 2 });
    expect(s.closed).toBe(true);
    expect(s.points).toHaveLength(4);
    for (const p of s.points) {
      expect(Math.hypot(p.position[0], p.position[1])).toBeCloseTo(2, 6);
      expect(p.position[2]).toBe(0);
      expect(p.mode).toBe("smooth");
    }
  });

  it("nside: rounding 0 = sharp corners, >0 = smooth (bulge mode)", () => {
    const sharp = buildSplinePrimitive({
      type: "nside",
      sides: 6,
      radius: 1,
      rounding: 0,
      roundCorners: false,
    });
    expect(sharp.points).toHaveLength(6);
    expect(sharp.points.every((p) => p.mode === "linear")).toBe(true);
    const round = buildSplinePrimitive({
      type: "nside",
      sides: 6,
      radius: 1,
      rounding: 500,
      roundCorners: false,
    });
    expect(round.points.every((p) => p.mode === "smooth")).toBe(true);
    expect(round.points.some((p) => Math.hypot(...p.outHandle) > 0)).toBe(true);
  });

  it("nside roundCorners: fillets each corner into two tangent points, edges stay straight", () => {
    // hexagon turn angle 60° > 15° → every corner filleted → 2 points each
    const filleted = buildSplinePrimitive({
      type: "nside",
      sides: 6,
      radius: 1,
      rounding: 500,
      roundCorners: true,
    });
    expect(filleted.points).toHaveLength(12);
    // each fillet point is "broken" (straight edge on one side, arc on the other)
    expect(filleted.points.every((p) => p.mode === "broken")).toBe(true);
    // corners pulled inside the original radius
    expect(filleted.points.every((p) => Math.hypot(p.position[0], p.position[1]) < 1)).toBe(true);
    // rounding 0 leaves the sharp polygon even with the toggle on
    const stillSharp = buildSplinePrimitive({
      type: "nside",
      sides: 6,
      radius: 1,
      rounding: 0,
      roundCorners: true,
    });
    expect(stillSharp.points).toHaveLength(6);
    expect(stillSharp.points.every((p) => p.mode === "linear")).toBe(true);
  });

  it("star: 2×points alternating inner/outer radius", () => {
    const s = buildSplinePrimitive({
      type: "star",
      points: 5,
      innerRadius: 0.4,
      outerRadius: 1,
      rounding: 0,
      roundCorners: false,
    });
    expect(s.points).toHaveLength(10);
    const radii = s.points.map((p) => Math.hypot(p.position[0], p.position[1]));
    expect(radii[0]).toBeCloseTo(1, 6); // outer
    expect(radii[1]).toBeCloseTo(0.4, 6); // inner
  });

  it("helix: open, spans full height in Z, spirals in XY", () => {
    const s = buildSplinePrimitive({ type: "helix", radius: 1, height: 4, turns: 2, segments: 8 });
    expect(s.closed).toBe(false);
    expect(s.points.length).toBe(2 * 8 + 1); // segments·turns + 1
    expect(s.points[0]!.position[2]).toBeCloseTo(0, 6);
    expect(s.points.at(-1)!.position[2]).toBeCloseTo(4, 6);
    // uses all three dimensions (radius in XY)
    expect(Math.hypot(s.points[3]!.position[0], s.points[3]!.position[1])).toBeCloseTo(1, 6);
  });

  it("clamps degenerate params instead of throwing", () => {
    const cases: SplinePrimitive[] = [
      { type: "nside", sides: 0, radius: -1, rounding: 9999, roundCorners: false },
      { type: "nside", sides: 0, radius: -1, rounding: 9999, roundCorners: true },
      {
        type: "star",
        points: 1,
        innerRadius: 0,
        outerRadius: 0,
        rounding: -50,
        roundCorners: true,
      },
      { type: "helix", radius: 0, height: 0, turns: 0, segments: 0 },
    ];
    for (const c of cases) expect(buildSplinePrimitive(c).points.length).toBeGreaterThan(0);
  });
});
