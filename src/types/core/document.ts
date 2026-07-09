import type { SceneNodeDTO } from "./scene";

/** Semver of the FILE FORMAT (not the app). Bump per PLAN.md migration rules. */
export const FORMAT_VERSION = "0.1.0";

/**
 * The full serializable document. This DTO layer IS the native file's
 * document.json — runtime stores serialize to exactly this shape, so the
 * file format and runtime model cannot drift apart silently.
 * Later chunks add: meshes, materials, generators, animation, viewports,
 * environment, postFx, renderSettings, assets.
 */
export interface ThrideDocumentDTO {
  formatVersion: string;
  /** Flat node list; parents always precede descendants (DFS order). */
  nodes: SceneNodeDTO[];
}
