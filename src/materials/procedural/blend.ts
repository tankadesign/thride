import type { BlendMode } from "@/types/core";
import { max, min, mix, vec3 } from "@/materials/tsl";

/**
 * Blend-mode operators for the layer-stack compiler (E3). Each takes the
 * composite so far (`base`) and the layer's color (`layer`), both vec3 in
 * linear space, and returns the blended vec3 at FULL strength — the compiler
 * applies opacity afterward with a single `mix`, so opacity stays a live
 * uniform and is never baked into the operator.
 */

// biome-ignore lint/suspicious/noExplicitAny: TSL node
type Node = any;

/** `overlay`: multiply where the base is dark, screen where it's light. */
const overlay = (base: Node, layer: Node): Node => {
  const multiply = base.mul(layer).mul(2);
  const screen = base.add(layer).mul(2).sub(base.mul(layer).mul(2)).sub(1);
  // per-component select on base < 0.5 — `mix` with a 0/1 step is the
  // branch-free form and keeps this a plain expression node
  return mix(multiply, screen, base.step(0.5));
};

const OPS: Record<BlendMode, (base: Node, layer: Node) => Node> = {
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
export function blendLayer(mode: BlendMode, base: Node, layer: Node, opacity: Node): Node {
  return mix(base, vec3(OPS[mode](base, layer)), opacity);
}
