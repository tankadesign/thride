import "dockview-react/dist/styles/dockview.css";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";
import { useEffect, useMemo, useRef } from "react";
import type { Document } from "@/core";
import { buildCommands, type ShellApi, type ShellPanelId } from "@/app/commands";
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
const MIN_PANEL_WIDTH = 340; // px, for objects/attributes/materials
const MAX_PANEL_WIDTH = 600; // px, for objects/attributes/materials

/** All dockable side panels live in the right-hand column; any of them can
 * serve as the anchor when reopening another, so closing "attributes" (the
 * old hard-coded anchor) can never strand the rest. Order = anchor priority:
 * tabbed inspectors first, "objects" last since it sits in its own group. */
const RIGHT_PANEL_TITLES: Record<ShellPanelId, string> = {
  attributes: "Attributes",
  materials: "Materials",
  environment: "Environment",
  keybindings: "Keyboard shortcuts",
  gallery: "UI Gallery",
  noiseGallery: "Noise Gallery",
  objects: "Objects",
};

function openRightPanel(api: DockviewApi, id: ShellPanelId) {
  const existing = api.getPanel(id);
  if (existing) {
    existing.focus();
    return;
  }
  const anchor = (Object.keys(RIGHT_PANEL_TITLES) as ShellPanelId[])
    .filter((p) => p !== id)
    .map((p) => api.getPanel(p))
    .find(Boolean);
  const common = {
    id,
    component: id,
    title: RIGHT_PANEL_TITLES[id],
    minimumWidth: MIN_PANEL_WIDTH,
  };
  if (!anchor) {
    // right column is gone entirely — recreate it
    api.addPanel({
      ...common,
      position: { direction: "right" },
      initialWidth: MIN_PANEL_WIDTH,
      ...(id === "objects" ? { maximumWidth: MAX_PANEL_WIDTH } : {}),
    });
    return;
  }
  if (id === "objects") {
    // objects always takes the top of the right column, pushing the rest down
    api.addPanel({
      ...common,
      position: { referencePanel: anchor.id, direction: "above" },
      maximumWidth: MAX_PANEL_WIDTH,
    });
    return;
  }
  // everything else joins the inspector tab group (or opens below objects
  // when that group is the only thing left in the column)
  api.addPanel({
    ...common,
    position: {
      referencePanel: anchor.id,
      direction: anchor.id === "objects" ? "below" : "within",
    },
  });
}

export function Shell({ doc }: { doc: Document }) {
  const apiRef = useRef<DockviewApi | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<ViewportSystem | null>(null);
  const palette = usePalette();
  useSelectObjectMaterial(); // selecting an object selects its material in the manager

  const registry = useMemo(() => {
    const shellApi: ShellApi = {
      getViewport: () => viewportRef.current,
      openPanel: (id) => {
        const api = apiRef.current;
        if (api) openRightPanel(api, id);
      },
      resetLayout: () => {
        localStorage.removeItem(LAYOUT_KEY);
        const api = apiRef.current;
        if (api) buildDefaultLayout(api, hostRef.current);
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
    if (!restored) buildDefaultLayout(e.api, hostRef.current);
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
        <div className="min-w-0 flex-1" ref={hostRef}>
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

function buildDefaultLayout(api: DockviewApi, host: HTMLElement | null) {
  api.clear();
  api.addPanel({ id: "viewport", component: "viewport", title: "Viewport" });
  const objects = api.addPanel({
    id: "objects",
    component: "objects",
    title: "Objects",
    position: { direction: "right" },
    initialWidth: MIN_PANEL_WIDTH,
    minimumWidth: MIN_PANEL_WIDTH,
    maximumWidth: MAX_PANEL_WIDTH,
  });
  api.addPanel({
    id: "attributes",
    component: "attributes",
    title: "Attributes",
    position: { referencePanel: "objects", direction: "below" },
    minimumWidth: MIN_PANEL_WIDTH,
  });
  api.addPanel({
    id: "materials",
    component: "materials",
    title: "Materials",
    position: { referencePanel: "attributes", direction: "within" },
    minimumWidth: MIN_PANEL_WIDTH,
  });
  api.addPanel({
    id: "environment",
    component: "environment",
    title: "Environment",
    position: { referencePanel: "attributes", direction: "within" },
    minimumWidth: MIN_PANEL_WIDTH,
  });
  api.getPanel("attributes")?.focus();

  requestAnimationFrame(() => {
    // clear() + addPanel sizes the grid to the panels' intrinsic widths and
    // fires no resize, so on a live reset the grid stays narrower than its
    // container (empty gutter, squished viewport). Force a fill to the real
    // host size, THEN pin objects — the fill hands objects its max width.
    if (host) api.layout(host.clientWidth, host.clientHeight, true);
    objects.api.setSize({ width: MIN_PANEL_WIDTH });
  });
}
