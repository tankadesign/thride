import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  type Camera,
  Color,
  DepthTexture,
  HalfFloatType,
  LinearSRGBColorSpace,
  NeutralToneMapping,
  NoToneMapping,
  type Scene,
  type ToneMapping,
} from "three";
import { PostProcessing, RenderTarget, type WebGPURenderer } from "three/webgpu";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { ssr } from "three/examples/jsm/tsl/display/SSRNode.js";
import {
  dot,
  float,
  fract,
  metalness,
  mix,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  roughness,
  screenCoordinate,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from "@/materials/tsl";
import type { ToneMappingMode } from "@/types/editor";

/** "none" = non-PBR panes (wireframe/flat) skip tone mapping. */
export type OutputToneMapping = ToneMappingMode | "none";

/** Ambient-occlusion ("Ambient Shadows") settings — a GTAO pass. */
export interface AmbientShadowParams {
  radius: number; // sample radius, world units
  bias: number; // horizon thickness (hides thin-surface haloing)
  tint: string; // hex — the color occluded areas darken toward
  samples: number; // quality (more = smoother, slower)
  falloff: number; // distance falloff (0–1)
  distanceExp: number; // sample-distribution exponent
  scale: number; // AO contrast (ao = pow(ao, scale))
  resolution: number; // AO render resolution scale (0–1, perf)
}

/** Screen-space reflection settings — a first-gen (mirror + roughness-blur) SSR pass. */
export interface SsrParams {
  maxDistance: number; // max reflection ray distance, world units
  thickness: number; // ray-hit thickness (view-depth gap counted as a hit)
  intensity: number; // reflection strength multiplier
  quality: number; // raymarch quality 0–1 (scales step count)
  blurQuality: number; // roughness-blur mip passes 1–3 (compile-time)
  edgeFade: number; // screen-edge fade 0–1
  maxLuminance: number; // HDR firefly clamp
  resolution: number; // SSR render resolution scale 0.25–1
  reflectNonMetals: boolean; // reflect dielectrics too (compile-time)
  roughnessFade: number; // roughness where SSR starts fading to IBL (0 at rough=1)
}

const THREE_TONE_MAPPING: Record<OutputToneMapping, ToneMapping> = {
  none: NoToneMapping,
  agx: AgXToneMapping,
  aces: ACESFilmicToneMapping,
  neutral: NeutralToneMapping,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * HDR-buffer + dithered output pass, optionally with Ambient Shadows (GTAO)
 * and Screen-Space Reflections (SSR).
 *
 * Smooth lighting gradients band because the tone-mapped result is quantized
 * straight to the 8-bit canvas; the fix is to render the scene LINEAR into a
 * half-float target, then apply tone mapping + a ±1-LSB ordered dither in
 * display space before the 8-bit write.
 *
 * Two graph modes:
 * - **default:** the scene is rendered by the viewport into `hdr`; this pass
 *   reads `hdr.texture` (+ `hdr.depthTexture` for GTAO, normals auto-derived).
 * - **SSR active:** the scene render moves INTO the node graph via a
 *   `pass(scene, camera)` with an MRT G-buffer (output/normal/metalness/
 *   roughness) — SSRNode needs real view-space normals, which depth-only can't
 *   supply. SSR (and GTAO, now from the pass normals) composite over the beauty
 *   pass. SSR is single-pane + PBR-only, so the manual multi-pane path is never
 *   disturbed.
 */
export class DitherOutput {
  readonly hdr: RenderTarget;
  private readonly post: PostProcessing;
  private mode: OutputToneMapping = "aces";
  private aoCamera: Camera | null = null;
  private aoParams: AmbientShadowParams | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: GTAONode type not exported
  private aoNode: any = null;
  private ssrScene: Scene | null = null;
  private ssrCamera: Camera | null = null;
  private ssrParams: SsrParams | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: SSRNode type not exported
  private ssrNode: any = null;
  // biome-ignore lint/suspicious/noExplicitAny: PassNode type not exported
  private scenePass: any = null;
  // roughness at which SSR fades to IBL — a uniform so it live-tweaks
  // biome-ignore lint/suspicious/noExplicitAny: TSL uniform node
  private ssrFadeStart: any = null;
  private width = 1;
  private height = 1;

  constructor(renderer: WebGPURenderer) {
    this.hdr = new RenderTarget(1, 1, {
      type: HalfFloatType, // linear HDR — no quantization until the final blit
      colorSpace: LinearSRGBColorSpace,
      depthTexture: new DepthTexture(1, 1), // sampleable depth for GTAO
    });
    this.post = new PostProcessing(renderer);
    // we do tone mapping + color-space ourselves in outputNode via renderOutput
    this.post.outputColorTransform = false;
    this.rebuild();
  }

  /** Size the HDR target to the renderer's drawing buffer (device pixels). */
  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.hdr.setSize(this.width, this.height);
    this.aoNode?.setSize(this.width, this.height);
    this.ssrNode?.setSize(this.width, this.height);
    this.scenePass?.setSize(this.width, this.height);
  }

  /** Tone mapping for the whole composite (the active pane's). */
  setToneMapping(mode: OutputToneMapping): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.rebuild();
  }

  /**
   * Enable/disable Ambient Shadows (GTAO). `camera` is the active pane's; a
   * null camera or params turns AO off. Rebuilds the graph only on real change.
   */
  setAmbientShadows(camera: Camera | null, params: AmbientShadowParams | null): void {
    const on = camera !== null && params !== null;
    const was = this.aoCamera !== null && this.aoParams !== null;
    const cameraChanged = camera !== this.aoCamera;
    this.aoCamera = camera;
    this.aoParams = params;
    if (on && params && this.aoNode && !cameraChanged) {
      // live param tweak — no graph rebuild needed
      this.applyAoParams(params);
      return;
    }
    if (on !== was || cameraChanged) this.rebuild();
    else if (params) this.applyAoParams(params);
  }

  /**
   * Enable/disable Screen-Space Reflections. A null scene/camera/params turns
   * SSR off (back to the plain `hdr` graph). Live uniform tweaks skip the
   * rebuild; enable/disable, camera or scene swap, and compile-time param
   * changes (blur quality, reflect-non-metals) rebuild the pass graph.
   */
  setScreenReflections(scene: Scene | null, camera: Camera | null, params: SsrParams | null): void {
    const on = scene !== null && camera !== null && params !== null;
    const was = this.ssrScene !== null && this.ssrCamera !== null && this.ssrParams !== null;
    const targetChanged = camera !== this.ssrCamera || scene !== this.ssrScene;
    // The SSR pass only reflects changes made at graph-build time — poking its
    // uniforms live (even with post.needsUpdate) does NOT re-run the reflection
    // render. So any value change rebuilds. ViewportSystem hands a fresh params
    // object each frame, hence the field-by-field compare (else we'd rebuild
    // every frame). Rebuilding on a steady frame is skipped entirely.
    const changed = on !== was || targetChanged || this.ssrParamsDiffer(params, this.ssrParams);
    this.ssrScene = scene;
    this.ssrCamera = camera;
    this.ssrParams = params;
    if (changed) this.rebuild();
  }

  private ssrParamsDiffer(a: SsrParams | null, b: SsrParams | null): boolean {
    if (a === b) return false;
    if (!a || !b) return true;
    return (
      a.maxDistance !== b.maxDistance ||
      a.thickness !== b.thickness ||
      a.intensity !== b.intensity ||
      a.quality !== b.quality ||
      a.blurQuality !== b.blurQuality ||
      a.edgeFade !== b.edgeFade ||
      a.maxLuminance !== b.maxLuminance ||
      a.resolution !== b.resolution ||
      a.reflectNonMetals !== b.reflectNonMetals ||
      a.roughnessFade !== b.roughnessFade
    );
  }

  private applyAoParams(p: AmbientShadowParams): void {
    const n = this.aoNode;
    if (!n) return;
    n.radius.value = Math.max(0.01, p.radius);
    n.thickness.value = Math.max(0.01, p.bias);
    n.samples.value = Math.max(4, Math.round(p.samples));
    n.distanceFallOff.value = Math.min(1, Math.max(0, p.falloff));
    n.distanceExponent.value = Math.max(0.1, p.distanceExp);
    n.scale.value = Math.max(0.1, p.scale);
    // resolutionScale is a plain property; the AO target must resize to take it
    const res = Math.min(1, Math.max(0.1, p.resolution));
    if (n.resolutionScale !== res) {
      n.resolutionScale = res;
      n.setSize(this.width, this.height);
    }
  }

  private applySsrParams(p: SsrParams): void {
    const n = this.ssrNode;
    if (!n) return;
    n.maxDistance.value = Math.max(0, p.maxDistance);
    n.thickness.value = Math.max(0.001, p.thickness);
    n.intensity.value = Math.max(0, p.intensity);
    n.quality.value = clamp(p.quality, 0, 1);
    n.screenEdgeFade.value = clamp(p.edgeFade, 0, 1);
    n.maxLuminance.value = Math.max(0.001, p.maxLuminance);
    // fade edge < 1 so the smoothstep(fadeStart, 1) below stays well-formed
    if (this.ssrFadeStart) this.ssrFadeStart.value = clamp(p.roughnessFade, 0, 0.99);
    // resolutionScale is a plain property; the SSR target must resize to take it
    const res = clamp(p.resolution, 0.25, 1);
    if (n.resolutionScale !== res) {
      n.resolutionScale = res;
      n.setSize(this.width, this.height);
    }
  }

  private rebuild(): void {
    // free the previous effect passes' render targets
    this.aoNode?.dispose?.();
    this.aoNode = null;
    this.ssrNode?.dispose?.();
    this.ssrNode = null;
    this.ssrFadeStart = null;
    this.scenePass?.dispose?.();
    this.scenePass = null;

    const ssrOn = this.ssrScene !== null && this.ssrCamera !== null && this.ssrParams !== null;

    // Beauty + G-buffer source: an in-graph MRT pass when SSR is on (real
    // view-space normals / metalness / roughness), else the viewport's hdr blit.
    // biome-ignore lint/suspicious/noExplicitAny: TSL node graph — loose by design
    let color: any;
    // biome-ignore lint/suspicious/noExplicitAny: TSL node graph — loose by design
    let depthNode: any;
    // biome-ignore lint/suspicious/noExplicitAny: null → GTAO auto-derives normals
    let normalNode: any = null;
    // biome-ignore lint/suspicious/noExplicitAny: TSL node graph — loose by design
    let metalNode: any = null;
    // biome-ignore lint/suspicious/noExplicitAny: TSL node graph — loose by design
    let roughNode: any = null;
    if (ssrOn) {
      const scenePass = pass(this.ssrScene as Scene, this.ssrCamera as Camera);
      scenePass.setMRT(mrt({ output, normal: normalView, metalness, roughness }));
      this.scenePass = scenePass;
      color = scenePass.getTextureNode("output");
      depthNode = scenePass.getTextureNode("depth");
      normalNode = scenePass.getTextureNode("normal"); // view-space (SSR math is view-space)
      metalNode = scenePass.getTextureNode("metalness");
      roughNode = scenePass.getTextureNode("roughness");
    } else {
      color = texture(this.hdr.texture);
      depthNode = texture(this.hdr.depthTexture as NonNullable<typeof this.hdr.depthTexture>);
    }

    // biome-ignore lint/suspicious/noExplicitAny: TSL node graph — loose by design
    let composite: any = color;

    // Ambient Shadows (GTAO): multiplies creases toward a tint, pre-tone-map.
    // Uses the pass's real normals when SSR is on, else auto-derives from depth.
    if (this.aoCamera && this.aoParams) {
      const aoPass = ao(depthNode, normalNode, this.aoCamera);
      aoPass.resolutionScale = Math.min(1, Math.max(0.1, this.aoParams.resolution));
      aoPass.setSize(this.width, this.height);
      this.aoNode = aoPass;
      this.applyAoParams(this.aoParams); // radius/thickness/samples/falloff/exp/scale
      const occ = aoPass.getTextureNode().r; // 1 = lit, 0 = fully occluded
      const tint = new Color(this.aoParams.tint);
      const aoFactor = mix(vec3(tint.r, tint.g, tint.b), vec3(1, 1, 1), occ);
      composite = composite.mul(aoFactor);
    }

    // Screen-Space Reflections: the node output is pre-weighted by metalness +
    // intensity and roughness-blurred; add it over the (AO-darkened) beauty.
    if (ssrOn && this.ssrParams) {
      const ssrNode = ssr(color, depthNode, normalNode, {
        metalnessNode: metalNode,
        roughnessNode: roughNode, // drives the internal blur mip → "distance blur"
        reflectNonMetals: this.ssrParams.reflectNonMetals,
        camera: this.ssrCamera as Camera,
      });
      ssrNode.blurQuality = clamp(Math.round(this.ssrParams.blurQuality), 1, 3);
      ssrNode.resolutionScale = clamp(this.ssrParams.resolution, 0.25, 1);
      ssrNode.setSize(this.width, this.height);
      this.ssrNode = ssrNode;
      // SSR's mirror+blur can't reach a true diffuse gather, so fade its
      // contribution to zero as roughness → 1 and let the IBL/PMREM env
      // reflection (already the correct wide blur) take over. `roughNode.r`
      // is the per-pixel material roughness from the MRT G-buffer.
      const fadeStart = uniform(clamp(this.ssrParams.roughnessFade, 0, 0.99));
      this.ssrFadeStart = fadeStart;
      const fade = smoothstep(fadeStart, float(1), roughNode.r).oneMinus();
      this.applySsrParams(this.ssrParams); // maxDistance/thickness/intensity/quality/fade
      composite = composite.add(ssrNode.getTextureNode().rgb.mul(fade));
    }

    const display = renderOutput(composite, THREE_TONE_MAPPING[this.mode]);
    // interleaved-gradient-noise dither, ±1 LSB, added in display space
    const p = screenCoordinate;
    const ign = fract(float(52.9829189).mul(fract(dot(p, vec2(0.06711056, 0.00583715)))));
    const d = ign.sub(0.5).mul(1 / 255);
    this.post.outputNode = display.add(vec3(d));
    this.post.needsUpdate = true;
  }

  /** Blit the HDR buffer (or render the SSR pass graph) to the canvas. */
  render(): void {
    this.post.render();
  }

  dispose(): void {
    this.hdr.dispose();
    this.aoNode?.dispose?.();
    this.ssrNode?.dispose?.();
    this.scenePass?.dispose?.();
    this.post.dispose();
  }
}
