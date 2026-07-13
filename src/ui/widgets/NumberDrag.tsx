import { useEffect, useRef, useState } from "react";

interface NumberDragProps {
  value: number;
  onChange: (v: number, committed: boolean) => void;
  label?: string;
  step?: number; // value change per pixel of drag
  min?: number;
  max?: number;
  precision?: number;
  /** Stepped integer input: values round to whole numbers. */
  integer?: boolean;
}

/**
 * C4D-style numeric field on a daisyUI input: drag horizontally to scrub
 * (streamed with committed=false, one committed=true on release — maps onto
 * interactive sessions), click to type. Shift = fine, Alt = coarse.
 */
export function NumberDrag({
  value,
  onChange,
  label,
  step = 0.01,
  min,
  max,
  precision = 3,
  integer = false,
}: NumberDragProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ startX: number; startValue: number; moved: boolean } | null>(null);
  // true from pointer-down until just after pointer-up, so focus events from a
  // click/drag (which may fire on mousedown OR the trailing click) don't trip
  // beginEdit — only a genuine keyboard (Tab) focus should.
  const pointerFocus = useRef(false);

  const clamp = (v: number) => {
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    return integer ? Math.round(c) : c;
  };
  const shown = editing ? text : format(value, integer ? 0 : precision);
  const fmt = () => format(value, integer ? 0 : precision);

  /** Enter type-mode seeded with the current value (from a click OR keyboard focus). */
  const beginEdit = () => {
    if (editing) return;
    setText(fmt());
    setEditing(true);
  };

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) return;
    pointerFocus.current = true;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // synthetic/test events have no active pointer — capture is best-effort
    }
    drag.current = { startX: e.clientX, startValue: value, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || editing) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 2) drag.current.moved = true;
    if (drag.current.moved) {
      const scale = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
      onChange(clamp(drag.current.startValue + dx * step * scale), false);
    }
  };
  const onPointerUp = () => {
    if (!drag.current || editing) return;
    const wasDrag = drag.current.moved;
    drag.current = null;
    // clear the pointer flag AFTER the trailing click/focus events fire
    setTimeout(() => {
      pointerFocus.current = false;
    }, 0);
    if (wasDrag) onChange(clamp(value), true);
    else beginEdit();
  };

  /** Parse + apply the typed value (committed). Returns the clamped value or null. */
  const commit = (): number | null => {
    const parsed = Number.parseFloat(text.replace(",", "."));
    if (Number.isNaN(parsed)) return null;
    const c = clamp(parsed);
    onChange(c, true);
    return c;
  };

  return (
    <label
      className={`input input-xs w-full min-w-0 gap-1 px-1.5 ${editing ? "" : "cursor-scrub select-none"}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {label ? <span className="label text-[10px] opacity-60">{label}</span> : null}
      <input
        ref={inputRef}
        className={`text-right ${editing ? "" : "pointer-events-none"}`}
        value={shown}
        readOnly={!editing}
        // keyboard focus (Tab) enters type-mode too, not just a pointer click.
        // Skip focus that belongs to a click/drag (pointerFocus) — pointerup
        // handles those (click → edit, drag → commit), so we neither freeze a
        // scrub nor pop into edit-mode after a drag ends.
        onFocus={() => {
          if (!pointerFocus.current) beginEdit();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!editing) return;
          commit();
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (!editing) return;
          if (e.key === "Enter") {
            // apply but STAY focused + editable (Enter shouldn't drop the field)
            const c = commit();
            if (c !== null) setText(format(c, integer ? 0 : precision));
          } else if (e.key === "Escape") {
            setEditing(false); // cancel — revert to the current value
            inputRef.current?.blur();
          }
          e.stopPropagation();
        }}
      />
    </label>
  );
}

function format(v: number, precision: number): string {
  const s = v.toFixed(precision);
  return s.replace(/\.?0+$/, "") || "0";
}
