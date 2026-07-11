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
  type ToneMapping,
} from "three";
import { PostProcessing, RenderTarget, type WebGPURenderer } from "three/webgpu";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import {
  dot,
  float,
  fract,
  mix,
  renderOutput,
  screenCoordinate,
  texture,
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
}

const THREE_TONE_MAPPING: Record<OutputToneMapping, ToneMapping> = {
  none: NoToneMapping,
  agx: AgXToneMapping,
  aces: ACESFilmicToneMapping,
  neutral: NeutralToneMapping,
};

/**
 * HDR-buffer + dithered output pass, optionally with Ambient Shadows (GTAO).
 *
 * Smooth lighting gradients band because the tone-mapped result is quantized
 * straight to the 8-bit canvas; the fix is to render the scene LINEAR into a
 * half-float target, then apply tone mapping + a ±1-LSB ordered dither in
 * display space before the 8-bit write. When Ambient Shadows are on, a GTAO
 * pass reads the target's depth and darkens creases multiplicatively (tinted,
 * in linear space) before tone mapping — Spline's "Ambient Shadows" look.
 * The scene renders into `hdr`; `render()` composites it to the canvas.
 */
export class DitherOutput {
  readonly hdr: RenderTarget;
  private readonly post: PostProcessing;
  private mode: OutputToneMapping = "aces";
  private aoCamera: Camera | null = null;
  private aoParams: AmbientShadowParams | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: GTAONode type not exported
  private aoNode: any = null;
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

  private applyAoParams(p: AmbientShadowParams): void {
    if (!this.aoNode) return;
    this.aoNode.radius.value = Math.max(0.01, p.radius);
    this.aoNode.thickness.value = Math.max(0.01, p.bias);
    this.aoNode.samples.value = Math.max(4, Math.round(p.samples));
  }

  private rebuild(): void {
    const hdrColor = texture(this.hdr.texture);
    // biome-ignore lint/suspicious/noExplicitAny: TSL node graph — loose by design
    let color: any = hdrColor;
    this.aoNode?.dispose?.(); // free the previous GTAO pass's render target
    this.aoNode = null;
    if (this.aoCamera && this.aoParams) {
      // GTAO from the linear depth; normals auto-derived (no MRT needed)
      const depth = texture(this.hdr.depthTexture as NonNullable<typeof this.hdr.depthTexture>);
      // biome-ignore lint/suspicious/noExplicitAny: ao() normalNode is optional
      const aoPass = ao(depth, null as any, this.aoCamera);
      aoPass.radius.value = Math.max(0.01, this.aoParams.radius);
      aoPass.thickness.value = Math.max(0.01, this.aoParams.bias);
      aoPass.samples.value = Math.max(4, Math.round(this.aoParams.samples));
      aoPass.setSize(this.width, this.height);
      this.aoNode = aoPass;
      const occ = aoPass.getTextureNode().r; // 1 = lit, 0 = fully occluded
      const tint = new Color(this.aoParams.tint);
      // occluded areas fade the HDR color toward the tint (linear, pre-tonemap)
      const aoFactor = mix(vec3(tint.r, tint.g, tint.b), vec3(1, 1, 1), occ);
      color = hdrColor.mul(aoFactor);
    }
    const display = renderOutput(color, THREE_TONE_MAPPING[this.mode]);
    // interleaved-gradient-noise dither, ±1 LSB, added in display space
    const p = screenCoordinate;
    const ign = fract(float(52.9829189).mul(fract(dot(p, vec2(0.06711056, 0.00583715)))));
    const d = ign.sub(0.5).mul(1 / 255);
    this.post.outputNode = display.add(vec3(d));
    this.post.needsUpdate = true;
  }

  /** Blit the HDR buffer to the current render target (the canvas). */
  render(): void {
    this.post.render();
  }

  dispose(): void {
    this.hdr.dispose();
    this.post.dispose();
  }
}
