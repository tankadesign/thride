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

/**
 * Planar (mirrored-camera) reflection on a flat mesh — `node.data.planar`.
 * Unlike SSR it re-renders the scene through the surface's plane, so it shows
 * occluded geometry (e.g. a sphere's underside in a floor mirror). Exact only
 * for flat surfaces; the plane passes through the object origin.
 */
export interface PlanarReflectionDTO {
  /** Local axis of the mirror plane's normal (y = floor, x/z = walls). */
  axis: "x" | "y" | "z";
  /** Reflection mix into the surface color (0–1). */
  strength: number;
  /** Mirror render resolution scale (0.25–1) — the perf lever. */
  resolution: number;
}

export const defaultPlanarReflection = (): PlanarReflectionDTO => ({
  axis: "y",
  strength: 0.5,
  resolution: 0.5,
});
