import {
  DirectionalLight,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  type Texture,
} from "three";
import type { NodeMaterial } from "three/webgpu";
import { WebGPURenderer } from "three/webgpu";
import type { MaterialDTO, ProceduralChannel, Uuid } from "@/types/core";
import { TEXTURE_CHANNELS, TEXTURE_TO_PROCEDURAL } from "@/types/core";
import { buildMaterial } from "@/materials/build";
import { buildStudioEnvironment } from "@/render/environment/studioEnvironment";
import {
  assignChannelNodes,
  compileStacks,
  type ImageSpec,
} from "@/render/scene-sync/proceduralBind";
import { decodeChannelTexture } from "@/render/scene-sync/textureCache";

/**
 * Offscreen C4D-style material preview: a lit sphere in a small studio scene,
 * rendered to a dataURL for the Material Manager. Uses its OWN WebGPURenderer +
 * device (isolated from the main viewport pipeline — a three material's compiled
 * pipeline is per-device, so previews build a fresh material from the DTO for
 * this device). One instance is shared; `render(dto)` is awaited per thumbnail.
 *
 * A hemisphere + 3-point light rig plus a neutral studio IBL environment gives
 * form, highlights, and reflections on a transparent background (the card
 * behind it shows through).
 */
export class MaterialThumbnails {
  private readonly renderer: WebGPURenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly sphere: Mesh;
  private readonly ready: Promise<unknown>;
  private readonly texCache = new Map<string, Texture>();
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
    // IBL so metals/glossy previews reflect a studio env instead of reading black
    this.scene.environment = buildStudioEnvironment();
    this.scene.environmentIntensity = 0.5;

    this.sphere = new Mesh(new SphereGeometry(1, 64, 48), buildMaterial(placeholderDto()));
    this.scene.add(this.sphere);

    this.ready = this.renderer.init();
  }

  /** Render `dto` onto the preview sphere and return a PNG dataURL. */
  async render(dto: MaterialDTO): Promise<string> {
    await this.ready;
    if (this.disposed) return "";
    const mat = buildMaterial(dto);
    // procedural stacks + projected images are compiled HERE too, not shared
    // from the viewport: a node material's pipeline is per-device, so a
    // thumbnail that skipped this would silently disagree with the viewport
    const proc = compileStacks(dto);
    const specs = await this.applyTextures(mat, dto);
    assignChannelNodes(mat, proc, specs, new Map());
    const prev = this.sphere.material;
    this.sphere.material = mat;
    await this.renderer.renderAsync(this.scene, this.camera);
    const url = this.canvas.toDataURL("image/png");
    proc?.dispose();
    if (Array.isArray(prev)) prev.forEach((m) => m.dispose());
    else prev.dispose();
    return url;
  }

  /**
   * Decode + bind this material's image-map channels (own device textures).
   * UV channels bind as plain map properties; non-uv return as specs for
   * {@link assignChannelNodes}, exactly mirroring MaterialSync.bindChannels.
   */
  private async applyTextures(
    mat: NodeMaterial,
    dto: MaterialDTO,
  ): Promise<Partial<Record<ProceduralChannel, ImageSpec>>> {
    const m = mat as unknown as Record<string, unknown>;
    const specs: Partial<Record<ProceduralChannel, ImageSpec>> = {};
    for (const { channel, applies, colorSpace } of TEXTURE_CHANNELS) {
      if (!(channel in mat)) continue;
      const id = applies.has(dto.type) ? dto.textures?.[channel] : undefined;
      if (!id) continue;
      const tex = await this.loadTexture(id, colorSpace);
      if (!tex) continue;
      const projection =
        channel === "normalMap" ? "uv" : (dto.textureProjections?.[channel] ?? "uv");
      if (projection !== "uv") specs[TEXTURE_TO_PROCEDURAL[channel]] = { tex, projection };
      else m[channel] = tex;
    }
    return specs;
  }

  private async loadTexture(id: Uuid, colorSpace: "srgb" | "linear"): Promise<Texture | null> {
    const key = `${id}:${colorSpace}`;
    const hit = this.texCache.get(key);
    if (hit) return hit;
    const tex = await decodeChannelTexture(id, colorSpace);
    if (tex) this.texCache.set(key, tex);
    return tex;
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.texCache.values()) t.dispose();
    this.texCache.clear();
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
