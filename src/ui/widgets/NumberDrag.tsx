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

  const clamp = (v: number) => {
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    return integer ? Math.round(c) : c;
  };
  const shown = editing ? text : format(value, integer ? 0 : precision);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) return;
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
    if (wasDrag) onChange(clamp(value), true);
    else {
      setText(format(value, integer ? 0 : precision));
      setEditing(true);
    }
  };

  const commitText = () => {
    setEditing(false);
    const parsed = Number.parseFloat(text.replace(",", "."));
    if (!Number.isNaN(parsed)) onChange(clamp(parsed), true);
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
        onChange={(e) => setText(e.target.value)}
        onBlur={() => editing && commitText()}
        onKeyDown={(e) => {
          if (!editing) return;
          if (e.key === "Enter") commitText();
          if (e.key === "Escape") setEditing(false);
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
