import "dockview-react/dist/styles/dockview.css";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";
import { useEffect, useMemo, useRef } from "react";
import type { Document } from "@/core";
import { buildCommands, type ShellApi } from "@/app/commands";
import { CommandRegistry } from "@/ui/commands/CommandRegistry";
import { setRegistry, usePalette } from "@/ui/hooks/editor/shell";
import { AttributesPanel } from "@/ui/panels/AttributesPanel";
import { GalleryPanel } from "@/ui/panels/GalleryPanel";
import { ObjectManagerPanel } from "@/ui/panels/ObjectManagerPanel";
import { ViewportPanel } from "@/ui/panels/ViewportPanel";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";
import { CommandPalette } from "./CommandPalette";
import { ContextMenu } from "./ContextMenu";
import { MenuBar } from "./MenuBar";
import { ToolRail } from "./ToolRail";

const LAYOUT_KEY = "thride.layout.v1";

export function Shell({ doc }: { doc: Document }) {
  const apiRef = useRef<DockviewApi | null>(null);
  const viewportRef = useRef<ViewportSystem | null>(null);
  const palette = usePalette();

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
    reg.register(...buildCommands(doc, shellApi));
    return reg;
  }, [doc]);

  // install into the store from an effect — setting during render trips
  // React's update-during-render rule via jotai subscribers
  useEffect(() => {
    setRegistry(registry);
  }, [registry]);

  // global shortcuts (skip while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable
      ) {
        return;
      }
      if (palette.open) return;
      registry.handleKey(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [registry, palette.open]);

  const components = useMemo(
    () => ({
      viewport: (_p: IDockviewPanelProps) => (
        <ViewportPanel onSystem={(vs) => (viewportRef.current = vs)} />
      ),
      objects: (_p: IDockviewPanelProps) => <ObjectManagerPanel />,
      // panel api lets the inspector retitle its tab per edit mode
      attributes: (p: IDockviewPanelProps) => <AttributesPanel panelApi={p.api} />,
      gallery: (_p: IDockviewPanelProps) => <GalleryPanel />,
    }),
    [],
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
    <div className="flex h-full flex-col bg-base-300 text-base-content">
      <MenuBar registry={registry} />
      <div className="flex min-h-0 flex-1">
        <ToolRail registry={registry} />
        <div className="min-w-0 flex-1">
          <DockviewReact
            className="dockview-theme-dark dockview-theme-thride"
            components={components}
            onReady={onReady}
          />
        </div>
      </div>
      {palette.open ? <CommandPalette registry={registry} onClose={palette.close} /> : null}
      <ContextMenu />
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
