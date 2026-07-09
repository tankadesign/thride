/**
 * THE TSL barrel. All Three Shading Language imports go through here (never
 * scattered) so TSL API drift between three releases is absorbed in one
 * file. Grows with the noise library in chunk E2.
 */
export { normalLocal, positionLocal, uniform } from "three/tsl";
