/**
 * THE procedural barrel (chunk E3). The render layer's MaterialSync compiles
 * layer stacks through here; the layer-stack editor UI reads the same registry
 * the compiler does (`@/materials/noises`).
 */
export { blendLayer } from "./blend";
export { projectedImageNode } from "./imageProjection";
export { CompiledStacks, compile, getCompileCount, resetCompileCount } from "./compile";
export { projectedSample, type TransformNodes } from "./projections";
export { RampTexture } from "./ramp";
export { UniformTable } from "./uniforms";
