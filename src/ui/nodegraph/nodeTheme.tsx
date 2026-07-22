import { IconError, IconSolo } from "@/icons";
import { ClassicPreset } from "rete";
import { Presets } from "rete-react-plugin";

/**
 * Thride-themed node/socket/connection components for the Rete canvas —
 * replacing the classic preset's styled-components look (blue boxes) with the
 * app's daisyUI `sunset` palette via Tailwind utilities, so the node editor
 * reads as part of the UI (same panel greys, primary accent, `-xs` type scale).
 *
 * The DOM contract of the classic preset is preserved: the same `data-testid`s
 * (`node`/`title`/`input-socket`/`output-socket`/…) and RefSocket/RefControl
 * registration, so socket position tracking, wire hit-testing, and our
 * right-click / double-click / delete handling all keep working unchanged.
 * Unlike the default, an input with an inline fallback control shows its label
 * AND the widget (the default hides the label, which loses context for A/B).
 */

const { RefSocket, RefControl, useConnection } = Presets.classic;

/**
 * Node payload carrying build-time editor state (same pattern as
 * {@link ThrideSocketData}): a structural `problem` for the error badge, and
 * whether the node shows a preview thumbnail. Both are structural facts, so the
 * canvas rebuild keeps them current.
 */
export class ThrideNodeData extends ClassicPreset.Node {
  /** Why this node isn't contributing (cycle, unknown noise) — shows a badge. */
  problem?: string;
  /** Reserve a preview strip (every kind except the Output sink). */
  showPreview = false;
  /** Bypassed: passthrough (dimmed, toggle-xs in the title). */
  bypass = false;
  /** Soloed: the material's color previews only this node (monocle button). */
  solo = false;
  onToggleBypass?: (on: boolean) => void;
  onToggleSolo?: (on: boolean) => void;
}

interface NodeProps {
  data: ClassicPreset.Node;
  /** Passed at runtime by the classic preset; its declared prop type omits it. */
  emit?: unknown;
}

export function ThrideNode(props: NodeProps) {
  const emit = props.emit as (p: unknown) => void;
  const { id, label } = props.data;
  const inputs = Object.entries(props.data.inputs);
  const outputs = Object.entries(props.data.outputs);
  const controls = Object.entries(props.data.controls);
  const selected = (props.data as { selected?: boolean }).selected ?? false;
  const meta = props.data instanceof ThrideNodeData ? props.data : undefined;
  const problem = meta?.problem;
  const showPreview = meta?.showPreview ?? false;
  let nodeColors = "text-base-content border-base-content/15 hover:border-base-content/25";
  if (selected) {
    if (problem) nodeColors = "text-secondary border-secondary/60 bg-[var(--color-problem)]";
    else nodeColors = "text-base-content bg-[var(--color-node)]";
  } else if (problem) {
    nodeColors = "text-secondary border-secondary/30 bg-[var(--color-problem)]";
  } else if (meta?.solo) {
    nodeColors = "text-primary border-primary/60 bg-[var(--color-solo)]";
  }

  // solo/bypass widgets must never start a drag / selection / inspect
  const stop = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
  };

  return (
    <div
      data-testid="node"
      className={`min-w-44 cursor-pointer select-none rounded-lg border bg-base-200/95 text-xs leading-none shadow-lg shadow-base-100/60 ${nodeColors}`}
    >
      <div
        data-testid="title"
        className="flex items-center gap-2 rounded-t-lg border-b border-base-300 bg-base-300/60 px-2.5 py-1.5 text-xs font-semibold tracking-wide"
      >
        <span className={`flex-1 truncate ${meta?.bypass ? "opacity-25" : ""}`}>{label}</span>
        {meta?.showPreview ? (
          <span className="flex shrink-0 items-center gap-1.5" {...stop}>
            <button
              type="button"
              data-node-solo=""
              disabled={meta.bypass}
              title={meta.solo ? "Un-solo" : "Solo — preview only this node's value"}
              className={`flex size-4 cursor-pointer items-center justify-center transition-opacity disabled:cursor-not-allowed ${
                meta.solo ? "text-primary" : "opacity-70 not-disabled:hover:opacity-100"
              }`}
              onClick={!meta.bypass ? () => meta.onToggleSolo?.(!meta.solo) : undefined}
            >
              <IconSolo />
            </button>
            <input
              type="checkbox"
              data-node-bypass=""
              disabled={meta.solo}
              title="Bypass — pass the first wired input straight through"
              className={`toggle toggle-xs ${problem ? "toggle-secondary" : ""}`}
              checked={!meta.bypass}
              onChange={(e) => meta.onToggleBypass?.(!e.target.checked)}
            />
          </span>
        ) : null}
        {problem ? (
          <span title={problem} className="shrink-0">
            <IconError />
          </span>
        ) : null}
      </div>
      {showPreview ? (
        <div className={`px-1.5 pt-1.5 ${meta?.bypass ? "opacity-25" : ""}`}>
          {/* filled imperatively by the panel's thumbnail pass (data-node-thumb) —
              the canvas never re-renders on value edits, so src rides outside React */}
          <img
            data-node-thumb={id}
            alt=""
            draggable={false}
            className="h-12 w-full rounded bg-base-300/40 object-cover opacity-0 transition-opacity duration-150"
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-0.5 py-1.5">
        {outputs.map(
          ([key, output]) =>
            output && (
              <div
                key={key}
                data-testid={`output-${key}`}
                className="flex items-center justify-end gap-1.5 px-2.5 py-0.5"
              >
                <span
                  data-testid="output-title"
                  className={`${meta?.bypass ? "opacity-25" : "opacity-70"}`}
                >
                  {output.label}
                </span>
                {/* socket overhangs the node edge: padding (10px) + half socket */}
                <span className="-mr-[19px] flex">
                  <RefSocket
                    name="output-socket"
                    side="output"
                    socketKey={key}
                    nodeId={id}
                    emit={emit}
                    payload={output.socket}
                    data-testid="output-socket"
                  />
                </span>
              </div>
            ),
        )}
        {controls.map(([key, control]) =>
          control ? (
            <div key={key} data-testid={`control-${key}`} className="px-2.5 py-0.5">
              <RefControl name="control" emit={emit} payload={control} />
            </div>
          ) : null,
        )}
        {inputs.map(
          ([key, input]) =>
            input && (
              <div
                key={key}
                data-testid={`input-${key}`}
                className="flex items-center gap-1.5 px-2.5 py-0.5"
              >
                <span className="-ml-[19px] flex">
                  <RefSocket
                    name="input-socket"
                    side="input"
                    socketKey={key}
                    nodeId={id}
                    emit={emit}
                    payload={input.socket}
                    data-testid="input-socket"
                  />
                </span>
                <span
                  data-testid="input-title"
                  className={`${meta?.bypass ? "opacity-25" : "opacity-70"}`}
                >
                  {input.label}
                </span>
                {input.control && input.showControl ? (
                  <span className="min-w-0 flex-1" data-testid="input-control">
                    <RefControl name="input-control" emit={emit} payload={input.control} />
                  </span>
                ) : null}
              </div>
            ),
        )}
      </div>
    </div>
  );
}

/**
 * Socket payload carrying its wiring state. The socket component only ever
 * receives its payload, so connectivity has to ride IN the payload — sound
 * because the canvas rebuilds on every wiring change (`canvasSig`), making
 * build-time connectivity always current. `buildNode` (which knows the graph)
 * instantiates one per socket.
 */
export class ThrideSocketData extends ClassicPreset.Socket {
  connected: boolean;

  constructor(connected: boolean) {
    super("s");
    this.connected = connected;
  }
}

/** Wire endpoint: hollow when free, filled `bg-primary` once a wire attaches. */
export function ThrideSocket(props: { data: ClassicPreset.Socket }) {
  const connected = props.data instanceof ThrideSocketData && props.data.connected;
  return (
    <div className="group cursor-pointer p-0.5">
      <div
        className={`size-3.5 rounded-full border-2 border-base-100 ring-1 transition-transform group-hover:scale-125 ${
          connected ? "bg-primary ring-primary" : "bg-base-100 ring-base-content"
        }`}
      />
    </div>
  );
}

/** A wire — the classic preset's curve, restroked in the theme's primary. */
export function ThrideConnection() {
  const { path } = useConnection();
  if (!path) return null;
  return (
    <svg
      data-testid="connection"
      className="pointer-events-none absolute h-[9999px] w-[9999px] overflow-visible!"
    >
      <path
        d={path}
        fill="none"
        strokeWidth={1.25}
        className="pointer-events-auto stroke-primary/40"
      />
    </svg>
  );
}
