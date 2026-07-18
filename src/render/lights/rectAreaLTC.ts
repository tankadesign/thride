import { RectAreaLightNode } from "three/webgpu";
import { RectAreaLightTexturesLib } from "three/examples/jsm/lights/RectAreaLightTexturesLib.js";

let initialized = false;

/**
 * Rect-area lights need the LTC (linearly-transformed cosine) BRDF texture data
 * installed on the node material once per process. Without it,
 * `RectAreaLightNode.setupDirectRectArea` dereferences `null.LTC_FLOAT_1` and
 * the whole frame throws the instant an area light enters the scene — so any
 * scene (or import) with one crashed the viewport.
 *
 * `setLTC` is a global static, so this is idempotent: called lazily the first
 * time an area light is built (the LTC tables are ~256 KB of Float data +
 * DataTextures — no reason to pay for it in scenes that have no area light).
 */
export function ensureRectAreaLTC(): void {
  if (initialized) return;
  initialized = true;
  RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
}
