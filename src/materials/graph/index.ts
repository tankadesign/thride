/**
 * The node material graph compiler (E7) — the go-forward "Substance-lite"
 * authoring model. Mirrors the `materials/procedural` barrel: a compiler that
 * turns a serializable graph into per-channel TSL nodes bound through the same
 * `assignChannelNodes` slots, so render/bake/viewer are unaffected.
 */
export {
  CompiledGraph,
  compileGraph,
  getGraphCompileCount,
  resetGraphCompileCount,
  type CompiledMaterial,
} from "./compile";
