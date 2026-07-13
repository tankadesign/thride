import { NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from "three";
import type { Uuid } from "@/types/core";
import { textureAssets } from "@/io/storage/textureAssets";

export type ChannelColorSpace = "srgb" | "linear";

/**
 * Decode a registered texture asset into a fresh GPU texture with the channel's
 * color space, repeat wrapping, and top-left origin. Returns a NEW Texture each
 * call (GPU resources are per-renderer/device — the viewport and the thumbnail
 * renderer must not share one). Null if the asset is missing or undecodable.
 */
export async function decodeChannelTexture(
  id: Uuid,
  colorSpace: ChannelColorSpace,
): Promise<Texture | null> {
  const asset = textureAssets.get(id);
  if (!asset) return null;
  try {
    // copy into a fresh ArrayBuffer-backed view (asset.bytes may be a subarray)
    const blob = new Blob([new Uint8Array(asset.bytes)], { type: asset.mime });
    const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none" });
    const tex = new Texture(bitmap);
    tex.colorSpace = colorSpace === "srgb" ? SRGBColorSpace : NoColorSpace;
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.flipY = false; // ImageBitmap is already top-left origin
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}

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
  get(id: Uuid, colorSpace: ChannelColorSpace): Texture | undefined {
    const key = `${id}:${colorSpace}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (!this.pending.has(key)) this.decode(id, key, colorSpace);
    return undefined;
  }

  private decode(id: Uuid, key: string, colorSpace: ChannelColorSpace): void {
    this.pending.add(key);
    decodeChannelTexture(id, colorSpace)
      .then((tex) => {
        this.pending.delete(key);
        if (!tex) return; // missing/undecodable — leave the channel empty
        this.cache.set(key, tex);
        this.onReady();
      })
      .catch(() => this.pending.delete(key));
  }

  dispose(): void {
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
    this.pending.clear();
  }
}
