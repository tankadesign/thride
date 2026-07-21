import type { Float, Vec3 } from "@/materials/tsl";

/**
 * Value shaping (E3) — levels window (clipLow→clipHigh remapped to 0→1), then
 * contrast around mid-gray, then bias, clamped. Applied componentwise (curl is a
 * vec3 field). Every knob is a live uniform at the call sites, so shaping edits
 * never recompile. Shared by the layer-stack compiler and the E7 noise node so
 * the two front-ends shape identically.
 */
export function shapeValue(value: Vec3, lo: Float, hi: Float, contrast: Float, bias: Float): Vec3 {
  const windowed = value.sub(lo).div(hi.sub(lo).max(1e-4)).clamp(0, 1);
  return windowed.sub(0.5).mul(contrast).add(0.5).add(bias).clamp(0, 1);
}
