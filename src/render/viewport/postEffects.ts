import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { chromaticAberration } from "three/examples/jsm/tsl/display/ChromaticAberrationNode.js";
import { screenUV, uniform, vec2, vec4 } from "@/materials/tsl";

/**
 * The post-FX stack (chunk C6) — bloom, chromatic aberration and vignette, as
 * TSL applied around the output tail in `DitherOutput.composeOutput`.
 *
 * The stack is split across the tone-map boundary, and the split is physical,
 * not cosmetic:
 * - **Bloom is HDR-domain**, before `renderOutput`. It thresholds on luminance,
 *   and tone mapping squashes every bright value toward 1 — so a post-tone-map
 *   bloom can't tell a lit surface from an actual highlight.
 * - **Chromatic aberration and vignette are display-domain**, after it. They're
 *   lens artifacts: they act on the developed image, and a vignette applied in
 *   HDR would simply be re-brightened by the tone curve.
 *
 * Bloom and chromatic aberration are three's own nodes rather than hand-rolled.
 * Vignette is ours because it's a radial multiply that needs no resampling —
 * three has no standalone vignette node (only one buried inside CRT.js).
 *
 * Every continuous parameter is a live `uniform()`, so dragging a slider pokes
 * `.value` with no graph rebuild — the AO setter's shape, not SSR's. Only
 * turning an effect on/off is structural; see {@link effectsDiffer}.
 */

// biome-ignore lint/suspicious/noExplicitAny: TSL node
type Node = any;

/** Per-pane post-FX settings, unpacked from `PaneDisplay` at the call boundary. */
export interface PostFxParams {
  bloom: boolean;
  /** Luminance above which pixels bloom. */
  bloomThreshold: number;
  bloomStrength: number;
  /** Bloom spread, in three's BloomNode units. */
  bloomRadius: number;
  chromatic: boolean;
  /** Channel separation strength (0 at the center, growing outward). */
  chromaticAmount: number;
  vignette: boolean;
  /** 0 = none, 1 = heavy corner darkening. */
  vignetteAmount: number;
  /** Where the falloff starts: 0 = from the center, 1 = only at the corners. */
  vignetteRadius: number;
}

/** Live uniform handles + the built nodes for one compiled stack. */
export interface PostFxState {
  params: PostFxParams;
  bloomNode: Node | null;
  bloomStrength: Node;
  bloomRadius: Node;
  chromaticAmount: Node;
  vignetteAmount: Node;
  vignetteRadius: Node;
}

export const defaultPostFxParams = (): PostFxParams => ({
  bloom: false,
  bloomThreshold: 0.9,
  bloomStrength: 0.35,
  bloomRadius: 0.6,
  chromatic: false,
  chromaticAmount: 1,
  vignette: false,
  vignetteAmount: 0.4,
  vignetteRadius: 0.5,
});

/**
 * Which fields force a graph rebuild: ONLY the on/off toggles, since those add
 * or remove nodes. Every continuous value is a live uniform — including bloom's
 * threshold, which BloomNode wraps in a uniform of its own and exposes.
 */
export function effectsDiffer(a: PostFxParams, b: PostFxParams): boolean {
  return a.bloom !== b.bloom || a.chromatic !== b.chromatic || a.vignette !== b.vignette;
}

/** Build the uniforms + bloom node for `params`. Call only on a rebuild. */
export function buildPostFx(params: PostFxParams, hdrColor: Node): PostFxState {
  const bloomStrength = uniform(params.bloomStrength);
  const bloomRadius = uniform(params.bloomRadius);
  return {
    params,
    // threshold goes in as a plain number: BloomNode promotes it to a uniform
    // and exposes it as `.threshold`, which updatePostFx pokes
    bloomNode: params.bloom
      ? bloom(hdrColor, bloomStrength, bloomRadius, params.bloomThreshold)
      : null,
    bloomStrength,
    bloomRadius,
    chromaticAmount: uniform(params.chromaticAmount),
    vignetteAmount: uniform(params.vignetteAmount),
    vignetteRadius: uniform(params.vignetteRadius),
  };
}

/** Push new values into the live uniforms — no rebuild. */
export function updatePostFx(fx: PostFxState, params: PostFxParams): void {
  fx.params = params;
  fx.bloomStrength.value = params.bloomStrength;
  fx.bloomRadius.value = params.bloomRadius;
  if (fx.bloomNode) fx.bloomNode.threshold.value = params.bloomThreshold;
  fx.chromaticAmount.value = params.chromaticAmount;
  fx.vignetteAmount.value = params.vignetteAmount;
  fx.vignetteRadius.value = params.vignetteRadius;
}

/** HDR-domain effects (before tone mapping): bloom, added over the scene. */
export function applyHdrEffects(color: Node, fx: PostFxState | null): Node {
  if (!fx?.bloomNode) return color;
  return color.add(fx.bloomNode);
}

/** Display-domain effects (after tone mapping): chromatic aberration, vignette. */
export function applyDisplayEffects(display: Node, fx: PostFxState | null): Node {
  if (!fx) return display;
  let out = display;
  // three's node resamples the input at per-channel offsets — it wraps the
  // expression in a render target itself (convertToTexture), which is why this
  // can take the composited display rather than needing a raw texture.
  // The center MUST be passed: three's signature defaults it to null and its
  // docs claim null means screen-center, but nothing implements that fallback —
  // `nodeObject(null)` stays null and the node throws at build (black viewport).
  if (fx.params.chromatic) out = chromaticAberration(out, fx.chromaticAmount, vec2(0.5, 0.5));
  if (fx.params.vignette) out = vignette(out, fx.vignetteAmount, fx.vignetteRadius);
  return out;
}

/**
 * Corner darkening: smooth falloff from `radius` outward, scaled by `amount`.
 * Multiplies rgb only — scaling alpha here would make the vignette eat the
 * canvas's transparency rather than darken the image.
 */
function vignette(display: Node, amount: Node, radius: Node): Node {
  // distance from center, normalized so the CORNER is 1 (not the edge)
  const d = screenUV.sub(vec2(0.5, 0.5)).length().mul(Math.SQRT2);
  const t = d.sub(radius).div(radius.oneMinus().max(1e-4)).clamp(0, 1);
  // smoothstep the ramp so the falloff has no visible onset edge
  const s = t.mul(t).mul(t.mul(-2).add(3));
  return vec4(display.rgb.mul(s.mul(amount).oneMinus()), display.a);
}
