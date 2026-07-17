import { describe, expect, it } from "vite-plus/test";
import { RampTexture } from "./ramp";

/**
 * Ramps are the one part of a layer that carries per-pixel data rather than a
 * uniform, so "a stop edit never recompiles" rests on the texture being
 * re-baked IN PLACE. These assert the pixels really change and the texture
 * identity really doesn't.
 */

const texels = (r: RampTexture): Uint8Array => r.texture.image.data as Uint8Array;
/** RGB triple at ramp position `t` (0–1). */
const at = (r: RampTexture, t: number): [number, number, number] => {
  const i = Math.round(t * 255) * 4;
  const d = texels(r);
  return [d[i]!, d[i + 1]!, d[i + 2]!];
};

describe("RampTexture", () => {
  it("bakes a black→white ramp across 256 texels", () => {
    const r = new RampTexture({
      stops: [
        { t: 0, color: "#000000" },
        { t: 1, color: "#ffffff" },
      ],
    });
    expect(at(r, 0)).toEqual([0, 0, 0]);
    expect(at(r, 1)).toEqual([255, 255, 255]);
    // monotonic in between (mid is ~half in LINEAR space, not sRGB's 128)
    const mid = at(r, 0.5)[0];
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(255);
    expect(r.texture.image.width).toBe(256);
  });

  it("re-bakes in place: same texture object, new pixels, re-upload flagged", () => {
    const r = new RampTexture({
      stops: [
        { t: 0, color: "#000000" },
        { t: 1, color: "#ffffff" },
      ],
    });
    const tex = r.texture;
    const buf = texels(r);
    // `needsUpdate` is a set-only accessor on three's Texture — it bumps
    // `version`, which is the readable evidence the GPU will re-upload
    const version = tex.version;

    r.update({
      stops: [
        { t: 0, color: "#ff0000" },
        { t: 1, color: "#ff0000" },
      ],
    });

    expect(r.texture).toBe(tex); // identity held ⇒ the node graph is untouched
    expect(texels(r)).toBe(buf); // same backing buffer, rewritten
    expect(tex.version).toBeGreaterThan(version);
    expect(at(r, 0)).toEqual([255, 0, 0]);
    expect(at(r, 1)).toEqual([255, 0, 0]);
  });

  it("clamps outside the stop range instead of fading to black", () => {
    const r = new RampTexture({
      stops: [
        { t: 0.4, color: "#ffffff" },
        { t: 0.6, color: "#ffffff" },
      ],
    });
    expect(at(r, 0)).toEqual([255, 255, 255]);
    expect(at(r, 1)).toEqual([255, 255, 255]);
  });

  it("sorts unordered stops", () => {
    const r = new RampTexture({
      stops: [
        { t: 1, color: "#ffffff" },
        { t: 0, color: "#000000" },
      ],
    });
    expect(at(r, 0)).toEqual([0, 0, 0]);
    expect(at(r, 1)).toEqual([255, 255, 255]);
  });

  it("an empty ramp is transparent black, not a crash", () => {
    const r = new RampTexture({ stops: [] });
    expect(at(r, 0.5)).toEqual([0, 0, 0]);
  });
});
