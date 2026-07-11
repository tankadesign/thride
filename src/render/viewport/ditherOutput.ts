import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  HalfFloatType,
  LinearSRGBColorSpace,
  NeutralToneMapping,
  NoToneMapping,
  type ToneMapping,
} from "three";
import { PostProcessing, RenderTarget, type WebGPURenderer } from "three/webgpu";
import {
  dot,
  float,
  fract,
  renderOutput,
  screenCoordinate,
  texture,
  vec2,
  vec3,
} from "@/materials/tsl";
import type { ToneMappingMode } from "@/types/editor";

/** "none" = non-PBR panes (wireframe/flat) skip tone mapping. */
export type OutputToneMapping = ToneMappingMode | "none";

const THREE_TONE_MAPPING: Record<OutputToneMapping, ToneMapping> = {
  none: NoToneMapping,
  agx: AgXToneMapping,
  aces: ACESFilmicToneMapping,
  neutral: NeutralToneMapping,
};

/**
 * HDR-buffer + dithered output pass. Smooth lighting gradients band because
 * the tone-mapped result is quantized straight to the 8-bit canvas; the fix is
 * to render the scene LINEAR into a half-float target, then apply tone mapping
 * and add a ±1-LSB ordered dither in display space before the 8-bit write, so
 * the steps dissolve into imperceptible noise (this is what makes gradients
 * look "renderer-clean" rather than contoured). The scene renders into `hdr`;
 * `render()` composites it to the canvas.
 */
export class DitherOutput {
  readonly hdr: RenderTarget;
  private readonly post: PostProcessing;
  private mode: OutputToneMapping = "aces";

  constructor(renderer: WebGPURenderer) {
    this.hdr = new RenderTarget(1, 1, {
      type: HalfFloatType, // linear HDR — no quantization until the final blit
      colorSpace: LinearSRGBColorSpace,
      depthBuffer: true,
    });
    this.post = new PostProcessing(renderer);
    // we do tone mapping + color-space ourselves in outputNode via renderOutput
    this.post.outputColorTransform = false;
    this.rebuild();
  }

  /** Size the HDR target to the renderer's drawing buffer (device pixels). */
  resize(width: number, height: number): void {
    this.hdr.setSize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
  }

  /** Tone mapping for the whole composite (the active pane's). */
  setToneMapping(mode: OutputToneMapping): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.rebuild();
  }

  private rebuild(): void {
    const color = texture(this.hdr.texture);
    // tone map + linear→sRGB (renderOutput bakes the mode as a constant, so we
    // rebuild only when the active pane's tone mapping actually changes)
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
