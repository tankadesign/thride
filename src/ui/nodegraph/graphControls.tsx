import type { ComponentType } from "react";
import { ClassicPreset } from "rete";
import { BLEND_MODES, GRAPH_NODE_DEFS, type GraphNode, type GraphNodeKind } from "@/types/core";
import { NOISE_DEFS } from "@/materials/noises";
import { NumberDrag } from "@/ui/widgets/NumberDrag";

/**
 * Editable Rete controls for a node's params (E7 Stage 5c). Selects
 * (noise type / op / blend / space) are shape-selecting → a change recompiles;
 * numbers and colors are live uniforms → scrubbing pokes without recompiling.
 * Each widget stops pointer events from reaching the area so interacting with it
 * never pans the canvas or drags the node.
 */

export interface ControlHandlers {
  /** Numeric param edit; `committed` false during a drag, true on release. */
  onNodeParam: (nodeId: string, key: string, value: number, committed: boolean) => void;
  /** Shape-selecting dropdown edit (structural). */
  onNodeSelect: (nodeId: string, key: string, value: string) => void;
  /** Colour edit. */
  onNodeColor: (nodeId: string, key: string, hex: string, committed: boolean) => void;
}

class SelectControl extends ClassicPreset.Control {
  constructor(
    public value: string,
    public options: { value: string; label: string }[],
    public label: string,
    public onPick: (v: string) => void,
  ) {
    super();
  }
}

class NumberControl extends ClassicPreset.Control {
  constructor(
    public value: number,
    public min: number,
    public max: number,
    public step: number,
    public label: string,
    public onEdit: (v: number, committed: boolean) => void,
  ) {
    super();
  }
}

class ColorControl extends ClassicPreset.Control {
  constructor(
    public value: string,
    public label: string,
    public onEdit: (hex: string, committed: boolean) => void,
  ) {
    super();
  }
}

/** Resolve the option list for a node's select (noise ids / blend modes / literal). */
function selectOptions(
  kind: GraphNodeKind,
  key: string,
  literal: { value: string; label: string }[],
) {
  if (kind === "noise") return NOISE_DEFS.map((d) => ({ value: d.id, label: d.label }));
  if (key === "blend") return BLEND_MODES.map((b) => ({ value: b.mode, label: b.label }));
  return literal;
}

/**
 * The controls for a node, keyed for {@link ClassicPreset.Node.addControl}. A
 * select per shape-param, a number per numeric param (noise pulls its params from
 * the registry), a swatch per colour. Inline input-fallback params (a/b that also
 * have a socket) are shown by the socket, not duplicated here.
 */
export function controlFor(dto: GraphNode, h: ControlHandlers): [string, ClassicPreset.Control][] {
  const def = GRAPH_NODE_DEFS[dto.kind];
  const out: [string, ClassicPreset.Control][] = [];

  for (const sel of def.selects) {
    const options = selectOptions(dto.kind, sel.key, sel.options);
    const value = dto.select?.[sel.key] ?? options[0]?.value ?? "";
    out.push([
      sel.key,
      new SelectControl(value, options, sel.label, (v) => h.onNodeSelect(dto.id, sel.key, v)),
    ]);
  }

  const numeric =
    dto.kind === "noise"
      ? (NOISE_DEFS.find((d) => d.id === dto.select?.noise)?.params ?? [])
      : def.params.filter((p) => !def.inputs.some((i) => i.key === p.key));
  for (const p of numeric) {
    const value = dto.params?.[p.key] ?? p.default ?? 0;
    out.push([
      p.key,
      new NumberControl(value, p.min, p.max, p.step, p.label, (v, committed) =>
        h.onNodeParam(dto.id, p.key, v, committed),
      ),
    ]);
  }

  for (const c of def.colors) {
    const value = dto.colors?.[c.key] ?? "#808080";
    out.push([
      c.key,
      new ColorControl(value, c.label, (hex, committed) =>
        h.onNodeColor(dto.id, c.key, hex, committed),
      ),
    ]);
  }
  return out;
}

/** Map a control instance to its React component (rete-react-plugin customize). */
export function renderControl(
  payload: ClassicPreset.Control,
): ComponentType<{ data: never }> | null {
  if (payload instanceof SelectControl) return SelectComp as ComponentType<{ data: never }>;
  if (payload instanceof NumberControl) return NumberComp as ComponentType<{ data: never }>;
  if (payload instanceof ColorControl) return ColorComp as ComponentType<{ data: never }>;
  return null;
}

/** Stop Rete's area from panning / selecting while a widget is used. */
const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1 py-0.5 text-[11px]" {...stop}>
      <span className="w-14 shrink-0 truncate opacity-60">{label}</span>
      {children}
    </label>
  );
}

function SelectComp({ data }: { data: SelectControl }) {
  return (
    <Row label={data.label}>
      <select
        className="select select-xs h-6 min-h-0 w-full flex-1"
        value={data.value}
        onChange={(e) => data.onPick(e.target.value)}
        {...stop}
      >
        {data.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

function NumberComp({ data }: { data: NumberControl }) {
  return (
    <Row label={data.label}>
      <div className="flex-1" {...stop}>
        <NumberDrag
          value={data.value}
          min={data.min}
          max={data.max}
          step={data.step}
          onChange={(v, committed) => data.onEdit(v, committed)}
        />
      </div>
    </Row>
  );
}

function ColorComp({ data }: { data: ColorControl }) {
  return (
    <Row label={data.label}>
      <input
        type="color"
        className="h-6 w-full flex-1 cursor-pointer rounded border border-neutral bg-transparent"
        value={data.value}
        onChange={(e) => data.onEdit(e.target.value, false)}
        onBlur={(e) => data.onEdit(e.target.value, true)}
        {...stop}
      />
    </Row>
  );
}
