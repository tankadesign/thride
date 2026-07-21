import { useRef, useState } from "react";
import { IconClose } from "@/icons";
import type { GradientRamp, GradientStop } from "@/types/core";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { Row } from "./controls";
import { ColorPicker } from "@/ui/widgets/ColorPicker";

/**
 * Multi-stop gradient ramp editor (the Color/Emissive noise mapping).
 *
 * A gradient bar with draggable stop handles: click an empty spot on the bar to
 * add a stop (color interpolated from its neighbors), drag a handle to move it
 * (live preview, one undo step on release), and edit the selected stop's color
 * and position below. Delete is disabled at two stops — a ramp needs a span.
 *
 * Ramp edits re-bake the compiled stack's DataTexture in place (E3), so
 * everything here is recompile-free.
 */
export function RampEditor({
  ramp,
  onChange,
}: {
  ramp: GradientRamp;
  onChange: (ramp: GradientRamp, committed: boolean) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState(0);
  const stops = ramp.stops;
  const selected = stops[Math.min(sel, stops.length - 1)];

  const setStop = (index: number, patch: Partial<GradientStop>, committed: boolean) => {
    const next = stops.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange({ stops: next }, committed);
  };

  const addStopAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onChange({ stops: [...stops, { t, color: colorAt(stops, t) }] }, true);
    setSel(stops.length);
  };

  const dragStop = (index: number, e: React.PointerEvent) => {
    e.stopPropagation(); // the bar's own pointerdown adds stops
    setSel(index);
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved = true;
      const t = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      setStop(index, { t }, false);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) {
        const t = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
        setStop(index, { t }, true);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const gradient = [...stops]
    .sort((a, b) => a.t - b.t)
    .map((s) => `${s.color} ${(s.t * 100).toFixed(1)}%`)
    .join(", ");

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: stop handles are the buttons; the bar click is an add shortcut */}
      <div
        ref={barRef}
        className="relative h-4 cursor-copy rounded border border-base-300"
        style={{ background: `linear-gradient(to right, ${gradient})` }}
        onPointerDown={(e) => addStopAt(e.clientX)}
        title="Click to add a stop"
      >
        {stops.map((s, i) => (
          <button
            key={`${i}-${stops.length}`}
            type="button"
            className={`absolute top-[-2px] h-[calc(100%+4px)] w-2 -translate-x-1/2 cursor-ew-resize rounded-sm border ${
              i === sel ? "border-primary bg-base-100" : "border-base-content/40 bg-base-100/70"
            }`}
            style={{ left: `${s.t * 100}%` }}
            onPointerDown={(e) => dragStop(i, e)}
            // keyboard activation (Enter/Space) fires click, not pointerdown —
            // without this, stops can't be selected without a mouse
            onClick={(e) => {
              e.stopPropagation();
              setSel(i);
            }}
            title={`Stop at ${s.t.toFixed(2)}`}
          />
        ))}
      </div>
      {selected ? (
        <Row label="Stop">
          <div className="flex items-center gap-1">
            <div className="flex flex-1 items-center gap-3">
              <ColorPicker
                color={selected.color}
                onChange={(e) => setStop(sel, { color: e.target.value }, true)}
              />

              <NumberDrag
                value={selected.t}
                step={0.01}
                min={0}
                max={1}
                onChange={(v, committed) => setStop(sel, { t: v }, committed)}
              />
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-xs px-1 opacity-60"
              disabled={stops.length <= 2}
              onClick={() => {
                onChange({ stops: stops.filter((_, i) => i !== sel) }, true);
                setSel(0);
              }}
              title="Delete stop"
            >
              <IconClose size={11} />
            </button>
          </div>
        </Row>
      ) : null}
    </>
  );
}

/** Color of the sorted ramp at `t` — the interpolated color for an inserted stop. */
function colorAt(stops: GradientStop[], t: number): string {
  const sorted = [...stops].sort((a, b) => a.t - b.t);
  const first = sorted[0];
  if (!first) return "#808080";
  let lo = first;
  let hi = sorted[sorted.length - 1] ?? first;
  for (const s of sorted) {
    if (s.t <= t) lo = s;
    if (s.t >= t) {
      hi = s;
      break;
    }
  }
  const span = hi.t - lo.t;
  const f = span > 1e-6 ? (t - lo.t) / span : 0;
  const a = rgb(lo.color);
  const b = rgb(hi.color);
  return `#${a
    .map((v, i) =>
      Math.round(v + ((b[i] ?? v) - v) * f)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const rgb = (hex: string): number[] => [
  Number.parseInt(hex.slice(1, 3), 16) || 0,
  Number.parseInt(hex.slice(3, 5), 16) || 0,
  Number.parseInt(hex.slice(5, 7), 16) || 0,
];
