/**
 * THE noise barrel (chunk E2). The layer-stack compiler (E3), the noise gallery,
 * and any procedural material import noise functions + the registry from here.
 * Raw TSL primitives still funnel through `@/materials/tsl`.
 */
export type { FractalOpts, NoiseOpts, TriNoiseOpts, WorleyOpts } from "./functions";
export {
  cellNoise,
  curlNoise,
  fractalNoise,
  perlinNoise,
  triNoise,
  valueNoise,
  worleyNoise,
} from "./functions";
export type { NoiseCategory, NoiseDef, NoiseParam } from "./registry";
export { defaultNoiseParams, noiseDef, NOISE_DEFS } from "./registry";
