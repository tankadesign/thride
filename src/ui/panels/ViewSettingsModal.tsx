import { useState } from "react";
import { useAtomValue } from "jotai";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { PaneDisplay } from "@/types/editor";
import { defaultPaneDisplay } from "@/types/editor";
import { editorState, paneDisplaysAtom } from "@/ui/hooks/editor/viewport";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";
import { PostProcessingTab } from "./viewSettings/PostProcessingTab";
import { ViewTab } from "./viewSettings/ViewTab";

/**
 * Draggable per-pane View Settings — an attribute editor for the pane's display
 * options. Two tabs (C6):
 * - **View** — how the pane draws the scene: shading, tone map, overlays, camera.
 * - **Post Processing** — everything the output graph does afterward: ambient
 *   shadows, reflections, bloom, chromatic aberration, vignette.
 *
 * Edits `paneDisplaysAtom` live (the viewport re-renders via editor subscribe).
 * The tab bodies live in `viewSettings/` — this file is the chrome only, which
 * is what keeps each piece under the 500-line limit.
 */

type Tab = "view" | "post";
const TABS: { id: Tab; label: string }[] = [
  { id: "view", label: "View" },
  { id: "post", label: "Post" },
];

export function ViewSettingsModal({
  pane,
  vs,
  initialPos,
  onClose,
}: {
  pane: number;
  vs: ViewportSystem;
  initialPos: { x: number; y: number };
  onClose: () => void;
}) {
  const disp = useAtomValue(paneDisplaysAtom)[pane] ?? defaultPaneDisplay(pane);
  const set = (patch: Partial<PaneDisplay>) => editorState.setPaneDisplay(pane, patch);
  const [tab, setTab] = useState<Tab>("view");

  const [pos, setPos] = useState(initialPos);
  const onHeaderDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // let the close button click
    const sx = e.clientX;
    const sy = e.clientY;
    const { x: px, y: py } = pos;
    const move = (ev: PointerEvent) => setPos({ x: px + ev.clientX - sx, y: py + ev.clientY - sy });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className="absolute z-20 w-60 select-none rounded-box border border-base-300 bg-base-200/95 text-xs shadow-xl backdrop-blur"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="flex cursor-move items-center justify-between rounded-t-box border-b border-base-300 bg-base-300/40 px-2 py-1.5"
        onPointerDown={onHeaderDown}
      >
        <span className="font-semibold opacity-80">View Settings</span>
        <button type="button" className="btn btn-ghost btn-xs btn-square" onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </button>
      </div>

      <div role="tablist" className="tabs tabs-box tabs-xs m-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className={`tab flex-1 ${tab === t.id ? "tab-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-h-[min(60vh,32rem)] overflow-auto">
        {tab === "view" ? (
          <ViewTab pane={pane} vs={vs} disp={disp} set={set} />
        ) : (
          <PostProcessingTab disp={disp} set={set} />
        )}
      </div>
    </div>
  );
}
