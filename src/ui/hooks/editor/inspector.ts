import { atom } from "jotai";
import type { Uuid } from "@/types/core";

/**
 * What the Attributes panel is currently editing. The panel follows the
 * last-clicked thing: selecting a scene object clears this (→ object attributes),
 * double-clicking a material graph node sets it (→ that node's attributes). The
 * node editor is for wiring only; all value editing happens in Attributes.
 */
export interface InspectedNode {
  materialId: Uuid;
  nodeId: string;
}

export const inspectedNodeAtom = atom<InspectedNode | null>(null);
