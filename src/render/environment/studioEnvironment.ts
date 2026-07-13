import {
  CanvasTexture,
  EquirectangularReflectionMapping,
  SRGBColorSpace,
  type Texture,
} from "three";

/**
 * A neutral studio environment for IBL, painted onto a 2:1 equirect canvas: a
 * soft sky→horizon→floor gradient plus a few bright softbox blobs so metals and
 * glossy surfaces pick up real highlights and reflections instead of rendering
 * black. No HDR asset and no WebGL PMREMGenerator (WebGL-only) — three's node
 * PMREM prefilters this for roughness on the WebGPU path.
 */
export function buildStudioEnvironment(): Texture {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // vertical studio gradient: bright ceiling → mid walls → dark floor
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, "#eef1f5");
  grad.addColorStop(0.42, "#9ba1a9");
  grad.addColorStop(0.55, "#6b7076");
  grad.addColorStop(1.0, "#16181c");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // soft "softbox" highlights in the upper hemisphere
  const blob = (cx: number, cy: number, r: number, a: number) => {
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, `rgba(255,255,255,${a})`);
    rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  blob(w * 0.26, h * 0.2, h * 0.3, 0.95);
  blob(w * 0.7, h * 0.15, h * 0.22, 0.7);
  blob(w * 0.52, h * 0.34, h * 0.18, 0.3);

  const tex = new CanvasTexture(canvas);
  tex.mapping = EquirectangularReflectionMapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
