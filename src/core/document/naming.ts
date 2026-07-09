import type { Uuid } from "@/types/core";
import type { Document } from "./Document";

/**
 * Unique name among the SIBLINGS under `parent` (conflicts elsewhere in the
 * hierarchy are fine): "Cube" → "Cube.1" → "Cube.2" …
 */
export function uniqueSiblingName(doc: Document, parent: Uuid | null, base: string): string {
  const names = new Set(doc.scene.childrenOf(parent).map((id) => doc.scene.mustGet(id).name));
  if (!names.has(base)) return base;
  let n = 1;
  while (names.has(`${base}.${n}`)) n++;
  return `${base}.${n}`;
}
