import { useState } from "react";
import { useAtomValue } from "jotai";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { PaneDisplay, ShadingMode, ToneMappingMode } from "@/types/editor";
import { defaultPaneDisplay } from "@/types/editor";
import { appStore } from "@/ui/hooks/doc/document";
import { splineThicknessAtom } from "@/ui/hooks/editor/settings";
import { editorState, paneDisplaysAtom } from "@/ui/hooks/editor/viewport";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";

const SHADING: { value: ShadingMode; label: string }[] = [
  { value: "pbr", label: "PBR" },
  { value: "flat", label: "Flat" },
  { value: "wireframe", label: "Wireframe" },
];
const TONE: { value: ToneMappingMode; label: string }[] = [
  { value: "agx", label: "AgX" },
  { value: "aces", label: "ACES Filmic" },
  { value: "neutral", label: "Neutral" },
];
const AO_QUALITY = [
  { value: "8", label: "Low" },
  { value: "16", label: "Normal" },
  { value: "32", label: "High" },
];
const AO_STRENGTH = [
  { value: "#5a5a5a", label: "Subtle" },
  { value: "#323232", label: "Normal" },
  { value: "#000000", label: "Strong" },
];

/**
 * Draggable per-pane View Settings — an attribute editor for the pane's display
 * options (replaces the old viewport-background context menu). Grouped into
 * collapsible sections; nested option sets (Ambient Shadows) are their own group.
 * Edits `paneDisplaysAtom` live (the viewport re-renders via editor subscribe).
 */
export function ViewSettingsModal({
  pane,
  vs,
  onClose,
}: {
  pane: number;
  vs: ViewportSystem;
  onClose: () => void;
}) {
  const disp = useAtomValue(paneDisplaysAtom)[pane] ?? defaultPaneDisplay(pane);
  const thickness = useAtomValue(splineThicknessAtom);
  const isPbr = disp.shading === "pbr";
  const set = (patch: Partial<PaneDisplay>) => editorState.setPaneDisplay(pane, patch);

  const [pos, setPos] = useState({ x: 8, y: 44 });
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

      <div className="max-h-[min(60vh,32rem)] overflow-auto">
        <Section title="Shading" defaultOpen>
          <Row label="Mode">
            <Select
              value={disp.shading}
              options={SHADING}
              onChange={(v) => set({ shading: v as ShadingMode })}
            />
          </Row>
          <Row label="Tone Map">
            <Select
              value={disp.toneMapping}
              options={TONE}
              disabled={!isPbr}
              onChange={(v) => set({ toneMapping: v as ToneMappingMode })}
            />
          </Row>
          <Toggle
            label="Shadows"
            checked={disp.shadows}
            disabled={!isPbr}
            onChange={(v) => set({ shadows: v })}
          />
          <Toggle
            label="Backfaces"
            checked={disp.backfaces}
            onChange={(v) => set({ backfaces: v })}
          />
        </Section>

        <Section title="Ambient Shadows" defaultOpen>
          <Toggle
            label="Enabled"
            checked={disp.ssao}
            disabled={!isPbr}
            onChange={(v) => set({ ssao: v })}
          />
          <Row label="Radius">
            <NumberDrag
              value={disp.aoRadius}
              step={0.02}
              min={0.01}
              max={10}
              onChange={(v) => set({ aoRadius: v })}
            />
          </Row>
          <Row label="Quality">
            <Select
              value={String(disp.aoSamples)}
              options={AO_QUALITY}
              onChange={(v) => set({ aoSamples: Number(v) })}
            />
          </Row>
          <Row label="Strength">
            <Select
              value={disp.aoTint.toLowerCase()}
              options={AO_STRENGTH}
              onChange={(v) => set({ aoTint: v })}
            />
          </Row>
        </Section>

        <Section title="Overlays">
          <Toggle label="Grid" checked={disp.grid} onChange={(v) => set({ grid: v })} />
          <Toggle
            label="Lines"
            checked={disp.lines}
            disabled={disp.shading === "wireframe"}
            onChange={(v) => set({ lines: v })}
          />
          <Toggle
            label="Hidden Lines"
            checked={disp.hiddenLines}
            disabled={disp.shading === "wireframe" || !disp.lines}
            onChange={(v) => set({ hiddenLines: v })}
          />
          <Row label="Spline px">
            <NumberDrag
              value={thickness}
              step={0.1}
              min={1}
              max={8}
              onChange={(v) => {
                appStore.set(splineThicknessAtom, v);
                vs.setSplineThickness(v);
              }}
            />
          </Row>
        </Section>

        <Section title="Camera">
          <button
            type="button"
            className="btn btn-xs btn-block"
            onClick={() => vs.resetPaneCamera(pane)}
          >
            Reset Camera PSR
          </button>
        </Section>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-1">
      <span className="opacity-60">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row label={label}>
      <input
        type="checkbox"
        className="toggle toggle-xs"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </Row>
  );
}

function Select({
  value,
  options,
  disabled = false,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="select select-xs w-full"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-base-300/60 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-base-300/40"
      >
        <span className={`text-[8px] opacity-60 transition-transform ${open ? "rotate-90" : ""}`}>
          ▶
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {title}
        </span>
      </button>
      {open ? <div className="flex flex-col gap-1.5 px-2 pb-2">{children}</div> : null}
    </div>
  );
}
