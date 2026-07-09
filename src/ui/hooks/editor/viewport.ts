import { atom, useAtom, useAtomValue } from "jotai";
import type { EditorViewportState, PaneCamera, ViewportLayout } from "@/types/editor";
import { appStore } from "@/ui/hooks/doc/document";
import { gridSnapSizeAtom } from "./settings";
import { paletteOpenAtom } from "./shell";

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
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }
}

/** Singleton facade handed to ViewportSystem (render layer). */
export const editorState: EditorViewportState = new EditorStateStore();
