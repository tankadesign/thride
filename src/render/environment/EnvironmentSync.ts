import { Color, type Scene, type Texture } from "three";
import type { Document } from "@/core";
import type { EnvironmentDTO } from "@/types/core";
import { buildStudioEnvironment } from "./studioEnvironment";

const DEG = Math.PI / 180;

/**
 * Applies the document's {@link EnvironmentDTO} to the three Scene: the IBL
 * (`scene.environment` + intensity + Y rotation) plus the background value the
 * viewport uses for its first-pane clear (solid color, the env map, or none).
 * The studio source is a painted equirect; an HDR source decodes an asset
 * (later slice). Re-applies on `environment:changed` / `document:reset`.
 */
export class EnvironmentSync {
  private readonly scene: Scene;
  private readonly doc: Document;
  private studio: Texture | null = null;
  private readonly bgColor = new Color();
  /** Background for the first pane's clear: a solid Color, the env map, or null. */
  background: Color | Texture | null = null;
  private readonly unsubs: (() => void)[] = [];

  constructor(scene: Scene, doc: Document, onChange: () => void) {
    this.scene = scene;
    this.doc = doc;
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

  /** The IBL texture for the current source (studio painted equirect for now). */
  private envTexture(_env: EnvironmentDTO): Texture {
    this.studio ??= buildStudioEnvironment();
    return this.studio;
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
      this.background = tex;
    } else if (env.background === "color") {
      this.background = this.bgColor.set(env.backgroundColor);
    } else {
      this.background = null; // transparent
    }
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.studio?.dispose();
  }
}
