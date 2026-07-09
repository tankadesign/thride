import { useCallback, useSyncExternalStore } from "react";
import type { SliceId } from "@/types/core";
import type { Document } from "@/core";
import { useDocumentOrNull } from "./DocumentContext";

/**
 * Re-render when a document slice bumps. Returns the slice version — depend
 * on it (or just call the hook) and read document state directly in render.
 * `doc` override exists for tests; panels normally rely on the provider.
 */
export function useDocSlice(slice: SliceId, doc?: Document): number {
  const ctxDoc = useDocumentOrNull();
  const d = doc ?? ctxDoc;
  if (!d) throw new Error("useDocSlice: no document (provider missing and none passed)");
  const subscribe = useCallback((cb: () => void) => d.subscribeSlice(slice, cb), [d, slice]);
  const getSnapshot = useCallback(() => d.version(slice), [d, slice]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
