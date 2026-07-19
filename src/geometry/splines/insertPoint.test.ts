import { describe, expect, it } from "vite-plus/test";
import type { Vec3 } from "@/types/core";
import type { SplineData, SplinePointDTO } from "@/types/geometry/spline";
import { spanControls } from "./eval";
import { insertPoint } from "./ops";

/** Evaluate a cubic bezier span (4 controls) at t. */
const cubic = (c: [Vec3, Vec3, Vec3, Vec3], t: number): Vec3 => {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  const [p0, p1, p2, p3] = c;
  return [
    w0 * p0[0] + w1 * p1[0] + w2 * p2[0] + w3 * p3[0],
    w0 * p0[1] + w1 * p1[1] + w2 * p2[1] + w3 * p3[1],
    w0 * p0[2] + w1 * p1[2] + w2 * p2[2] + w3 * p3[2],
  ];
};

const pt = (position: Vec3, out: Vec3 = [0, 0, 0], inH: Vec3 = [0, 0, 0]): SplinePointDTO => ({
  position,
  inHandle: inH,
  outHandle: out,
  mode: out.some((v) => v !== 0) || inH.some((v) => v !== 0) ? "smooth" : "linear",
});

/** A curvy open spline: two anchors with non-trivial handles. */
const curvy = (): SplineData => ({
  closed: false,
  points: [pt([0, 0, 0], [1, 2, 0]), pt([3, 0, 0], [0, 0, 0], [-1, 2, 0])],
});

/** Whole-span polyline at a set of t's, from the (a,b) anchor pair. */
const sampleSpan = (a: SplinePointDTO, b: SplinePointDTO, ts: number[]): Vec3[] =>
  ts.map((t) => cubic(spanControls(a, b), t));

const close = (a: Vec3, b: Vec3, eps = 1e-9) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < eps;

describe("insertPoint", () => {
  it("preserves the curve exactly (concatenated sub-spans trace the original)", () => {
    const data = curvy();
    const t = 0.37;
    const orig = spanControls(data.points[0]!, data.points[1]!);
    const { data: next, index } = insertPoint(data, 0, t);
    expect(index).toBe(1);
    expect(next.points).toHaveLength(3);
    // the split point sits exactly on the original curve at t
    expect(close(next.points[1]!.position, cubic(orig, t))).toBe(true);
    // sub-span [0,1] over local u maps to original t·u; sub-span [1,2] to t + (1-t)·u
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const left = sampleSpan(next.points[0]!, next.points[1]!, [u])[0]!;
      expect(close(left, cubic(orig, t * u))).toBe(true);
      const right = sampleSpan(next.points[1]!, next.points[2]!, [u])[0]!;
      expect(close(right, cubic(orig, t + (1 - t) * u))).toBe(true);
    }
  });

  it("split point is smooth (handles collinear, opposite)", () => {
    const { data } = insertPoint(curvy(), 0, 0.5);
    const p = data.points[1]!;
    expect(p.mode).toBe("smooth");
    // in/out handles point opposite ways along one line
    const cross = [
      p.inHandle[1] * p.outHandle[2] - p.inHandle[2] * p.outHandle[1],
      p.inHandle[2] * p.outHandle[0] - p.inHandle[0] * p.outHandle[2],
      p.inHandle[0] * p.outHandle[1] - p.inHandle[1] * p.outHandle[0],
    ];
    expect(close(cross as Vec3, [0, 0, 0], 1e-9)).toBe(true);
    const dot = p.inHandle[0] * p.outHandle[0] + p.inHandle[1] * p.outHandle[1];
    expect(dot).toBeLessThan(0);
  });

  it("a linear span yields a linear point on the line, handles zero", () => {
    const data: SplineData = { closed: false, points: [pt([0, 0, 0]), pt([4, 0, 0])] };
    const { data: next } = insertPoint(data, 0, 0.25);
    const p = next.points[1]!;
    expect(p.mode).toBe("linear");
    expect(p.position).toEqual([1, 0, 0]);
    expect(p.inHandle).toEqual([0, 0, 0]);
    expect(p.outHandle).toEqual([0, 0, 0]);
    // neighbours stay linear
    expect(next.points[0]!.outHandle).toEqual([0, 0, 0]);
    expect(next.points[2]!.inHandle).toEqual([0, 0, 0]);
  });

  it("closed spline wrap span (span = n-1) appends the point and preserves the curve", () => {
    // a genuinely curved wrap span (point[1] → point[0]): both facing handles ≠ 0
    const data: SplineData = {
      closed: true,
      points: [pt([0, 0, 0], [1, 1, 0], [1, -1, 0]), pt([3, 3, 0], [-1, 2, 0], [-1, -1, 0])],
    };
    const orig = spanControls(data.points[1]!, data.points[0]!); // wrap span 1 → 0
    const { data: next, index } = insertPoint(data, 1, 0.4);
    expect(index).toBe(2); // appended
    expect(next.points).toHaveLength(3);
    expect(close(next.points[2]!.position, cubic(orig, 0.4))).toBe(true);
    // sub-span [2 → 0 (wrap)] still traces the tail of the original
    const right = spanControls(next.points[2]!, next.points[0]!);
    expect(close(cubic(right, 0.5), cubic(orig, 0.4 + 0.6 * 0.5))).toBe(true);
    // sub-span [1 → 2] traces the head of the original
    const left = spanControls(next.points[1]!, next.points[2]!);
    expect(close(cubic(left, 0.5), cubic(orig, 0.4 * 0.5))).toBe(true);
  });

  it("handles t near the ends without collapsing", () => {
    for (const t of [0.001, 0.999]) {
      const { data } = insertPoint(curvy(), 0, t);
      const orig = spanControls(curvy().points[0]!, curvy().points[1]!);
      expect(close(data.points[1]!.position, cubic(orig, t), 1e-6)).toBe(true);
    }
  });
});
