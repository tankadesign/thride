import { useEffect, useState } from "react";
import { atom } from "jotai";
import type { MaterialDTO, Uuid } from "@/types/core";
import { MaterialThumbnails } from "@/render/thumbnails/materialThumbnails";

/** Material selected in the Material Manager (ephemeral UI state). */
export const selectedMaterialAtom = atom<Uuid | null>(null);

// One offscreen preview renderer, created lazily. Renders are SERIALIZED (the
// renderer reuses a single sphere) and cached by visual params so identical or
// unchanged materials never re-render.
let renderer: MaterialThumbnails | null = null;
const cache = new Map<string, string>();
let chain: Promise<void> = Promise.resolve();

/** Cache key = the visual params only (id/name don't affect the thumbnail). */
function keyOf(dto: MaterialDTO): string {
  const { id: _id, name: _name, ...visual } = dto;
  return JSON.stringify(visual);
}

async function thumbnail(dto: MaterialDTO): Promise<string> {
  const key = keyOf(dto);
  const hit = cache.get(key);
  if (hit) return hit;
  chain = chain.then(async () => {
    if (cache.has(key)) return; // filled while we waited our turn
    renderer ??= new MaterialThumbnails();
    cache.set(key, await renderer.render(dto));
  });
  await chain;
  return cache.get(key) ?? "";
}

/**
 * Async sphere-preview dataURL for a material; re-renders only when the visual
 * params change (keyed hash), null until the first render resolves.
 */
export function useMaterialThumbnail(dto: MaterialDTO): string | null {
  const key = keyOf(dto);
  const [url, setUrl] = useState<string | null>(() => cache.get(key) ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on `key` (a
  // stable hash of dto) so we don't re-run on every new object identity.
  useEffect(() => {
    let alive = true;
    void thumbnail(dto).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return url;
}
