import { Mesh, OrthographicCamera, PlaneGeometry, Scene } from "three";
import { MeshBasicNodeMaterial, WebGPURenderer } from "three/webgpu";
import type { MaterialGraphDTO, Uuid } from "@/types/core";
import { emitNodePreviews } from "@/materials/graph";

/** Preview strip aspect — matches the node component's img (min-w-44 × h-12). */
const WIDTH = 168;
const HEIGHT = 56;

/**
 * Offscreen per-node previews for the node editor (E7 Stage 6): every non-Output
 * node's emitted value shaded unlit on a quad, one dataURL per node. Own
 * isolated WebGPURenderer + device (compiled pipelines are per-device — same as
 * the noise/material thumbnails). The quad spans the camera exactly and its
 * `positionLocal` XY spans [-aspect, aspect]×[-1, 1], so noises render
 * unstretched at their true frequency. `render(graph)` is awaited per pass.
 */
export class GraphNodeThumbnails {
  private readonly renderer: WebGPURenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly quad: Mesh;
  private readonly ready: Promise<unknown>;
  private disposed = false;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.renderer = new WebGPURenderer({ canvas: this.canvas, antialias: false });
    this.renderer.setSize(WIDTH, HEIGHT, false);

    const aspect = WIDTH / HEIGHT;
    this.camera = new OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 10);
    this.camera.position.z = 2;

    this.quad = new Mesh(new PlaneGeometry(2 * aspect, 2), new MeshBasicNodeMaterial());
    this.scene.add(this.quad);

    this.ready = this.renderer.init();
  }

  /** One dataURL per non-Output node of `graph` (values baked from the DTO). */
  async render(graph: MaterialGraphDTO): Promise<Map<Uuid, string>> {
    await this.ready;
    const out = new Map<Uuid, string>();
    if (this.disposed) return out;
    const previews = emitNodePreviews(graph);
    for (const [id, node] of previews.nodes) {
      if (this.disposed) break;
      const mat = new MeshBasicNodeMaterial();
      mat.colorNode = node;
      const prev = this.quad.material;
      this.quad.material = mat;
      await this.renderer.renderAsync(this.scene, this.camera);
      out.set(id, this.canvas.toDataURL("image/png"));
      (Array.isArray(prev) ? prev : [prev]).forEach((m) => m.dispose());
    }
    previews.dispose();
    return out;
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.dispose();
  }
}
