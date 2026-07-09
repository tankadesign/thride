import type { Uuid } from "@/types/core";

export type BuiltinCamera = "persp" | "top" | "front" | "right";
export type PaneCamera = BuiltinCamera | Uuid; // Uuid = look through a scene camera node
export type ViewportLayout = "single" | "quad";

/**
 * Ephemeral (non-undoable, non-document) editor state: viewport layout,
 * pane cameras, palette visibility. Per-view assignments graduate into the
 * document DTO with chunk H1. Plain store + subscribe (same pattern as
 * Document slices) so both React and the viewport system can watch it.
 */
export class EditorState {
  private _layout: ViewportLayout = "single";
  private _activePane = 0;
  private _paneCameras: PaneCamera[] = ["persp", "top", "front", "right"];
  private _paletteOpen = false;
  private _version = 0;
  private listeners = new Set<() => void>();

  get layout(): ViewportLayout {
    return this._layout;
  }

  get activePane(): number {
    return this._activePane;
  }

  get paletteOpen(): boolean {
    return this._paletteOpen;
  }

  get version(): number {
    return this._version;
  }

  paneCamera(pane: number): PaneCamera {
    return this._paneCameras[pane] ?? "persp";
  }

  setLayout(layout: ViewportLayout): void {
    if (this._layout === layout) return;
    this._layout = layout;
    if (layout === "single") this._activePane = 0;
    this.notify();
  }

  toggleLayout(): void {
    this.setLayout(this._layout === "single" ? "quad" : "single");
  }

  setActivePane(pane: number): void {
    if (this._activePane === pane) return;
    this._activePane = pane;
    this.notify();
  }

  setPaneCamera(pane: number, camera: PaneCamera): void {
    this._paneCameras[pane] = camera;
    this.notify();
  }

  setPaletteOpen(open: boolean): void {
    if (this._paletteOpen === open) return;
    this._paletteOpen = open;
    this.notify();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    this._version++;
    for (const cb of [...this.listeners]) cb();
  }
}
