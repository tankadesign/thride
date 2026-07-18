import { describe, expect, it } from "vite-plus/test";
import { type ClonerParams, clonerCount, clonerMatrices, defaultClonerParams } from "./cloner";

/** Normalize IEEE -0 → +0 (harmless in the matrix, but toEqual distinguishes them). */
const nz = (x: number): number => x + 0;

/** Read the translation column (12,13,14) of instance `i` from a flat matrix array. */
const posOf = (m: Float32Array, i: number): [number, number, number] => [
  nz(m[i * 16 + 12]!),
  nz(m[i * 16 + 13]!),
  nz(m[i * 16 + 14]!),
];

describe("cloner matrices", () => {
  it("emits 16 floats per clone", () => {
    const p = { ...defaultClonerParams(), count: 7 };
    expect(clonerCount(p)).toBe(7);
    expect(clonerMatrices(p)).toHaveLength(7 * 16);
  });

  it("linear layout is centered on the origin and stepped", () => {
    const p: ClonerParams = { ...defaultClonerParams(), count: 3, step: [2, 0, 0] };
    const m = clonerMatrices(p);
    // centered: i-(n-1)/2 → -1, 0, +1 times step
    expect(posOf(m, 0)).toEqual([-2, 0, 0]);
    expect(posOf(m, 1)).toEqual([0, 0, 0]);
    expect(posOf(m, 2)).toEqual([2, 0, 0]);
  });

  it("no effector → identity rotation/scale (matrix is pure translation)", () => {
    const m = clonerMatrices({ ...defaultClonerParams(), count: 1, step: [0, 0, 0] });
    // column-major identity basis
    expect(Array.from(m.slice(0, 12)).map(nz)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  });

  it("is deterministic — same seed reproduces the same scatter", () => {
    const p: ClonerParams = {
      ...defaultClonerParams(),
      count: 20,
      positionJitter: [1, 1, 1],
      rotationJitter: [0.5, 0.5, 0.5],
      scaleJitter: 0.3,
      seed: 42,
    };
    expect(Array.from(clonerMatrices(p))).toEqual(Array.from(clonerMatrices(p)));
  });

  it("instance jitter is stable as the count grows (i doesn't move when N changes)", () => {
    const base: ClonerParams = {
      ...defaultClonerParams(),
      count: 5,
      step: [0, 0, 0], // isolate the effector from the layout
      positionJitter: [1, 1, 1],
      seed: 7,
    };
    const small = clonerMatrices(base);
    const big = clonerMatrices({ ...base, count: 50 });
    // instances 0..4 are byte-identical whether N=5 or N=50
    expect(Array.from(big.slice(0, 5 * 16))).toEqual(Array.from(small));
  });

  it("adjacent clones get uncorrelated jitter (index mixed into the seed)", () => {
    const p: ClonerParams = {
      ...defaultClonerParams(),
      count: 2,
      step: [0, 0, 0],
      positionJitter: [1, 1, 1],
      seed: 100,
    };
    const m = clonerMatrices(p);
    expect(posOf(m, 0)).not.toEqual(posOf(m, 1));
  });

  it("count floors and never goes negative", () => {
    expect(clonerCount({ ...defaultClonerParams(), count: 3.9 })).toBe(3);
    expect(clonerCount({ ...defaultClonerParams(), count: -4 })).toBe(0);
    expect(clonerMatrices({ ...defaultClonerParams(), count: 0 })).toHaveLength(0);
  });
});
