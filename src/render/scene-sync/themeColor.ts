import { Color } from "three";

/**
 * Resolve a CSS custom property (e.g. daisyUI's --color-primary, an oklch()
 * value three can't parse) to a three Color by rasterizing 1px on a canvas.
 */
export function themeColor(cssVar: string, fallback: string): Color {
  try {
    const value =
      getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim() || fallback;
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return new Color(r! / 255, g! / 255, b! / 255);
  } catch {
    return new Color(fallback);
  }
}
