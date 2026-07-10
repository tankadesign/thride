import { atom, getDefaultStore, useAtomValue, type Atom } from "jotai";
import type { Document } from "@/core";
import type { SliceId } from "@/types/core";

/**
 * Document access + per-slice version atoms. The Document stays a plain TS
 * event-emitting core; jotai atoms bridge its slice bumps into React. All
 * app state lives in jotai's default store so the render layer (non-React)
 * can read/subscribe through the same source of truth.
 */

export const appStore = getDefaultStore();

export const docAtom = atom<Document | null>(null);

/** Install the open document at app startup (and in tests). */
export function setAppDocument(doc: Document): void {
  appStore.set(docAtom, doc);
}

const sliceAtomCache = new Map<SliceId, Atom<number>>();

/**
 * Atom mirroring one document slice's version counter. Re-attaches its
 * subscription whenever docAtom changes (multi-project tab switches) —
 * mounted panels must follow the ACTIVE document, not the one that was
 * active when they first subscribed.
 */
export function sliceVersionAtom(slice: SliceId): Atom<number> {
  let cached = sliceAtomCache.get(slice);
  if (!cached) {
    const base = atom(0);
    base.onMount = (set) => {
      let unsubDoc: (() => void) | null = null;
      const attach = () => {
        unsubDoc?.();
        unsubDoc = null;
        const doc = appStore.get(docAtom);
        if (!doc) return;
        set(doc.version(slice));
        unsubDoc = doc.subscribeSlice(slice, () => set(doc.version(slice)));
      };
      attach();
      const unsubSwitch = appStore.sub(docAtom, attach);
      return () => {
        unsubDoc?.();
        unsubSwitch();
      };
    };
    sliceAtomCache.set(slice, base);
    cached = base;
  }
  return cached;
}

/** The open document; throws if used before setAppDocument. */
export function useDocument(): Document {
  const doc = useAtomValue(docAtom);
  if (!doc) throw new Error("useDocument: no document installed (setAppDocument missing)");
  return doc;
}

/**
 * Re-render when a slice bumps; returns the version. Call it, then read
 * document state directly in render.
 */
export function useSliceVersion(slice: SliceId): number {
  return useAtomValue(sliceVersionAtom(slice));
}
