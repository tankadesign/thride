import { useEffect, useState } from "react";
import type { ProceduralLayer } from "@/types/core";
import { NoiseThumbnails } from "@/render/thumbnails/noiseThumbnails";

/**
 * Live preview dataURL for a channel's noise layer (the map-slot chip).
 *
 * One shared offscreen `NoiseThumbnails` (its WebGPU device is per-instance —
 * one is plenty for 64px chips), created lazily and kept for the app's
 * lifetime. Renders are serialized through a queue because every chip shares
 * the same quad, and debounced so param scrubs re-render at rest, not per move.
 */

let shared: NoiseThumbnails | null = null;
let queue: Promise<unknown> = Promise.resolve();

export function useLayerPreview(layer: ProceduralLayer | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const json = layer ? JSON.stringify(layer) : null;
  useEffect(() => {
    if (!json) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the stale preview immediately when the layer is removed/changed; the async render below sets the fresh one
      setUrl(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      shared ??= new NoiseThumbnails(64);
      queue = queue.then(async () => {
        if (cancelled) return;
        const u = await shared!.renderLayer(JSON.parse(json) as ProceduralLayer);
        if (!cancelled && u) setUrl(u);
      });
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [json]);
  return url;
}
