import {
  DirectionalLight,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
} from "three";
import { WebGPURenderer } from "three/webgpu";
import type { MaterialDTO } from "@/types/core";
import { buildMaterial } from "@/materials/build";

/**
 * Offscreen C4D-style material preview: a lit sphere in a small studio scene,
 * rendered to a dataURL for the Material Manager. Uses its OWN WebGPURenderer +
 * device (isolated from the main viewport pipeline — a three material's compiled
 * pipeline is per-device, so previews build a fresh material from the DTO for
 * this device). One instance is shared; `render(dto)` is awaited per thumbnail.
 *
 * A hemisphere + 3-point light rig gives form and highlights on a transparent
 * background (the card behind it shows through). No IBL yet — metals read a
 * touch darker; an environment map is a later enhancement.
 */
export class MaterialThumbnails {
  private readonly renderer: WebGPURenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly sphere: Mesh;
  private readonly ready: Promise<unknown>;
  private disposed = false;

  constructor(size = 192) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = size;
    this.canvas.height = size;
    this.renderer = new WebGPURenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setSize(size, size, false);

    this.camera = new PerspectiveCamera(28, 1, 0.1, 100);
    this.camera.position.set(0, 0, 4.2);

    this.scene.add(new HemisphereLight(0xffffff, 0x333340, 1.4));
    this.scene.add(dir(0xffffff, 2.6, 2, 3, 4)); // key
    this.scene.add(dir(0xbfcfff, 0.9, -3, 1, 2)); // cool fill
    this.scene.add(dir(0xffffff, 1.6, -1.5, 2, -4)); // rim / back

    this.sphere = new Mesh(new SphereGeometry(1, 64, 48), buildMaterial(placeholderDto()));
    this.scene.add(this.sphere);

    this.ready = this.renderer.init();
  }

  /** Render `dto` onto the preview sphere and return a PNG dataURL. */
  async render(dto: MaterialDTO): Promise<string> {
    await this.ready;
    if (this.disposed) return "";
    const mat = buildMaterial(dto);
    const prev = this.sphere.material;
    this.sphere.material = mat;
    await this.renderer.renderAsync(this.scene, this.camera);
    const url = this.canvas.toDataURL("image/png");
    if (Array.isArray(prev)) prev.forEach((m) => m.dispose());
    else prev.dispose();
    return url;
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.dispose();
  }
}

function dir(color: number, intensity: number, x: number, y: number, z: number): DirectionalLight {
  const l = new DirectionalLight(color, intensity);
  l.position.set(x, y, z);
  return l;
}

function placeholderDto(): MaterialDTO {
  return {
    id: "preview" as MaterialDTO["id"],
    name: "preview",
    type: "physical",
    color: "#cccccc",
    roughness: 0.5,
    metalness: 0,
    emissive: "#000000",
    emissiveIntensity: 1,
    opacity: 1,
    transparent: false,
  };
}
