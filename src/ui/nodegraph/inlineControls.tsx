import { useState, type ComponentType } from "react";
import { ClassicPreset } from "rete";
import { NumberDrag } from "@/ui/widgets/NumberDrag";

/**
 * Inline fallback widgets on the node canvas (E7). An UNWIRED input shows its
 * fallback value right on the node (Blender-style) so a constant never needs its
 * own node; wiring the input hides the widget (the canvas rebuilds on wiring
 * changes, and the widget is only attached to unwired inputs at build). The
 * Coordinate Space node shows its space select the same way.
 *
 * These are the ONLY value widgets on the canvas — full editing lives in the
 * Attributes panel (click / double-click a node). Every widget stops pointer +
 * double-click propagation so using it never drags the node or opens Attributes.
 */

export class InlineSelectControl extends ClassicPreset.Control {
  value: string;
  options: { value: string; label: string }[];
  onPick: (v: string) => void;

  constructor(
    value: string,
    options: { value: string; label: string }[],
    onPick: (v: string) => void,
  ) {
    super();
    this.value = value;
    this.options = options;
    this.onPick = onPick;
  }
}

export class InlineNumberControl extends ClassicPreset.Control {
  value: number;
  step: number;
  onEdit: (v: number, committed: boolean) => void;

  constructor(value: number, step: number, onEdit: (v: number, committed: boolean) => void) {
    super();
    this.value = value;
    this.step = step;
    this.onEdit = onEdit;
  }
}

export class InlineColorControl extends ClassicPreset.Control {
  value: string;
  onEdit: (hex: string, committed: boolean) => void;

  constructor(value: string, onEdit: (hex: string, committed: boolean) => void) {
    super();
    this.value = value;
    this.onEdit = onEdit;
  }
}

/**
 * Map a control instance to its React component (rete-react-plugin customize).
 * Components take the base `Control` and downcast inside — sound because this
 * registry only returns a component for its own `instanceof` match.
 */
export function renderInlineControl(
  payload: ClassicPreset.Control,
): ComponentType<{ data: ClassicPreset.Control }> | null {
  if (payload instanceof InlineSelectControl) return SelectComp;
  if (payload instanceof InlineNumberControl) return NumberComp;
  if (payload instanceof InlineColorControl) return ColorComp;
  return null;
}

/** Keep widget interaction from dragging the node / zooming / opening Attributes. */
const stop = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
};

function SelectComp(props: { data: ClassicPreset.Control }) {
  const data = props.data as InlineSelectControl;
  // local mirror — the canvas doesn't re-render on value edits, so the widget
  // owns its display value between rebuilds
  const [value, setValue] = useState(data.value);
  return (
    <select
      className="select select-xs h-6 min-h-0 w-full"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        data.onPick(e.target.value);
      }}
      {...stop}
    >
      {data.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function NumberComp(props: { data: ClassicPreset.Control }) {
  const data = props.data as InlineNumberControl;
  const [value, setValue] = useState(data.value);
  return (
    <div className="w-full" {...stop}>
      <NumberDrag
        value={value}
        step={data.step}
        onChange={(v, committed) => {
          setValue(v);
          data.onEdit(v, committed);
        }}
      />
    </div>
  );
}

function ColorComp(props: { data: ClassicPreset.Control }) {
  const data = props.data as InlineColorControl;
  return (
    <input
      type="color"
      className="h-6 w-full cursor-pointer rounded border border-neutral bg-transparent"
      defaultValue={data.value}
      onChange={(e) => data.onEdit(e.target.value, false)}
      onBlur={(e) => data.onEdit(e.target.value, true)}
      {...stop}
    />
  );
}
