import { describe, expect, it } from "vite-plus/test";
import { float } from "@/materials/tsl";
import { defaultNoiseParams, noiseDef, NOISE_DEFS, previewNode } from "./registry";

describe("noise registry", () => {
  it("has entries with unique ids", () => {
    expect(NOISE_DEFS.length).toBeGreaterThan(0);
    const ids = NOISE_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every param is well-formed with an in-range default", () => {
    for (const def of NOISE_DEFS) {
      expect(def.params.length).toBeGreaterThan(0);
      for (const p of def.params) {
        expect(p.min).toBeLessThan(p.max);
        expect(p.step).toBeGreaterThan(0);
        expect(p.default).toBeGreaterThanOrEqual(p.min);
        expect(p.default).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it("defaultNoiseParams covers every param key", () => {
    for (const def of NOISE_DEFS) {
      const vals = defaultNoiseParams(def);
      expect(Object.keys(vals).sort()).toEqual(def.params.map((p) => p.key).sort());
    }
  });

  it("noiseDef resolves by id", () => {
    for (const def of NOISE_DEFS) expect(noiseDef(def.id)).toBe(def);
    expect(noiseDef("nope")).toBeUndefined();
  });

  it("preview builds a TSL node graph for every noise (no compile, no GPU)", () => {
    const phase = float(0);
    for (const def of NOISE_DEFS) {
      const node = previewNode(def, defaultNoiseParams(def), phase);
      expect(node).toBeTruthy();
      // a TSL node exposes swizzles; a vec3 preview must have .r/.g/.b accessors
      expect(typeof node.rgb).toBe("object");
    }
  });
});
