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
