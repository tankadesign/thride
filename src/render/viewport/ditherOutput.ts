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
import { recurrentDenoise } from "three/examples/jsm/tsl/display/RecurrentDenoiseNode.js";
import { ssr } from "three/examples/jsm/tsl/display/SSRNode.js";
import { temporalReproject } from "three/examples/jsm/tsl/display/TemporalReprojectNode.js";
import {
  diffuseColor,
  dot,
  float,
  fract,
  materialMetalness,
  materialRoughness,
  metalness,
  mix,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  renderOutput,
  roughness,
  sample,
  screenCoordinate,
  smoothstep,
  texture,
  uniform,
  unpackRGBToNormal,
  vec2,
  vec3,
  vec4,
  velocity,
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

/** Screen-space reflection settings. */
export interface SsrParams {
  /** "fast" = gen-1 mirror + roughness-blur (deterministic, on-demand);
   * "high" = stochastic GGX + temporal denoise (accumulates, needs HDR env). */
  mode: "fast" | "high";
  maxDistance: number; // max reflection ray distance, world units
  thickness: number; // ray-hit thickness (view-depth gap counted as a hit)
  intensity: number; // reflection strength multiplier
  quality: number; // raymarch quality 0–1 (scales step count)
  blurQuality: number; // fast: roughness-blur mip passes 1–3 (compile-time)
  edgeFade: number; // screen-edge fade 0–1
  maxLuminance: number; // HDR firefly clamp
  resolution: number; // SSR render resolution scale 0.25–1
  reflectNonMetals: boolean; // fast: reflect dielectrics too (compile-time)
  roughnessFade: number; // fast: roughness where SSR fades to IBL (0 at rough=1)
  denoise: number; // high: recurrent-denoise strength
  maxFrames: number; // high: temporal accumulation window (frames)
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
  // --- "high" mode: temporal (stochastic + reproject + recurrent denoise) SSR ---
  /** Equirect HDR (RGBELoader, has image.data) for stochastic env misses. */
  // biome-ignore lint/suspicious/noExplicitAny: three Texture
  private ssrEnvTex: any = null;
  // biome-ignore lint/suspicious/noExplicitAny: TemporalReprojectNode not exported
  private tempReproject: any = null;
  // biome-ignore lint/suspicious/noExplicitAny: RecurrentDenoiseNode not exported
  private denoise: any = null;
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

  /**
   * The SSR scene pass's depth texture (previous frame) — primes the helper
   * overlay's depth so outlines/handles occlude correctly in SSR mode.
   */
  // biome-ignore lint/suspicious/noExplicitAny: DepthTexture via untyped PassNode
  get ssrDepthTexture(): any {
    return this.scenePass?.renderTarget?.depthTexture ?? null;
  }

  /** Size the HDR target to the renderer's drawing buffer (device pixels). */
  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.hdr.setSize(this.width, this.height);
    // three 0.185.1: RenderTarget.setSize doesn't update depthTexture.image —
    // set it so depth copies into it (SSR helper overlay) size the destination
    // correctly. NO dispose(): setSize already disposed the whole target on a
    // real size change; destroying the depth out-of-band leaves the backend's
    // cached render context submitting a destroyed texture (black viewport).
    const hdrDepth = this.hdr.depthTexture;
    if (hdrDepth?.image) {
      hdrDepth.image.width = this.width;
      hdrDepth.image.height = this.height;
    }
    this.aoNode?.setSize(this.width, this.height);
    if (this.denoise) {
      // The temporal graph holds internal history buffers (previous-depth AND
      // previous-normal) that three's setSize can't resize (0.185.1 bug — see
      // buildTemporalSsr). Rebuild at the new size instead of chasing each one;
      // resize is infrequent and the history reset just restarts convergence.
      this.rebuild();
    } else {
      this.ssrNode?.setSize(this.width, this.height);
      this.scenePass?.setSize(this.width, this.height);
    }
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
  setScreenReflections(
    scene: Scene | null,
    camera: Camera | null,
    params: SsrParams | null,
    // biome-ignore lint/suspicious/noExplicitAny: three Texture — high mode only
    envTex: any = null,
  ): void {
    const on = scene !== null && camera !== null && params !== null;
    const was = this.ssrScene !== null && this.ssrCamera !== null && this.ssrParams !== null;
    const targetChanged =
      camera !== this.ssrCamera || scene !== this.ssrScene || envTex !== this.ssrEnvTex;
    // The SSR pass only reflects changes made at graph-build time — poking its
    // uniforms live (even with post.needsUpdate) does NOT re-run the reflection
    // render. So any value change rebuilds. ViewportSystem hands a fresh params
    // object each frame, hence the field-by-field compare (else we'd rebuild
    // every frame). Rebuilding on a steady frame is skipped entirely.
    const changed = on !== was || targetChanged || this.ssrParamsDiffer(params, this.ssrParams);
    this.ssrScene = scene;
    this.ssrCamera = camera;
    this.ssrParams = params;
    this.ssrEnvTex = envTex;
    if (changed) this.rebuild();
  }

  private ssrParamsDiffer(a: SsrParams | null, b: SsrParams | null): boolean {
    if (a === b) return false;
    if (!a || !b) return true;
    return (
      a.mode !== b.mode ||
      a.maxDistance !== b.maxDistance ||
      a.thickness !== b.thickness ||
      a.intensity !== b.intensity ||
      a.quality !== b.quality ||
      a.blurQuality !== b.blurQuality ||
      a.edgeFade !== b.edgeFade ||
      a.maxLuminance !== b.maxLuminance ||
      a.resolution !== b.resolution ||
      a.reflectNonMetals !== b.reflectNonMetals ||
      a.roughnessFade !== b.roughnessFade ||
      a.denoise !== b.denoise ||
      a.maxFrames !== b.maxFrames
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
    this.tempReproject?.dispose?.();
    this.tempReproject = null;
    this.denoise?.dispose?.();
    this.denoise = null;
    this.scenePass?.dispose?.();
    this.scenePass = null;

    const ssrOn = this.ssrScene !== null && this.ssrCamera !== null && this.ssrParams !== null;

    // "high" mode: the stochastic + temporal-denoise chain owns the whole SSR
    // graph. Needs an equirect HDR env (falls back to plain gen-1 if none yet).
    if (ssrOn && this.ssrParams?.mode === "high" && this.ssrEnvTex) {
      this.buildTemporalSsr();
      return;
    }

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

    if (ssrOn) {
      // In SSR mode the viewport renders the interaction helpers (gizmo etc.)
      // into the otherwise-unused hdr buffer (transparent clear) — blend them
      // over the composite so the SSR pass never sees them in reflections.
      const helpers = texture(this.hdr.texture);
      composite = mix(composite.rgb, helpers.rgb, helpers.a);
    }
    const display = renderOutput(composite, THREE_TONE_MAPPING[this.mode]);
    // interleaved-gradient-noise dither, ±1 LSB, added in display space
    const p = screenCoordinate;
    const ign = fract(float(52.9829189).mul(fract(dot(p, vec2(0.06711056, 0.00583715)))));
    const d = ign.sub(0.5).mul(1 / 255);
    this.post.outputNode = display.add(vec3(d));
    this.post.needsUpdate = true;
  }

  /**
   * "High" SSR: stochastic GGX rays (SSRNode) → temporal reprojection →
   * recurrent denoise, accumulated across the render loop's convergence frames.
   * Mirrors three's webgpu_postprocessing_ssr_denoise example. Only the
   * reflection layer accumulates — the beauty/overlays render deterministically
   * each frame and stay stable (no camera jitter; TRAA is deferred). Requires an
   * equirect HDR env (`ssrEnvTex`) for off-screen ray misses.
   */
  private buildTemporalSsr(): void {
    const scene = this.ssrScene as Scene;
    const camera = this.ssrCamera as Camera;
    const params = this.ssrParams as SsrParams;

    // Temporal reprojection copies the pass depth into a single-sample history
    // buffer, so the pass must be single-sample (MSAA off, samples:0) — same
    // constraint as three's TRAA. The renderer is antialias:true (samples 4);
    // this override is required. The baseline viewport is already single-sample
    // (hdr target), so beauty AA is unchanged (a future TRAA pass would improve it).
    // biome-ignore lint/suspicious/noExplicitAny: PassNode not fully typed
    const scenePass: any = pass(scene, camera, { samples: 0 });
    // Packed G-buffer (example convention): metalness in diffuse.a, roughness
    // in the packed-normal .a, plus NDC motion vectors for reprojection.
    scenePass.setMRT(
      mrt({
        output,
        diffuseColor: vec4(diffuseColor.rgb, materialMetalness),
        normal: vec4(packNormalToRGB(normalView).rgb, materialRoughness),
        velocity,
      }),
    );
    this.scenePass = scenePass;
    // biome-ignore-start lint/suspicious/noExplicitAny: TSL node graph — loose by design
    const color: any = scenePass.getTextureNode("output");
    const depth: any = scenePass.getTextureNode("depth");
    const normalTex: any = scenePass.getTextureNode("normal"); // packed
    const diffTex: any = scenePass.getTextureNode("diffuseColor");
    const velTex: any = scenePass.getTextureNode("velocity");
    // SSR wants unpacked view-space normals; the denoiser wants the packed ones.
    const sceneNormal = sample((uv: any) => unpackRGBToNormal(normalTex.sample(uv).rgb));
    const metalRough = sample((uv: any) => vec2(diffTex.sample(uv).a, normalTex.sample(uv).a));

    const ssrNode: any = ssr(color, depth, sceneNormal, {
      stochastic: true,
      diffuseNode: diffTex,
      metalnessNode: diffTex.a,
      roughnessNode: normalTex.a,
      environmentNode: this.ssrEnvTex, // stochastic REQUIRES an equirect HDR
      // MIS (CDF-table) env sampling for rays that miss the screen. Without it,
      // naive BRDF sampling of an HDR is the persistent grain on surfaces whose
      // reflections point off-screen (walls, grazing angles) — noise that no
      // amount of accumulation visually settles.
      envImportanceSampling: true,
      binaryRefine: true, // sub-step hit refinement — crisper contact points
      camera,
    });
    ssrNode.resolutionScale = clamp(params.resolution, 0.25, 1);
    ssrNode.setSize(this.width, this.height);
    this.ssrNode = ssrNode;
    this.applySsrParams(params); // maxDistance/thickness/intensity/quality

    const maxFrames = Math.max(1, Math.round(params.maxFrames));
    const tr: any = temporalReproject(ssrNode, depth, normalTex, velTex, camera, {
      mode: "specular",
      accumulate: false,
    });
    tr.maxFrames.value = maxFrames; // accumulation window = the converge burst
    // Relax the neighborhood clamp: at the strict default (1) the reproject
    // clamps history to the CURRENT noisy frame's local min/max, re-injecting
    // stochastic grain every frame — accumulation converges to a structured
    // residual no maxFrames/denoise setting can remove (measured: grain frozen
    // at ~1.47 for 32 AND 64 frames; 0.25 + denoise 1 → ~1.31 and visually
    // clean). Static-view ghosting risk is low; disocclusion handling remains.
    tr.clampIntensity.value = 0.25;
    tr.setSize(this.width, this.height);
    // three 0.185.1 bug: RenderTarget.setSize resizes color attachments but NOT
    // depthTexture, so the history RT's depth stays 1×1 and its per-frame
    // copyTextureToTexture(sceneDepth → historyDepth) fails validation. Size the
    // history depth to match (fresh node → GPU texture not yet allocated).
    const histDepth = tr._historyRenderTarget?.depthTexture;
    if (histDepth?.image) {
      histDepth.image.width = this.width;
      histDepth.image.height = this.height;
    }
    this.tempReproject = tr;

    const dn: any = recurrentDenoise(tr, camera, {
      depth,
      normal: normalTex,
      raw: ssrNode,
      metalRoughness: metalRough,
      mode: "specular",
      accumulate: true,
    });
    dn.alphaSource = "raylength";
    dn.strength.value = clamp(params.denoise, 0, 1);
    dn.maxFrames.value = maxFrames;
    dn.setSize(this.width, this.height);
    this.denoise = dn;

    // feedback: denoised result becomes next frame's history
    ssrNode.setHistory(dn, velTex);
    tr.setHistoryTexture(dn);

    // Ambient Shadows ride along in High mode too (normals auto-derived from
    // the pass depth — the MRT normals are packed, which GTAO can't read).
    // biome-ignore lint/suspicious/noExplicitAny: TSL node graph — loose by design
    let beauty: any = color;
    if (this.aoCamera && this.aoParams) {
      const aoPass = ao(depth, null as any, this.aoCamera);
      aoPass.resolutionScale = Math.min(1, Math.max(0.1, this.aoParams.resolution));
      aoPass.setSize(this.width, this.height);
      this.aoNode = aoPass;
      this.applyAoParams(this.aoParams);
      const occ = aoPass.getTextureNode().r;
      const tint = new Color(this.aoParams.tint);
      const aoFactor = mix(vec3(tint.r, tint.g, tint.b), vec3(1, 1, 1), occ);
      beauty = color.mul(aoFactor);
    }

    const litColor = beauty.rgb.add(dn.rgb);
    // helpers rendered into the (unused) hdr buffer — blend over the composite
    // so the SSR pass never sees them in reflections (see rebuild's ssrOn note)
    const helpers = texture(this.hdr.texture);
    const withHelpers = mix(litColor, helpers.rgb, helpers.a);
    // biome-ignore-end lint/suspicious/noExplicitAny: TSL node graph — loose by design
    const display = renderOutput(withHelpers, THREE_TONE_MAPPING[this.mode]);
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
    this.tempReproject?.dispose?.();
    this.denoise?.dispose?.();
    this.scenePass?.dispose?.();
    this.post.dispose();
  }
}
