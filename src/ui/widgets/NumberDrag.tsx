import { useEffect, useRef, useState } from "react";

interface NumberDragProps {
  value: number;
  onChange: (v: number, committed: boolean) => void;
  label?: string;
  step?: number; // value change per pixel of drag
  min?: number;
  max?: number;
  precision?: number;
}

/**
 * C4D-style numeric field: drag horizontally to scrub (streamed with
 * committed=false, one committed=true on release — maps onto interactive
 * sessions), click/double-click to type.
 */
export function NumberDrag({
  value,
  onChange,
  label,
  step = 0.01,
  min,
  max,
  precision = 3,
}: NumberDragProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ startX: number; startValue: number; moved: boolean } | null>(null);

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const shown = editing ? text : format(value, precision);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
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
      setText(format(value, precision));
      setEditing(true);
    }
  };

  const commitText = () => {
    setEditing(false);
    const parsed = Number.parseFloat(text.replace(",", "."));
    if (!Number.isNaN(parsed)) onChange(clamp(parsed), true);
  };

  return (
    <div
      className="t-num"
      data-editing={editing}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {label ? <span className="t-num-label">{label}</span> : null}
      <input
        ref={inputRef}
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
    </div>
  );
}

function format(v: number, precision: number): string {
  const s = v.toFixed(precision);
  return s.replace(/\.?0+$/, "") || "0";
}
