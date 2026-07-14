import { EquirectangularReflectionMapping, type Texture } from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

/**
 * Bundled default equirect HDRI, decoded once and cached.
 *
 * Stochastic SSR (the "high" temporal path) samples an environment map for rays
 * that leave the screen and hard-requires a real equirect HDR with CPU-side
 * `image.data` — the painted Studio env (a CanvasTexture) can't drive it. This
 * ships a default so temporal SSR always has a valid env even before the user
 * loads their own HDR. Served from `public/` at `/hdri/…`.
 */
const DEFAULT_HDR_URL = "/hdri/golden_gate_hills_1k.hdr";

let cached: Texture | null = null;
let started = false;

/**
 * The decoded default HDRI, or `null` until it finishes loading. Kicks off the
 * (async, one-time) decode on first call; `onReady` fires once when it lands so
 * the caller can re-invalidate and rebuild the graph with the env in place.
 */
export function defaultHdrTexture(onReady?: () => void): Texture | null {
  if (cached) return cached;
  if (!started) {
    started = true;
    new RGBELoader().load(DEFAULT_HDR_URL, (tex) => {
      tex.mapping = EquirectangularReflectionMapping;
      cached = tex;
      onReady?.();
    });
  }
  return cached;
}

/**
 * The environment texture to feed stochastic SSR: the scene's own decoded HDR
 * when it has CPU-side data (env source is HDR/EXR), else the bundled default.
 * Returns `null` only while the default is still decoding.
 */
export function ssrEnvironmentTexture(
  sceneEnvironment: Texture | null,
  onReady?: () => void,
): Texture | null {
  // RGBELoader/EXRLoader textures carry `image.data`; the Studio CanvasTexture does not.
  if (sceneEnvironment && (sceneEnvironment.image as { data?: unknown } | undefined)?.data) {
    return sceneEnvironment;
  }
  return defaultHdrTexture(onReady);
}
