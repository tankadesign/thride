import { float, positionLocal, vec3, type Float, type Vec3 } from "@/materials/tsl";
import {
  cellNoise,
  curlNoise,
  fractalNoise,
  perlinNoise,
  triNoise,
  valueNoise,
  worleyNoise,
} from "./functions";

/**
 * Declarative catalog of the noise library (chunk E2): one {@link NoiseDef} per
 * noise, with its tunable params and a `sample` node builder. Drives the noise
 * gallery and is the menu the layer-stack compiler (E3) compiles from.
 *
 * `sample` takes **nodes**, not numbers — that's what lets E3 wire every param
 * to a live uniform so slider drags poke `.value` instead of recompiling. The
 * gallery's number-valued previews go through {@link previewNode}, which just
 * wraps its values in constant nodes.
 */

export type NoiseCategory = "gradient" | "fractal" | "cellular" | "flow";

export interface NoiseParam {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  /** Round to whole numbers (octaves). */
  integer?: boolean;
}

export interface NoiseDef {
  id: string;
  label: string;
  category: NoiseCategory;
  params: NoiseParam[];
  /**
   * The noise as a **vec3** in [0,1] — grayscale for the scalar noises, the
   * remapped field for curl. `pos` is the (already projected) sample coordinate
   * the noise scales internally; `params` are nodes keyed by `NoiseParam.key`;
   * `phase` animates (folded into z, except where a noise documents otherwise).
   */
  sample: (pos: Vec3, params: Record<string, Float>, phase: Float) => Vec3;
}

const SCALE: NoiseParam = {
  key: "scale",
  label: "Scale",
  default: 3,
  min: 0.1,
  max: 20,
  step: 0.1,
};

export const NOISE_DEFS: NoiseDef[] = [
  {
    id: "perlin",
    label: "Perlin",
    category: "gradient",
    params: [SCALE],
    sample: (pos, p, phase) => vec3(perlinNoise({ pos, scale: p.scale, phase })),
  },
  {
    id: "fractal",
    label: "Fractal (fBm)",
    category: "fractal",
    params: [
      SCALE,
      { key: "octaves", label: "Octaves", default: 4, min: 1, max: 8, step: 1, integer: true },
      { key: "lacunarity", label: "Lacunarity", default: 2, min: 1, max: 4, step: 0.1 },
      { key: "gain", label: "Gain", default: 0.5, min: 0, max: 1, step: 0.02 },
    ],
    sample: (pos, p, phase) =>
      vec3(
        fractalNoise({
          pos,
          scale: p.scale,
          phase,
          octaves: p.octaves,
          lacunarity: p.lacunarity,
          gain: p.gain,
        }),
      ),
  },
  {
    id: "worley",
    label: "Worley (cellular)",
    category: "cellular",
    params: [SCALE, { key: "jitter", label: "Jitter", default: 1, min: 0, max: 1, step: 0.02 }],
    sample: (pos, p, phase) => vec3(worleyNoise({ pos, scale: p.scale, phase, jitter: p.jitter })),
  },
  {
    id: "cell",
    label: "Cell",
    category: "cellular",
    params: [SCALE],
    sample: (pos, p, phase) => vec3(cellNoise({ pos, scale: p.scale, phase })),
  },
  {
    id: "value",
    label: "Value",
    category: "gradient",
    params: [SCALE],
    sample: (pos, p, phase) => vec3(valueNoise({ pos, scale: p.scale, phase })),
  },
  {
    // three's triNoise3D. Label avoids "Tri" — users read it as triplanar (a
    // projection). Its speed param is hidden until the animation system (chunk
    // G) gives phase a time source; a speed knob with no way to play it is
    // just confusing.
    id: "tri",
    label: "Turbulence",
    category: "gradient",
    params: [SCALE],
    sample: (pos, p, phase) => vec3(triNoise({ pos, scale: p.scale, phase })),
  },
  {
    id: "curl",
    label: "Curl (flow)",
    category: "flow",
    params: [SCALE],
    // vec3 flow field → color: remap the signed components to [0,1]
    sample: (pos, p, phase) => curlNoise({ pos, scale: p.scale, phase }).mul(0.5).add(0.5),
  },
];

/** Default param values for a noise def. */
export function defaultNoiseParams(def: NoiseDef): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

/**
 * A gallery preview: {@link NoiseDef.sample} over `positionLocal` with plain
 * numbers wrapped as constant nodes. E3 calls `sample` directly instead, with
 * uniform nodes and a projected coordinate.
 */
export function previewNode(def: NoiseDef, v: Record<string, number>, phase: Float): Vec3 {
  const params: Record<string, Float> = {};
  for (const p of def.params) params[p.key] = float(v[p.key] ?? p.default);
  return def.sample(positionLocal, params, phase);
}

export function noiseDef(id: string): NoiseDef | undefined {
  return NOISE_DEFS.find((d) => d.id === id);
}
