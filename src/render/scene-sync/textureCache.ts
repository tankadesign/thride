import { NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from "three";
import type { Uuid } from "@/types/core";
import { textureAssets } from "@/io/storage/textureAssets";

/**
 * Decodes texture-asset bytes into GPU textures, cached per (asset id,
 * colorSpace) — the same image feeds a color channel as sRGB and a data channel
 * as linear. Decode is async (`createImageBitmap`): `get()` returns undefined
 * until the bitmap is ready, then fires `onReady` so the caller re-binds the
 * channel and re-renders (the viewport renders on demand, so a decode that lands
 * after the frame must nudge it).
 */
export class TextureCache {
  private readonly cache = new Map<string, Texture>();
  private readonly pending = new Set<string>();
  private readonly onReady: () => void;

  constructor(onReady: () => void) {
    this.onReady = onReady;
  }

  /** Cached texture for the asset, or undefined while it decodes (kicks decode off). */
  get(id: Uuid, colorSpace: "srgb" | "linear"): Texture | undefined {
    const key = `${id}:${colorSpace}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (!this.pending.has(key)) this.decode(id, key, colorSpace);
    return undefined;
  }

  private decode(id: Uuid, key: string, colorSpace: "srgb" | "linear"): void {
    const asset = textureAssets.get(id);
    if (!asset) return;
    this.pending.add(key);
    // copy into a fresh ArrayBuffer-backed view (asset.bytes may be a subarray)
    const blob = new Blob([new Uint8Array(asset.bytes)], { type: asset.mime });
    createImageBitmap(blob, { colorSpaceConversion: "none" })
      .then((bitmap) => {
        const tex = new Texture(bitmap);
        tex.colorSpace = colorSpace === "srgb" ? SRGBColorSpace : NoColorSpace;
        tex.wrapS = RepeatWrapping;
        tex.wrapT = RepeatWrapping;
        tex.flipY = false; // ImageBitmap is already top-left origin
        tex.needsUpdate = true;
        this.cache.set(key, tex);
        this.pending.delete(key);
        this.onReady();
      })
      .catch(() => {
        this.pending.delete(key); // corrupt/undecodable — leave the channel empty
      });
  }

  dispose(): void {
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
    this.pending.clear();
  }
}
