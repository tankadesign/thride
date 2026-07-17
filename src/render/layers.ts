/**
 * Layer for interaction helpers (gizmo, handles, overlays, tools, selection
 * outlines). Scene renders — the hdr pass, the SSR G-buffer pass, and
 * planar-reflector mirror renders — use cameras on layer 0 only, so helpers
 * never appear in reflections; a dedicated overlay render draws them each
 * frame instead (see ViewportSystem.renderFrame).
 */
export const HELPER_LAYER = 1;

/**
 * Layer for invisible click-selection proxies (lights, cameras — objects with
 * no renderable geometry of their own). No camera renders this layer, so proxies
 * are never drawn; the picking raycaster uses `layers.enableAll()`, so they are
 * still hit-tested. See `render/helpers/pickProxy.ts`.
 */
export const PICK_LAYER = 2;
