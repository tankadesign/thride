import { atom, useAtom, useAtomValue } from "jotai";
import type { Uuid, Vec3 } from "@/types/core";
import type {
  BevelToolParams,
  EditorViewportState,
  GizmoSpace,
  PaneCamera,
  PaneDisplay,
  ViewportLayout,
} from "@/types/editor";
import { defaultBevelParams, defaultPaneDisplay } from "@/types/editor";
import { appStore } from "@/ui/hooks/doc/document";
import { gridSnapSizeAtom } from "./settings";
import { paletteOpenAtom } from "./shell";

/**
 * Narrow render→UI bridge: reads the live local rotation of a node's Object3D
 * so the UI can bake a target-follow orientation into the document when a
 * target is cleared (retaining the object's current PSR instead of snapping
 * back). Set by ViewportPanel; null when no viewport is mounted.
 *
 * Wrapped in an object because a bare function value would be interpreted by
 * jotai's primitive atom as a state-updater and invoked instead of stored.
 */
export const targetRotationBakerAtom = atom<{ bake: (id: Uuid) => Vec3 | null } | null>(null);

/**
 * Viewport editor state (ephemeral, non-undoable): layout, pane focus,
 * per-pane cameras, maximize. Jotai atoms are the source of truth; the
 * render layer consumes them through the EditorViewportState facade below.
 * Per-view camera assignments graduate into the document DTO with chunk H1.
 */

export const layoutAtom = atom<ViewportLayout>("single");
export const activePaneAtom = atom(0);
export const maximizedPaneAtom = atom(0);
export const paneCamerasAtom = atom<PaneCamera[]>(["persp", "top", "front", "right"]);
/** Gizmo axes follow the object (local) by default; W toggles world alignment. */
export const gizmoSpaceAtom = atom<GizmoSpace>("local");
/** Weld TOOL armed state (point mode): drag a vertex to slide-weld it. */
export const weldArmedAtom = atom(false);
/** Live edge-bevel tool: active flag + its adjustable parameters. */
export const bevelActiveAtom = atom(false);
export const bevelParamsAtom = atom<BevelToolParams>(defaultBevelParams());
/** Per-logical-pane display settings (viewport context menu → Display). */
export const paneDisplaysAtom = atom<PaneDisplay[]>([
  defaultPaneDisplay(),
  defaultPaneDisplay(),
  defaultPaneDisplay(),
  defaultPaneDisplay(),
]);

export function useViewportState() {
  const [layout, setLayout] = useAtom(layoutAtom);
  const activePane = useAtomValue(activePaneAtom);
  const maximizedPane = useAtomValue(maximizedPaneAtom);
  const [paneCameras, setPaneCameras] = useAtom(paneCamerasAtom);
  return {
    layout,
    activePane,
    maximizedPane,
    paneCameras,
    setLayout,
    setPaneCamera: (pane: number, camera: PaneCamera) =>
      setPaneCameras((prev) => prev.map((c, i) => (i === pane ? camera : c))),
  };
}

/** Jotai-backed implementation of the render layer's editor-state contract. */
class EditorStateStore implements EditorViewportState {
  get layout(): ViewportLayout {
    return appStore.get(layoutAtom);
  }

  get activePane(): number {
    return appStore.get(activePaneAtom);
  }

  get maximizedPane(): number {
    return appStore.get(maximizedPaneAtom);
  }

  get paletteOpen(): boolean {
    return appStore.get(paletteOpenAtom);
  }

  get gridSnapSize(): number {
    return appStore.get(gridSnapSizeAtom);
  }

  get gizmoSpace(): GizmoSpace {
    return appStore.get(gizmoSpaceAtom);
  }

  toggleGizmoSpace(): void {
    appStore.set(gizmoSpaceAtom, this.gizmoSpace === "local" ? "world" : "local");
  }

  get weldArmed(): boolean {
    return appStore.get(weldArmedAtom);
  }

  setWeldArmed(on: boolean): void {
    appStore.set(weldArmedAtom, on);
  }

  get bevelActive(): boolean {
    return appStore.get(bevelActiveAtom);
  }

  get bevelParams(): BevelToolParams {
    return appStore.get(bevelParamsAtom);
  }

  setBevelActive(on: boolean): void {
    appStore.set(bevelActiveAtom, on);
  }

  setBevelParams(patch: Partial<BevelToolParams>): void {
    appStore.set(bevelParamsAtom, { ...appStore.get(bevelParamsAtom), ...patch });
  }

  subscribeBevel(cb: () => void): () => void {
    return appStore.sub(bevelParamsAtom, cb);
  }

  paneDisplay(pane: number): PaneDisplay {
    return appStore.get(paneDisplaysAtom)[pane] ?? defaultPaneDisplay();
  }

  setPaneDisplay(pane: number, patch: Partial<PaneDisplay>): void {
    appStore.set(
      paneDisplaysAtom,
      appStore.get(paneDisplaysAtom).map((d, i) => (i === pane ? { ...d, ...patch } : d)),
    );
  }

  paneCamera(pane: number): PaneCamera {
    return appStore.get(paneCamerasAtom)[pane] ?? "persp";
  }

  setActivePane(pane: number): void {
    appStore.set(activePaneAtom, pane);
  }

  setPaneCamera(pane: number, camera: PaneCamera): void {
    appStore.set(
      paneCamerasAtom,
      appStore.get(paneCamerasAtom).map((c, i) => (i === pane ? camera : c)),
    );
  }

  toggleLayout(): void {
    appStore.set(layoutAtom, this.layout === "single" ? "quad" : "single");
  }

  toggleMaximize(pane: number): void {
    if (this.layout === "quad") {
      appStore.set(maximizedPaneAtom, pane);
      appStore.set(activePaneAtom, pane);
      appStore.set(layoutAtom, "single");
    } else {
      appStore.set(layoutAtom, "quad");
    }
  }

  subscribe(cb: () => void): () => void {
    const unsubs = [
      appStore.sub(layoutAtom, cb),
      appStore.sub(activePaneAtom, cb),
      appStore.sub(maximizedPaneAtom, cb),
      appStore.sub(paneCamerasAtom, cb),
      appStore.sub(gizmoSpaceAtom, cb),
      appStore.sub(weldArmedAtom, cb),
      appStore.sub(bevelActiveAtom, cb),
      appStore.sub(paneDisplaysAtom, cb),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }
}

/** Singleton facade handed to ViewportSystem (render layer). */
export const editorState: EditorViewportState = new EditorStateStore();
