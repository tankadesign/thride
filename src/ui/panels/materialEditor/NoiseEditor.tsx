import type { ProceduralChannel, ProceduralLayer, Projection } from "@/types/core";
import { PROJECTIONS, SHAPING_DEFAULTS as SD } from "@/types/core";
import { defaultNoiseParams, noiseDef, NOISE_DEFS } from "@/materials/noises";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { Row } from "./controls";
import { RampEditor } from "./RampEditor";

/**
 * Inline editor for a channel's noise layer, rendered under the map slot's
 * chip. Type + Projection are the only structural edits (recompile via the
 * warm-then-swap path); everything else — seed, the noise's own params, the
 * shaping group, ramp stops, bump strength — pokes live uniforms / re-bakes
 * the ramp texture with zero shader rebuild.
 */
export function NoiseEditor({
  layer,
  channel,
  onChange,
}: {
  layer: ProceduralLayer;
  channel: ProceduralChannel;
  onChange: (next: ProceduralLayer, committed: boolean) => void;
}) {
  const def = noiseDef(layer.source);
  const set = (patch: Partial<ProceduralLayer>, committed: boolean) =>
    onChange({ ...layer, ...patch }, committed);

  // swap the noise type, keeping params the two types share (scale carries over)
  const swapType = (id: string) => {
    const next = noiseDef(id);
    if (!next) return;
    const params = defaultNoiseParams(next);
    for (const key of Object.keys(params)) {
      const prev = layer.params[key];
      if (prev !== undefined) params[key] = prev;
    }
    onChange({ ...layer, source: id, name: id, params }, true);
  };

  const num = (
    label: string,
    value: number,
    apply: (v: number) => Partial<ProceduralLayer>,
    min: number,
    max: number,
    step: number,
    integer = false,
  ) => (
    <Row label={label} key={label}>
      <NumberDrag
        value={value}
        step={step}
        min={min}
        max={max}
        integer={integer}
        onChange={(v, committed) => set(apply(v), committed)}
      />
    </Row>
  );

  return (
    <div className="flex flex-col gap-1.5 border-l border-primary pl-2">
      <Row label="Type">
        <select
          className="select select-md w-full"
          value={layer.source}
          onChange={(e) => swapType(e.target.value)}
        >
          {NOISE_DEFS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </Row>
      {num("Seed", layer.seed ?? SD.seed, (v) => ({ seed: v }), 0, 999, 1, true)}
      {def?.params.map((p) => (
        <Row label={p.label} key={p.key}>
          <NumberDrag
            value={layer.params[p.key] ?? p.default}
            step={p.step}
            min={p.min}
            max={p.max}
            integer={p.integer}
            onChange={(v, committed) =>
              onChange({ ...layer, params: { ...layer.params, [p.key]: v } }, committed)
            }
          />
        </Row>
      ))}

      {num("Contrast", layer.contrast ?? SD.contrast, (v) => ({ contrast: v }), 0, 4, 0.02)}
      {num("Bias", layer.bias ?? SD.bias, (v) => ({ bias: v }), -1, 1, 0.01)}
      {num("Clip Low", layer.clipLow ?? SD.clipLow, (v) => ({ clipLow: v }), 0, 1, 0.01)}
      {num("Clip High", layer.clipHigh ?? SD.clipHigh, (v) => ({ clipHigh: v }), 0, 1, 0.01)}
      {channel === "normal"
        ? num(
            "Strength",
            layer.bumpStrength ?? SD.bumpStrength,
            (v) => ({ bumpStrength: v }),
            0,
            3,
            0.02,
          )
        : null}

      {layer.ramp ? (
        <RampEditor ramp={layer.ramp} onChange={(ramp, committed) => set({ ramp }, committed)} />
      ) : null}

      <Row label="Projection">
        <select
          className="select select-md w-full"
          value={layer.projection}
          onChange={(e) => set({ projection: e.target.value as Projection }, true)}
        >
          {PROJECTIONS.map((p) => (
            <option key={p.projection} value={p.projection}>
              {p.label}
            </option>
          ))}
        </select>
      </Row>
    </div>
  );
}
