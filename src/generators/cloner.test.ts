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

describe("step transform", () => {
  const three = () => [at([0, 0, 0]), at([0, 0, 0]), at([0, 0, 0])];
  /** The uniform scale of instance i (identity basis → column-0 length). */
  const scaleOf = (m: Float32Array, i: number) =>
    Math.hypot(m[i * 16]!, m[i * 16 + 1]!, m[i * 16 + 2]!);

  it("step position offsets clone i by i·step (clone 0 unchanged)", () => {
    const m = clonerInstanceMatrices(three(), {
      ...defaultClonerParams(),
      stepPosition: [2, 0, 0],
    });
    expect(posOf(m, 0)).toEqual([0, 0, 0]);
    expect(posOf(m, 1)).toEqual([2, 0, 0]);
    expect(posOf(m, 2)).toEqual([4, 0, 0]);
  });

  it("step scale multiplies clone i by step^i (clone 0 = 1)", () => {
    const m = clonerInstanceMatrices(three(), { ...defaultClonerParams(), stepScale: [2, 2, 2] });
    expect(scaleOf(m, 0)).toBeCloseTo(1, 6);
    expect(scaleOf(m, 1)).toBeCloseTo(2, 6);
    expect(scaleOf(m, 2)).toBeCloseTo(4, 6);
  });

  it("step rotation turns clone i by i·step (clone 0 unrotated, clone 1 rotated)", () => {
    const m = clonerInstanceMatrices(three(), {
      ...defaultClonerParams(),
      stepRotation: [0, Math.PI / 2, 0],
    });
    // clone 0 keeps the identity basis; clone 1 is rotated 90° about Y
    expect(Array.from(m.slice(0, 3)).map(nz)).toEqual([1, 0, 0]);
    const col0 = [nz(m[16]!), nz(m[17]!), nz(m[18]!)];
    expect(col0[0]).toBeCloseTo(0, 6);
    expect(Math.abs(col0[2]!)).toBeCloseTo(1, 6); // +X rotated into ±Z
  });

  it("defaults (no step) leave every clone identical to its base", () => {
    const m = clonerInstanceMatrices(three(), defaultClonerParams());
    for (let i = 0; i < 3; i++) {
      expect(scaleOf(m, i)).toBeCloseTo(1, 6);
      expect(posOf(m, i)).toEqual([0, 0, 0]);
    }
  });

  it("with an instance transform set, clone 0 is no longer the untouched base", () => {
    const m = clonerInstanceMatrices(three(), {
      ...defaultClonerParams(),
      instancePosition: [1, 2, 3],
      stepPosition: [2, 0, 0],
    });
    // clone 0 wears the instance offset; the step still accumulates on top
    expect(posOf(m, 0)).toEqual([1, 2, 3]);
    expect(posOf(m, 1)).toEqual([3, 2, 3]);
    expect(posOf(m, 2)).toEqual([5, 2, 3]);
  });
});

describe("instance transform", () => {
  const three = () => [at([0, 0, 0]), at([0, 0, 0]), at([0, 0, 0])];
  const scaleOf = (m: Float32Array, i: number, col: 0 | 1 | 2) =>
    Math.hypot(m[i * 16 + col * 4]!, m[i * 16 + col * 4 + 1]!, m[i * 16 + col * 4 + 2]!);

  it("position/scale apply identically to every clone", () => {
    const m = clonerInstanceMatrices(three(), {
      ...defaultClonerParams(),
      instancePosition: [1, 2, 3],
      instanceScale: [2, 3, 4],
    });
    for (let i = 0; i < 3; i++) {
      expect(posOf(m, i)).toEqual([1, 2, 3]);
      expect(scaleOf(m, i, 0)).toBeCloseTo(2, 5);
      expect(scaleOf(m, i, 1)).toBeCloseTo(3, 5);
      expect(scaleOf(m, i, 2)).toBeCloseTo(4, 5);
    }
  });

  it("rotation applies identically to every clone", () => {
    const m = clonerInstanceMatrices(three(), {
      ...defaultClonerParams(),
      instanceRotation: [0, Math.PI / 2, 0],
    });
    for (let i = 0; i < 3; i++) {
      // identity basis rotated 90° about Y: local +X lands on −Z
      const col0 = [m[i * 16]!, m[i * 16 + 1]!, m[i * 16 + 2]!];
      expect(col0[0]).toBeCloseTo(0, 6);
      expect(col0[1]).toBeCloseTo(0, 6);
      expect(col0[2]).toBeCloseTo(-1, 6);
    }
  });

  it("applies BEFORE the step: the step offset lands in the instance-rotated frame", () => {
    // 90° about Y turns the step's +X into −Z — clone i offsets by i·[0,0,−1],
    // which discriminates instance-first from step-first composition
    const m = clonerInstanceMatrices(three(), {
      ...defaultClonerParams(),
      instanceRotation: [0, Math.PI / 2, 0],
      stepPosition: [1, 0, 0],
    });
    for (let i = 0; i < 3; i++) {
      const p = posOf(m, i);
      expect(p[0]).toBeCloseTo(0, 5);
      expect(p[1]).toBeCloseTo(0, 5);
      expect(p[2]).toBeCloseTo(-i, 5);
    }
  });

  it("composes with step scale multiplicatively (instance · step^i)", () => {
    const m = clonerInstanceMatrices(three(), {
      ...defaultClonerParams(),
      instanceScale: [3, 3, 3],
      stepScale: [2, 2, 2],
    });
    expect(scaleOf(m, 0, 0)).toBeCloseTo(3, 5);
    expect(scaleOf(m, 1, 0)).toBeCloseTo(6, 5);
    expect(scaleOf(m, 2, 0)).toBeCloseTo(12, 4);
  });

  it("normClonerParams fills instance-transform fields on pre-feature docs", () => {
    const legacy = { distribution: "points", count: 5 } as unknown as ClonerParams;
    const p = normClonerParams(legacy);
    expect(p.instancePosition).toEqual([0, 0, 0]);
    expect(p.instanceRotation).toEqual([0, 0, 0]);
    expect(p.instanceScale).toEqual([1, 1, 1]);
  });
});
