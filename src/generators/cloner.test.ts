import { describe, expect, it } from "vite-plus/test";
import {
  basisFromUp,
  type ClonerParams,
  clonerInstanceMatrices,
  defaultClonerParams,
  type Instance,
  normClonerParams,
  upVectorAxis,
} from "./cloner";

/** Normalize IEEE -0 → +0 (harmless in the matrix, but toEqual distinguishes them). */
const nz = (x: number): number => x + 0;

/** Read the translation column (12,13,14) of instance `i` from a flat matrix array. */
const posOf = (m: Float32Array, i: number): [number, number, number] => [
  nz(m[i * 16 + 12]!),
  nz(m[i * 16 + 13]!),
  nz(m[i * 16 + 14]!),
];

const identityBasis = () => basisFromUp([0, 1, 0]);
const at = (p: [number, number, number]): Instance => ({ position: p, basis: identityBasis() });

describe("basisFromUp", () => {
  it("up = +Y yields the identity basis (clones match their template)", () => {
    expect(basisFromUp([0, 1, 0]).map(nz)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("aligns the local +Y column to the given direction (unit)", () => {
    const dir: [number, number, number] = [1, 2, 3];
    const b = basisFromUp(dir);
    const l = Math.hypot(dir[0], dir[1], dir[2]);
    expect(b[3]).toBeCloseTo(dir[0] / l, 6);
    expect(b[4]).toBeCloseTo(dir[1] / l, 6);
    expect(b[5]).toBeCloseTo(dir[2] / l, 6);
  });

  it("is orthonormal for an arbitrary up", () => {
    const b = basisFromUp([0.3, -0.7, 0.5]);
    const col = (c: number): [number, number, number] => [b[c * 3]!, b[c * 3 + 1]!, b[c * 3 + 2]!];
    const dot = (a: number[], v: number[]) => a[0]! * v[0]! + a[1]! * v[1]! + a[2]! * v[2]!;
    const [x, y, z] = [col(0), col(1), col(2)];
    for (const v of [x, y, z]) expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    expect(dot(x, y)).toBeCloseTo(0, 6);
    expect(dot(y, z)).toBeCloseTo(0, 6);
    expect(dot(x, z)).toBeCloseTo(0, 6);
  });
});

describe("upVectorAxis", () => {
  it("maps the six signed axes", () => {
    expect(upVectorAxis("x+")).toEqual([1, 0, 0]);
    expect(upVectorAxis("x-")).toEqual([-1, 0, 0]);
    expect(upVectorAxis("y+")).toEqual([0, 1, 0]);
    expect(upVectorAxis("y-")).toEqual([0, -1, 0]);
    expect(upVectorAxis("z+")).toEqual([0, 0, 1]);
    expect(upVectorAxis("z-")).toEqual([0, 0, -1]);
  });
});

describe("normClonerParams", () => {
  it("fills missing fields from the defaults (old linear/radial/grid docs degrade)", () => {
    const legacy = { mode: "grid", count: 12, step: [1, 0, 0] } as unknown as ClonerParams;
    const p = normClonerParams(legacy);
    expect(p.distribution).toBe("points");
    expect(p.orientation).toBe("normal");
    expect(p.upVector).toBe("y+");
    expect(p.hideTarget).toBe(false);
    expect(p.count).toBe(12); // a shared field is preserved
  });
});

describe("clonerInstanceMatrices", () => {
  it("emits 16 floats per instance", () => {
    const m = clonerInstanceMatrices(
      [at([0, 0, 0]), at([1, 0, 0]), at([2, 0, 0])],
      defaultClonerParams(),
    );
    expect(m).toHaveLength(3 * 16);
  });

  it("no effector → the instance basis + position pass through unchanged", () => {
    const m = clonerInstanceMatrices([at([5, 6, 7])], defaultClonerParams());
    expect(Array.from(m.slice(0, 12)).map(nz)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    expect(posOf(m, 0)).toEqual([5, 6, 7]);
  });

  it("is deterministic — same seed reproduces the same scatter", () => {
    const p: ClonerParams = {
      ...defaultClonerParams(),
      positionJitter: [1, 1, 1],
      rotationJitter: [0.5, 0.5, 0.5],
      scaleJitter: 0.3,
      seed: 42,
    };
    const insts = Array.from({ length: 20 }, (_, i) => at([i, 0, 0]));
    expect(Array.from(clonerInstanceMatrices(insts, p))).toEqual(
      Array.from(clonerInstanceMatrices(insts, p)),
    );
  });

  it("instance jitter is stable as the count grows (i doesn't move when N changes)", () => {
    const p: ClonerParams = { ...defaultClonerParams(), positionJitter: [1, 1, 1], seed: 7 };
    const insts = Array.from({ length: 50 }, () => at([0, 0, 0])); // isolate the effector
    const small = clonerInstanceMatrices(insts.slice(0, 5), p);
    const big = clonerInstanceMatrices(insts, p);
    // instances 0..4 are byte-identical whether N=5 or N=50
    expect(Array.from(big.slice(0, 5 * 16))).toEqual(Array.from(small));
  });

  it("adjacent instances get uncorrelated jitter (index mixed into the seed)", () => {
    const p: ClonerParams = { ...defaultClonerParams(), positionJitter: [1, 1, 1], seed: 100 };
    const m = clonerInstanceMatrices([at([0, 0, 0]), at([0, 0, 0])], p);
    expect(posOf(m, 0)).not.toEqual(posOf(m, 1));
  });
});
