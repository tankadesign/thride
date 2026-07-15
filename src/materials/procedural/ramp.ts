import { Color, DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from "three";
import type { GradientRamp } from "@/types/core";

/**
 * Gradient ramps as GPU data (E3). A {@link GradientRamp} bakes to a 256×1 RGBA
 * DataTexture that the compiled graph samples by the layer's scalar value.
 *
 * The point of the texture (rather than a chain of `mix` nodes) is the recompile
 * boundary: stops can be added, removed, moved and recolored by **rewriting the
 * texture's pixels in place**, so a ramp edit never changes the node graph. Only
 * the *presence* of a ramp is structural (see `structureKey`).
 */

/** Ramp texture width. 256 matches 8-bit output; more would be invisible. */
const RAMP_SIZE = 256;

const scratch = /*@__PURE__*/ new Color();

/**
 * Write `ramp` into `data` (RGBA8, RAMP_SIZE texels). Stops are sorted by `t`
 * and linearly interpolated in **linear** space (three's `Color.set` on a hex
 * converts from sRGB, matching how the rest of the material pipeline treats
 * authored colors).
 */
function writeRamp(ramp: GradientRamp, data: Uint8Array): void {
  const stops = [...ramp.stops].sort((a, b) => a.t - b.t);
  const first = stops[0];
  if (!first) {
    data.fill(0);
    return;
  }
  for (let i = 0; i < RAMP_SIZE; i++) {
    const t = i / (RAMP_SIZE - 1);
    // find the span containing t; clamp to the end stops outside the range
    let hi = stops.findIndex((s) => s.t >= t);
    if (hi === -1) hi = stops.length - 1;
    const lo = Math.max(0, hi - 1);
    const a = stops[lo] ?? first;
    const b = stops[hi] ?? first;
    const span = b.t - a.t;
    const f = span > 1e-6 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;

    scratch.set(a.color);
    const ar = scratch.r;
    const ag = scratch.g;
    const ab = scratch.b;
    scratch.set(b.color);
    const o = i * 4;
    data[o] = Math.round((ar + (scratch.r - ar) * f) * 255);
    data[o + 1] = Math.round((ag + (scratch.g - ag) * f) * 255);
    data[o + 2] = Math.round((ab + (scratch.b - ab) * f) * 255);
    data[o + 3] = 255;
  }
}

/**
 * A ramp's baked texture. `update` re-bakes into the SAME texture — call it on
 * a stop edit instead of rebuilding the graph.
 */
export class RampTexture {
  readonly texture: DataTexture;
  private readonly data: Uint8Array;

  constructor(ramp: GradientRamp) {
    this.data = new Uint8Array(RAMP_SIZE * 4);
    this.texture = new DataTexture(this.data, RAMP_SIZE, 1, RGBAFormat, UnsignedByteType);
    // linear filter so a 256-texel ramp reads smooth; no mips (1px tall)
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.update(ramp);
  }

  /** Re-bake `ramp` into the existing texture (no graph change, no recompile). */
  update(ramp: GradientRamp): void {
    writeRamp(ramp, this.data);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
