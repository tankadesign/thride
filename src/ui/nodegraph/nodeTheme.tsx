import type { ClassicPreset } from "rete";
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

interface NodeProps {
  data: ClassicPreset.Node & { selected?: boolean };
  emit: (props: unknown) => void;
}

export function ThrideNode(props: NodeProps) {
  const { id, label } = props.data;
  const inputs = Object.entries(props.data.inputs);
  const outputs = Object.entries(props.data.outputs);
  const controls = Object.entries(props.data.controls);
  const selected = props.data.selected ?? false;

  return (
    <div
      data-testid="node"
      className={`min-w-44 cursor-pointer select-none rounded-lg border bg-base-200/95 text-xs leading-none text-base-content shadow-lg shadow-black/30 ${
        selected
          ? "border-primary ring-2 ring-primary/25"
          : "border-base-300 hover:border-base-content/25"
      }`}
    >
      <div
        data-testid="title"
        className="rounded-t-lg border-b border-base-300 bg-base-300/60 px-2.5 py-1.5 text-[11px] font-semibold tracking-wide"
      >
        {label}
      </div>
      <div className="flex flex-col gap-0.5 py-1.5">
        {outputs.map(
          ([key, output]) =>
            output && (
              <div
                key={key}
                data-testid={`output-${key}`}
                className="flex items-center justify-end gap-1.5 px-2.5 py-0.5"
              >
                <span data-testid="output-title" className="opacity-70">
                  {output.label}
                </span>
                {/* socket overhangs the node edge: padding (10px) + half socket */}
                <span className="-mr-[19px] flex">
                  <RefSocket
                    name="output-socket"
                    side="output"
                    socketKey={key}
                    nodeId={id}
                    emit={props.emit}
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
              <RefControl name="control" emit={props.emit} payload={control} />
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
                    emit={props.emit}
                    payload={input.socket}
                    data-testid="input-socket"
                  />
                </span>
                <span data-testid="input-title" className="opacity-70">
                  {input.label}
                </span>
                {input.control && input.showControl ? (
                  <span className="min-w-0 flex-1" data-testid="input-control">
                    <RefControl name="input-control" emit={props.emit} payload={input.control} />
                  </span>
                ) : null}
              </div>
            ),
        )}
      </div>
    </div>
  );
}

/** Wire endpoint: a primary-accent dot with a padded grab area. */
export function ThrideSocket() {
  return (
    <div className="group cursor-pointer p-0.5">
      <div className="size-3.5 rounded-full border-2 border-base-100 bg-primary transition-transform group-hover:scale-125" />
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
        strokeWidth={2.5}
        className="pointer-events-auto stroke-primary/60"
      />
    </svg>
  );
}
