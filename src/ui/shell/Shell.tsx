import "dockview-react/dist/styles/dockview.css";
import "@/ui/widgets/widgets.css";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Document } from "@/core";
import { buildCommands, type ShellApi } from "@/app/commands";
import { CommandRegistry } from "@/ui/commands/CommandRegistry";
import { AttributesPanel } from "@/ui/panels/AttributesPanel";
import { GalleryPanel } from "@/ui/panels/GalleryPanel";
import { ObjectManagerPanel } from "@/ui/panels/ObjectManagerPanel";
import { ViewportPanel } from "@/ui/panels/ViewportPanel";
import type { EditorState } from "@/ui/state/EditorState";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";
import { CommandPalette } from "./CommandPalette";
import { MenuBar } from "./MenuBar";
import { ToolRail } from "./ToolRail";

const LAYOUT_KEY = "thride.layout.v1";

interface ShellProps {
  doc: Document;
  editor: EditorState;
}

export function Shell({ doc, editor }: ShellProps) {
  const apiRef = useRef<DockviewApi | null>(null);
  const viewportRef = useRef<ViewportSystem | null>(null);
  useSyncExternalStore(
    (cb) => editor.subscribe(cb),
    () => editor.version,
  );

  const registry = useMemo(() => {
    const shellApi: ShellApi = {
      getViewport: () => viewportRef.current,
      openGallery: () => {
        const api = apiRef.current;
        if (!api) return;
        if (api.getPanel("gallery")) api.getPanel("gallery")!.focus();
        else
          api.addPanel({
            id: "gallery",
            component: "gallery",
            title: "UI Gallery",
            position: { direction: "right" },
          });
      },
      resetLayout: () => {
        localStorage.removeItem(LAYOUT_KEY);
        const api = apiRef.current;
        if (api) buildDefaultLayout(api);
      },
    };
    const reg = new CommandRegistry();
    reg.register(...buildCommands(doc, editor, shellApi));
    return reg;
  }, [doc, editor]);

  // global shortcuts (skip while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable
      )
        return;
      if (editor.paletteOpen) return;
      registry.handleKey(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [registry, editor]);

  const components = useMemo(
    () => ({
      viewport: (_p: IDockviewPanelProps) => (
        <ViewportPanel editor={editor} onSystem={(vs) => (viewportRef.current = vs)} />
      ),
      objects: (_p: IDockviewPanelProps) => <ObjectManagerPanel />,
      attributes: (_p: IDockviewPanelProps) => <AttributesPanel />,
      gallery: (_p: IDockviewPanelProps) => <GalleryPanel />,
    }),
    [editor],
  );

  const onReady = (e: DockviewReadyEvent) => {
    apiRef.current = e.api;
    if (import.meta.env.DEV) {
      // dev-only escape hatch for layout debugging
      (window as unknown as Record<string, unknown>).__dockview = e.api;
    }
    const saved = localStorage.getItem(LAYOUT_KEY);
    let restored = false;
    if (saved) {
      try {
        e.api.fromJSON(JSON.parse(saved));
        restored = !!e.api.getPanel("viewport");
      } catch {
        restored = false;
      }
    }
    if (!restored) buildDefaultLayout(e.api);
    e.api.onDidLayoutChange(() => {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(e.api.toJSON()));
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <MenuBar registry={registry} />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <ToolRail registry={registry} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <DockviewReact
            className="dockview-theme-dark"
            components={components}
            onReady={onReady}
          />
        </div>
      </div>
      {editor.paletteOpen ? (
        <CommandPalette registry={registry} onClose={() => editor.setPaletteOpen(false)} />
      ) : null}
    </div>
  );
}

function buildDefaultLayout(api: DockviewApi) {
  api.clear();
  api.addPanel({ id: "viewport", component: "viewport", title: "Viewport" });
  const objects = api.addPanel({
    id: "objects",
    component: "objects",
    title: "Objects",
    position: { direction: "right" },
    initialWidth: 340,
  });
  api.addPanel({
    id: "attributes",
    component: "attributes",
    title: "Attributes",
    position: { referencePanel: "objects", direction: "below" },
  });
  requestAnimationFrame(() => objects.api.setSize({ width: 340 }));
}
