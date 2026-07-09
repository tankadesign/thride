import { createContext, useContext } from "react";
import type { Document } from "@/core";

const DocumentContext = createContext<Document | null>(null);

export const DocumentProvider = DocumentContext.Provider;

/** The open document. Panels must not cache it — always read via this hook. */
export function useDocument(): Document {
  const doc = useContext(DocumentContext);
  if (!doc) throw new Error("useDocument: no DocumentProvider above this component");
  return doc;
}

/** Internal variant for hooks that accept an explicit document (tests). */
export function useDocumentOrNull(): Document | null {
  return useContext(DocumentContext);
}
