import { vec3 } from "@/materials/tsl";
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
 * noise, with its tunable params and a preview color node. Drives the noise
 * gallery and is the menu the layer-stack compiler (E3) offers. `preview`
 * builds a display-ready vec3 (grayscale for scalar noises, remapped flow for
 * curl) from slider values + an animation `phase` node.
 */

// biome-ignore lint/suspicious/noExplicitAny: TSL node
type Node = any;

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
  /** Display color (vec3) from param values + a phase node — for the gallery. */
  preview: (v: Record<string, number>, phase: Node) => Node;
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
    preview: (v, phase) => vec3(perlinNoise({ scale: v.scale, phase })),
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
    preview: (v, phase) =>
      vec3(
        fractalNoise({
          scale: v.scale,
          phase,
          octaves: v.octaves,
          lacunarity: v.lacunarity,
          gain: v.gain,
        }),
      ),
  },
  {
    id: "worley",
    label: "Worley (cellular)",
    category: "cellular",
    params: [SCALE, { key: "jitter", label: "Jitter", default: 1, min: 0, max: 1, step: 0.02 }],
    preview: (v, phase) => vec3(worleyNoise({ scale: v.scale, phase, jitter: v.jitter })),
  },
  {
    id: "cell",
    label: "Cell",
    category: "cellular",
    params: [SCALE],
    preview: (v, phase) => vec3(cellNoise({ scale: v.scale, phase })),
  },
  {
    id: "value",
    label: "Value",
    category: "gradient",
    params: [SCALE],
    preview: (v, phase) => vec3(valueNoise({ scale: v.scale, phase })),
  },
  {
    id: "tri",
    label: "Tri (animated)",
    category: "gradient",
    params: [SCALE, { key: "speed", label: "Speed", default: 0.2, min: 0, max: 2, step: 0.02 }],
    preview: (v, phase) => vec3(triNoise({ scale: v.scale, phase, speed: v.speed })),
  },
  {
    id: "curl",
    label: "Curl (flow)",
    category: "flow",
    params: [SCALE],
    // vec3 flow field → color: remap the signed components to [0,1]
    preview: (v, phase) => curlNoise({ scale: v.scale, phase }).mul(0.5).add(0.5),
  },
];

/** Default param values for a noise def. */
export function defaultNoiseParams(def: NoiseDef): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

export function noiseDef(id: string): NoiseDef | undefined {
  return NOISE_DEFS.find((d) => d.id === id);
}
