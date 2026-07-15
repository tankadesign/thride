import { Mesh, OrthographicCamera, PlaneGeometry, Scene } from "three";
import { MeshBasicNodeMaterial, WebGPURenderer } from "three/webgpu";
import type { ProceduralLayer } from "@/types/core";
import { float } from "@/materials/tsl";
import { previewNode, type NoiseDef } from "@/materials/noises";
import { compile } from "@/materials/procedural";

/**
 * Offscreen noise preview: a full-frame quad shaded by a noise def's `preview`
 * node, rendered to a dataURL for the noise gallery. Own isolated
 * WebGPURenderer + device (a node material's compiled pipeline is per-device —
 * same reason as {@link MaterialThumbnails}). Unlit: the quad's `positionLocal`
 * spans [-1,1] in XY, which is the noise's sample coordinate, so `scale` sets
 * the visible frequency. `render(def, vals, phase)` is awaited per thumbnail.
 */
export class NoiseThumbnails {
  private readonly renderer: WebGPURenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly quad: Mesh;
  private readonly ready: Promise<unknown>;
  private disposed = false;

  constructor(size = 160) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = size;
    this.canvas.height = size;
    this.renderer = new WebGPURenderer({ canvas: this.canvas, antialias: false });
    this.renderer.setSize(size, size, false);

    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.z = 2;

    this.quad = new Mesh(new PlaneGeometry(2, 2), new MeshBasicNodeMaterial());
    this.scene.add(this.quad);

    this.ready = this.renderer.init();
  }

  /** Shade the quad with the def's preview node and return a PNG dataURL. */
  async render(def: NoiseDef, vals: Record<string, number>, phase = 0): Promise<string> {
    await this.ready;
    if (this.disposed) return "";
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = previewNode(def, vals, float(phase));
    const prev = this.quad.material;
    this.quad.material = mat;
    await this.renderer.renderAsync(this.scene, this.camera);
    const url = this.canvas.toDataURL("image/png");
    (Array.isArray(prev) ? prev : [prev]).forEach((m) => m.dispose());
    return url;
  }

  /**
   * Render a channel layer's full look — shaping, seed, ramp/tint — via the E3
   * compiler (single-layer color-channel doc), for the material editor's noise
   * chip. Normal-channel layers preview as their height field, which is the
   * useful view of them.
   */
  async renderLayer(layer: ProceduralLayer): Promise<string> {
    await this.ready;
    if (this.disposed) return "";
    const compiled = compile({ channels: { color: { layers: [{ ...layer, enabled: true }] } } });
    if (!compiled.nodes.color) {
      compiled.dispose();
      return "";
    }
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = compiled.nodes.color;
    const prev = this.quad.material;
    this.quad.material = mat;
    await this.renderer.renderAsync(this.scene, this.camera);
    const url = this.canvas.toDataURL("image/png");
    compiled.dispose();
    (Array.isArray(prev) ? prev : [prev]).forEach((m) => m.dispose());
    return url;
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.dispose();
  }
}
