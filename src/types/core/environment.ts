import type { Uuid } from "./ids";

/**
 * Scene environment / dome light — the IBL that lights and reflects onto every
 * object, plus how the viewport background renders. Pure serializable data; the
 * render layer turns it into `scene.environment` / `scene.background`. A loaded
 * HDR/EXR is referenced by asset id (bytes live in the texture-asset store).
 */
export interface EnvironmentDTO {
  /** IBL source: the built-in painted studio, or a loaded HDR/EXR asset. */
  source: "studio" | "hdr";
  /** Asset id (texture-asset store) for `source: "hdr"`. */
  hdrAssetId?: Uuid;
  /** IBL contribution strength. */
  intensity: number;
  /** Environment Y rotation, in degrees. */
  rotation: number;
  /** How the viewport background renders. */
  background: "color" | "environment" | "transparent";
  /** Solid background color (hex) for `background: "color"`. */
  backgroundColor: string;
  /** Background blur (0–1) when showing the environment. */
  backgroundBlur: number;
  /** Background brightness multiplier when showing the environment. */
  backgroundIntensity: number;
}

export const defaultEnvironment = (): EnvironmentDTO => ({
  source: "studio",
  intensity: 0.55,
  rotation: 0,
  background: "color",
  backgroundColor: "#101014", // matches the viewport theme's dark background
  backgroundBlur: 0,
  backgroundIntensity: 1,
});

/** Every texture-asset id an environment references (0 or 1: its HDR). */
export function environmentAssets(env: EnvironmentDTO | undefined): Uuid[] {
  return env?.source === "hdr" && env.hdrAssetId ? [env.hdrAssetId] : [];
}
