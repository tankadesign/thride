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
 * In type-mode, ArrowUp/Down step by `step` (⌘ = 0.1×, Shift = 10×) —
 * streamed like a scrub, with one commit when the key is released.
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
  const [dragging, setDragging] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ startX: number; startValue: number; moved: boolean } | null>(null);
  // true from pointer-down until just after pointer-up, so focus events from a
  // click/drag (which may fire on mousedown OR the trailing click) don't trip
  // beginEdit — only a genuine keyboard (Tab) focus should.
  const pointerFocus = useRef(false);
  // live value across a run of arrow-key steps: key repeats can land inside one
  // React batch, where each keydown would otherwise read the same stale `text`
  // closure and the run would only ever advance a single step.
  const arrowRun = useRef<number | null>(null);
  // last value THIS field sent, so an incoming `value` change can be told apart
  // from our own echo (see the refresh effect below)
  const lastSent = useRef<number | null>(null);

  const clamp = (v: number) => {
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    return integer ? Math.round(c) : c;
  };
  const send = (v: number, committed: boolean) => {
    lastSent.current = v;
    onChange(v, committed);
  };
  const shown = editing ? text : format(value, integer ? 0 : precision);
  const fmt = () => format(value, integer ? 0 : precision);

  // The value changed under an open type-edit and it wasn't our own echo —
  // undo/redo landing while the field is focused (⌘Z passes through, see
  // onKeyDown). Refresh the shown text, else blur would commit the stale
  // pre-undo number right back. Epsilon: unit-converting parents (deg↔rad)
  // may echo our sends back with float round-trip error.
  useEffect(() => {
    if (!editing) return;
    const sent = lastSent.current;
    if (sent !== null && Math.abs(value - sent) <= Math.max(1e-9, Math.abs(value) * 1e-9)) return;
    // rebaseline: an undo followed by a redo BACK to the last-sent number must
    // read as external too, not as this field's own echo
    lastSent.current = value;
    arrowRun.current = null;
    setText(format(value, integer ? 0 : precision));
  }, [value, editing, integer, precision]);

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
    setDragging(true);
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
    setDragging(true);
    if (Math.abs(dx) > 2) drag.current.moved = true;
    if (drag.current.moved) {
      const scale = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
      send(clamp(drag.current.startValue + dx * step * scale), false);
    }
  };
  const onPointerUp = () => {
    setDragging(false);
    if (!drag.current || editing) return;
    const wasDrag = drag.current.moved;
    drag.current = null;
    // clear the pointer flag AFTER the trailing click/focus events fire
    setTimeout(() => {
      pointerFocus.current = false;
    }, 0);
    if (wasDrag) send(clamp(value), true);
    else beginEdit();
  };

  /** Parse + apply the typed value (committed). Returns the clamped value or null. */
  const commit = (): number | null => {
    const parsed = Number.parseFloat(text.replace(",", "."));
    if (Number.isNaN(parsed)) return null;
    const c = clamp(parsed);
    send(c, true);
    return c;
  };

  return (
    <label
      className={`input input-md transition-colors duration-300 ease-out w-full min-w-0 gap-1 px-1.5 focus:input-primary outline-none ${editing || dragging ? "input-primary" : "cursor-scrub select-none"}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {label ? <span className="label text-[10px] opacity-60">{label}</span> : null}
      <input
        ref={inputRef}
        className={`text-right transition-colors duration-300 ease-out focus:text-primary selection:bg-primary/30 ${dragging ? "text-primary cursor-ew-resize" : ""} ${editing ? "" : "pointer-events-none"}`}
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
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            // keyboard stepping: step per press, ⌘ = fine (0.1×), Shift = coarse
            // (10×). Streamed as previews so a held key doesn't flood history —
            // onKeyUp commits once, like a scrub release.
            e.preventDefault();
            const dir = e.key === "ArrowUp" ? 1 : -1;
            const scale = e.metaKey ? 0.1 : e.shiftKey ? 10 : 1;
            const parsed = Number.parseFloat(text.replace(",", "."));
            const start = arrowRun.current ?? (Number.isNaN(parsed) ? value : parsed);
            const c = clamp(start + dir * step * scale);
            arrowRun.current = c;
            setText(format(c, integer ? 0 : precision));
            send(c, false);
          }
          // modifier combos we didn't handle (⌘Z undo, ⇧⌘Z redo, …) must reach
          // the Shell's global shortcut handler — swallow only bare typing keys
          // and our own arrow steps (whose ⌘/⇧ are step-size modifiers).
          const arrow = e.key === "ArrowUp" || e.key === "ArrowDown";
          if (arrow || !(e.metaKey || e.ctrlKey)) e.stopPropagation();
        }}
        onKeyUp={(e) => {
          if (!editing || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
          if (arrowRun.current !== null) {
            send(clamp(arrowRun.current), true);
            arrowRun.current = null;
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
