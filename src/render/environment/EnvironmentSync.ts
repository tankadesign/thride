import { Color, EquirectangularReflectionMapping, type Scene, type Texture } from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import type { Document } from "@/core";
import type { EnvironmentDTO, Uuid } from "@/types/core";
import { textureAssets } from "@/io/storage/textureAssets";
import { defaultHdrTexture } from "./defaultHdr";
import { buildStudioEnvironment } from "./studioEnvironment";

const DEG = Math.PI / 180;

/**
 * Applies the document's {@link EnvironmentDTO} to the three Scene: the IBL
 * (`scene.environment` + intensity + Y rotation) plus the background value the
 * viewport uses for its first-pane clear (solid color, the env map, or none).
 * Studio is a painted equirect; an HDR source decodes its asset with
 * RGBE/EXR loaders (async → falls back to studio until ready, then re-applies).
 * Re-applies on `environment:changed` / `document:reset`.
 */
export class EnvironmentSync {
  private readonly scene: Scene;
  private readonly doc: Document;
  private readonly onChange: () => void;
  private studio: Texture | null = null;
  private readonly hdr = new Map<Uuid, Texture>(); // decoded HDR/EXR per asset
  private readonly pending = new Set<Uuid>();
  private readonly bgColor = new Color();
  /** Background for the first pane's clear: a solid Color, the env map, or null. */
  background: Color | Texture | null = null;
  private readonly unsubs: (() => void)[] = [];

  constructor(scene: Scene, doc: Document, onChange: () => void) {
    this.scene = scene;
    this.doc = doc;
    this.onChange = onChange;
    this.apply();
    const react = () => {
      this.apply();
      onChange();
    };
    this.unsubs.push(
      doc.events.on("environment:changed", react),
      doc.events.on("document:reset", react),
    );
  }

  /** IBL texture for the current source; studio while an HDR asset decodes. */
  private envTexture(env: EnvironmentDTO): Texture {
    if (env.source === "hdr" && env.hdrAssetId) {
      const cached = this.hdr.get(env.hdrAssetId);
      if (cached) return cached;
      this.decodeHdr(env.hdrAssetId);
    }
    this.studio ??= buildStudioEnvironment();
    return this.studio;
  }

  /** Decode an HDR/EXR asset (async) into an equirect texture, then re-apply. */
  private decodeHdr(assetId: Uuid): void {
    if (this.pending.has(assetId)) return;
    const asset = textureAssets.get(assetId);
    if (!asset) return;
    this.pending.add(assetId);
    const isExr = asset.mime.includes("exr") || asset.name.toLowerCase().endsWith(".exr");
    const loader = isExr ? new EXRLoader() : new RGBELoader();
    const url = URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }));
    loader.load(
      url,
      (tex) => {
        URL.revokeObjectURL(url);
        tex.mapping = EquirectangularReflectionMapping;
        this.hdr.set(assetId, tex);
        this.pending.delete(assetId);
        this.apply(); // now that the HDR is ready
        this.onChange();
      },
      undefined,
      () => {
        URL.revokeObjectURL(url); // corrupt/undecodable → stays on studio
        this.pending.delete(assetId);
      },
    );
  }

  apply(): void {
    const env = this.doc.environment;
    const tex = this.envTexture(env);
    this.scene.environment = tex;
    this.scene.environmentIntensity = env.intensity;
    this.scene.environmentRotation.set(0, env.rotation * DEG, 0);

    if (env.background === "environment") {
      this.scene.backgroundBlurriness = env.backgroundBlur;
      this.scene.backgroundIntensity = env.backgroundIntensity;
      this.scene.backgroundRotation.set(0, env.rotation * DEG, 0);
      // Studio is a lighting rig, not scenery — as a backdrop it reads as a
      // flat gradient (and it's what "high" SSR reflects for misses anyway).
      // Show the bundled default HDRI instead; fall back to studio while it
      // decodes. HDR source keeps its own texture.
      const react = () => {
        this.apply();
        this.onChange();
      };
      this.background = env.source === "hdr" ? tex : (defaultHdrTexture(react) ?? tex);
    } else if (env.background === "color") {
      this.background = this.bgColor.set(env.backgroundColor);
    } else {
      this.background = null; // transparent
    }
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.studio?.dispose();
    for (const t of this.hdr.values()) t.dispose();
  }
}
