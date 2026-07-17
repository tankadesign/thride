import { useEffect, useState } from "react";
import { atom, useSetAtom } from "jotai";
import type { MaterialDTO, Uuid } from "@/types/core";
import { MaterialThumbnails } from "@/render/thumbnails/materialThumbnails";
import { useDocument } from "@/ui/hooks/doc/document";
import { useSelectionInfo } from "@/ui/hooks/doc/selection";

/** Materials selected in the Material Manager (ephemeral UI state, grid order-independent). */
export const selectedMaterialsAtom = atom<Uuid[]>([]);

/**
 * Keep the Material Manager's selection in sync with the viewport: selecting a
 * SINGLE object that has an assigned material selects that material in the
 * editor. Multi-select, or an object with no material, leaves the current
 * material selection untouched (so the panel isn't yanked on every stray click).
 * Mounted once at the shell so it works even when the panel is closed.
 */
export function useSelectObjectMaterial(): void {
  const doc = useDocument();
  const { objectIds } = useSelectionInfo();
  const setSelected = useSetAtom(selectedMaterialsAtom);
  useEffect(() => {
    if (objectIds.length !== 1) return;
    const matId = doc.scene.get(objectIds[0]!)?.data?.material as Uuid | undefined;
    if (matId && doc.materials.has(matId)) setSelected([matId]);
  }, [objectIds, doc, setSelected]);
}

/** dataTransfer type carrying a material id when dragging a swatch onto an object. */
export const MATERIAL_DND_MIME = "application/x-thride-material";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the stable `key` hash of dto; re-running on dto identity would re-render the thumbnail needlessly
  }, [key]);
  return url;
}
