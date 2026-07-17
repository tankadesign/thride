import type { BlendMode } from "@/types/core";
import { max, min, mix, vec3, type Float, type Vec3 } from "@/materials/tsl";

/**
 * Blend-mode operators for the layer-stack compiler (E3). Each takes the
 * composite so far (`base`) and the layer's color (`layer`), both vec3 in
 * linear space, and returns the blended vec3 at FULL strength — the compiler
 * applies opacity afterward with a single `mix`, so opacity stays a live
 * uniform and is never baked into the operator.
 */

/** `overlay`: multiply where the base is dark, screen where it's light. */
const overlay = (base: Vec3, layer: Vec3): Vec3 => {
  const multiply = base.mul(layer).mul(2);
  const screen = base.add(layer).mul(2).sub(base.mul(layer).mul(2)).sub(1);
  // per-component select on base < 0.5, written as the branch-free lerp
  // `multiply·(1−s) + screen·s` (s a per-channel 0/1 step). This is what a
  // per-component `mix` computes, spelled out because @types/three's `mix`
  // only types a scalar interpolant — the step here is a vec3.
  const s = base.step(0.5);
  return multiply.mul(s.oneMinus()).add(screen.mul(s));
};

const OPS: Record<BlendMode, (base: Vec3, layer: Vec3) => Vec3> = {
  normal: (_base, layer) => layer,
  multiply: (base, layer) => base.mul(layer),
  screen: (base, layer) => base.add(layer).sub(base.mul(layer)),
  overlay,
  add: (base, layer) => base.add(layer),
  subtract: (base, layer) => base.sub(layer),
  difference: (base, layer) => base.sub(layer).abs(),
  min: (base, layer) => min(base, layer),
  max: (base, layer) => max(base, layer),
};

/**
 * Blend `layer` over `base` by `mode`, scaled by the `opacity` uniform node.
 * Opacity is applied as a lerp from the base, so 0 is always a no-op for every
 * mode (including `add`/`subtract`, where it otherwise wouldn't be).
 */
export function blendLayer(mode: BlendMode, base: Vec3, layer: Vec3, opacity: Float): Vec3 {
  return mix(base, vec3(OPS[mode](base, layer)), opacity);
}
