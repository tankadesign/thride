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
import { dispatchKeyEvent, keyCaptureActiveAtom } from "@/ui/hooks/editor/keymap";
import { appStore } from "@/ui/hooks/doc/document";
import { useSelectObjectMaterial } from "@/ui/hooks/editor/materials";
import { AttributesPanel } from "@/ui/panels/AttributesPanel";
import { GalleryPanel } from "@/ui/panels/GalleryPanel";
import { NoiseGalleryPanel } from "@/ui/panels/NoiseGalleryPanel";
import { MaterialManagerPanel } from "@/ui/panels/MaterialManagerPanel";
import { EnvironmentPanel } from "@/ui/panels/EnvironmentPanel";
import { KeyBindingsPanel } from "@/ui/panels/keymap/KeyBindingsPanel";
import { ObjectManagerPanel } from "@/ui/panels/ObjectManagerPanel";
import { ViewportPanel } from "@/ui/panels/ViewportPanel";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";
import { CommandPalette } from "./CommandPalette";
import { ContextMenu } from "./ContextMenu";
import { MenuBar } from "./MenuBar";
import { ProjectTabs } from "./ProjectTabs";
import { ToolRail } from "./ToolRail";

const LAYOUT_KEY = "thride.layout.v1";

export function Shell({ doc }: { doc: Document }) {
  const apiRef = useRef<DockviewApi | null>(null);
  const viewportRef = useRef<ViewportSystem | null>(null);
  const palette = usePalette();
  useSelectObjectMaterial(); // selecting an object selects its material in the manager

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
      openNoiseGallery: () => {
        const api = apiRef.current;
        if (!api) return;
        if (api.getPanel("noiseGallery")) api.getPanel("noiseGallery")!.focus();
        else
          api.addPanel({
            id: "noiseGallery",
            component: "noiseGallery",
            title: "Noise Gallery",
            position: { direction: "right" },
          });
      },
      openMaterials: () => {
        const api = apiRef.current;
        if (!api) return;
        if (api.getPanel("materials")) api.getPanel("materials")!.focus();
        else
          api.addPanel({
            id: "materials",
            component: "materials",
            title: "Materials",
            position: { referencePanel: "attributes", direction: "within" },
          });
      },
      openEnvironment: () => {
        const api = apiRef.current;
        if (!api) return;
        if (api.getPanel("environment")) api.getPanel("environment")!.focus();
        else
          api.addPanel({
            id: "environment",
            component: "environment",
            title: "Environment",
            position: { referencePanel: "attributes", direction: "within" },
          });
      },
      openKeyboardShortcuts: () => {
        const api = apiRef.current;
        if (!api) return;
        if (api.getPanel("keybindings")) api.getPanel("keybindings")!.focus();
        else
          api.addPanel({
            id: "keybindings",
            component: "keybindings",
            title: "Keyboard shortcuts",
            position: { referencePanel: "attributes", direction: "within" },
          });
      },
      resetLayout: () => {
        localStorage.removeItem(LAYOUT_KEY);
        const api = apiRef.current;
        if (api) buildDefaultLayout(api);
      },
    };
    const reg = new CommandRegistry();
    // eslint-disable-next-line react-hooks/refs -- shellApi's callbacks read apiRef.current only when invoked (user actions), never during this memo
    reg.register(...buildCommands(doc, shellApi));
    return reg;
  }, [doc]);

  // install into the store from an effect — setting during render trips
  // React's update-during-render rule via jotai subscribers
  useEffect(() => {
    setRegistry(registry);
  }, [registry]);

  // global shortcuts (skip while typing — but only for BARE keys: modifier
  // combos like ⌘Z/⇧⌘Z must keep working from a focused field, except the
  // native text-editing ops ⌘A/C/V/X, which stay the input's own)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // the key-binding recorder owns the keyboard while capturing
      if (appStore.get(keyCaptureActiveAtom)) return;
      const t = e.target as HTMLElement;
      const typing =
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable;
      if (typing) {
        const mod = e.metaKey || e.ctrlKey;
        const nativeTextOp =
          mod && !e.shiftKey && !e.altKey && ["a", "c", "v", "x"].includes(e.key.toLowerCase());
        if (!mod || nativeTextOp) return;
      }
      if (palette.open) return;
      if (dispatchKeyEvent(e, doc)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, palette.open]);

  const components = useMemo(
    () => ({
      viewport: (_p: IDockviewPanelProps) => (
        <ViewportPanel onSystem={(vs) => (viewportRef.current = vs)} />
      ),
      objects: (_p: IDockviewPanelProps) => <ObjectManagerPanel />,
      // panel api lets the inspector retitle its tab per edit mode
      attributes: (p: IDockviewPanelProps) => <AttributesPanel panelApi={p.api} />,
      materials: (_p: IDockviewPanelProps) => <MaterialManagerPanel />,
      environment: (_p: IDockviewPanelProps) => <EnvironmentPanel />,
      keybindings: (_p: IDockviewPanelProps) => <KeyBindingsPanel />,
      gallery: (_p: IDockviewPanelProps) => <GalleryPanel />,
      noiseGallery: (_p: IDockviewPanelProps) => <NoiseGalleryPanel />,
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
      <ProjectTabs />
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
  api.addPanel({
    id: "materials",
    component: "materials",
    title: "Materials",
    position: { referencePanel: "attributes", direction: "within" },
  });
  requestAnimationFrame(() => objects.api.setSize({ width: 340 }));
}
