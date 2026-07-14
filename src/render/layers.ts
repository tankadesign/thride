/**
 * Layer for interaction helpers (gizmo, handles, overlays, tools, selection
 * outlines). Scene renders — the hdr pass, the SSR G-buffer pass, and
 * planar-reflector mirror renders — use cameras on layer 0 only, so helpers
 * never appear in reflections; a dedicated overlay render draws them each
 * frame instead (see ViewportSystem.renderFrame).
 */
export const HELPER_LAYER = 1;
