/**
 * THE TSL barrel. All Three Shading Language imports go through here (never
 * scattered) so TSL API drift between three releases is absorbed in one
 * file. Grows with the noise library in chunk E2.
 */
export { normalLocal, positionLocal, uniform } from "three/tsl";
export {
  dot,
  float,
  fract,
  mix,
  renderOutput,
  screenCoordinate,
  smoothstep,
  texture,
  vec3,
  vec2,
} from "three/tsl";
// G-buffer / MRT nodes for the SSR pass (view-space normals + material outputs)
export { metalness, mrt, normalView, output, pass, roughness } from "three/tsl";
// Temporal SSR G-buffer: packed normals, material albedo/metal/rough, motion vectors
export {
  diffuseColor,
  materialMetalness,
  materialRoughness,
  packNormalToRGB,
  sample,
  unpackRGBToNormal,
  vec4,
  velocity,
} from "three/tsl";
// Planar (mirrored-camera) reflections: reflector + roughness-blurred sampling
export { materialColor, reflector, textureBicubic } from "three/tsl";
// degenerate-value guards in the SSR graph
export { lengthSq, select } from "three/tsl";
// E2 noise library — raw primitives the `noises/` factories build on. Kept here
// so three/tsl API drift stays absorbed in one file (see header).
export { abs, cross, Fn, int, normalize, time, uv } from "three/tsl";
// E3 layer-stack compiler: blend-mode operators + projection math
export { max, min, step } from "three/tsl";
// E4 projections: angular (cylindrical/spherical), triplanar blend, camera
export { acos, atan, length, pow, screenUV } from "three/tsl";
// noise-map normal channel: derivative bump (three's perturbNormalArb inputs)
export { faceDirection, positionView } from "three/tsl";
// infinite adaptive grid: world position + screen-space derivatives + LOD math
export { clamp, exp, floor, fwidth, log, positionWorld } from "three/tsl";
// projected image maps: material property accessors the samples modulate
export { materialEmissive } from "three/tsl";
export {
  hash,
  mx_cell_noise_float,
  mx_fractal_noise_float,
  mx_fractal_noise_vec3,
  mx_noise_float,
  mx_noise_vec3,
  mx_unifiednoise3d,
  mx_worley_noise_float,
  triNoise3D,
} from "three/tsl";
