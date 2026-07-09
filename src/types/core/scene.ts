import type { Uuid } from "./ids";
import type { EulerXYZ, Vec3 } from "./math";

/** Object categories in the scene hierarchy. Kind-specific payloads arrive in later chunks. */
export type NodeKind = "null" | "mesh" | "spline" | "generator" | "light" | "camera";

export interface TransformDTO {
  position: Vec3;
  /** Euler radians, XYZ order. */
  rotation: EulerXYZ;
  scale: Vec3;
}

/**
 * One scene-hierarchy node. Nodes are stored flat; `parent` is the only
 * hierarchy link and sibling order is the order of appearance within the
 * document's flat `nodes` array (per parent).
 */
export interface SceneNodeDTO {
  id: Uuid;
  name: string;
  kind: NodeKind;
  parent: Uuid | null;
  transform: TransformDTO;
  visible: boolean;
  locked: boolean;
  /**
   * Kind-specific payload reference (mesh id, generator params id, …).
   * Typed narrowly by later chunks; unknown keys must survive round-trips.
   */
  data?: Record<string, unknown>;
}

export const identityTransform = (): TransformDTO => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});
