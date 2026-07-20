import type { Uuid } from "./ids";
import type { GradientRamp, ProceduralChannel } from "./procedural";

/**
 * Node-based material graph (chunk E7) — the "Substance-lite" go-forward
 * authoring model that supersedes the {@link ProceduralMaterialDoc} layer stack.
 * Pure serializable data: the compiler in `materials/graph/` turns a
 * {@link MaterialGraphDTO} into TSL nodes, one per channel, binding to the SAME
 * node-material slots the layer stack does (`colorNode`/`roughnessNode`/…) — so
 * render, bake and the embeddable viewer are unaffected by which authoring model
 * produced the graph.
 *
 * Like {@link ProceduralMaterialDoc}, the shape is designed **once**, ahead of
 * the code that fills it: `ramp`/`bump` node kinds and the `ramp` field are
 * declared now (Stage 2 compiles them) so later stages are purely additive in
 * the compiler, never a DTO migration.
 *
 * The recompile boundary is spelled out by {@link graphStructureKey}: node kind,
 * shape-selecting `select` params, and the wiring change the compiled graph's
 * SHAPE (→ recompile + swap); numeric `params`, `colors`, `ramp` stops and
 * editor `position` are live uniforms / texture data / UI-only (→ never
 * recompile). Getting a param onto the wrong side of that line is what breaks the
 * "zero recompile on scrubs" guarantee, so the split is part of the schema.
 */

/**
 * A socket carries a scalar or a 3-vector. A view-space **normal** is just a
 * `vec3` by convention (produced by a `bump` node for the Output's normal
 * socket) — coercion is purely float↔vec3, so no third socket type is needed.
 * Coercion rules: float→vec3 splats (`vec3(x)`); vec3→float takes `.r`.
 */
export type GraphSocketType = "float" | "vec3";

/**
 * The node vocabulary. Stage-1 kinds compile today; `ramp`/`bump` are declared
 * for schema stability and compile in Stage 2 (until then the compiler fails
 * safe to mid-gray, exactly as an unknown noise source does in the stack).
 *
 * - `output` — the single sink; one input socket per {@link ProceduralChannel}.
 *   An unconnected channel socket leaves that channel undriven (falls back to
 *   the material's scalar/bitmap), matching the layer stack's absent-stack case.
 * - `coord` — a sample coordinate source (`select.space`: object/world/uv) → vec3.
 * - `noise` — one of the E2 noises (`select.noise`), sampled at its `coord`
 *   input (unconnected → object space); params come from the noise registry → vec3.
 * - `float` — a scalar constant (`params.value`) → float.
 * - `color` — an rgb constant (`colors.value`) → vec3.
 * - `math` — a scalar op (`select.op`) over inputs `a`,`b` (each with an inline
 *   `params.a`/`params.b` fallback when unconnected) → float.
 * - `mix` — blend inputs `a`,`b` by `params.factor` under `select.blend` (the
 *   layer stack's blend-mode set); unconnected inputs read `colors.a`/`colors.b` → vec3.
 * - `ramp` (Stage 2) — a gradient lookup of input `t` → vec3.
 * - `bump` (Stage 2) — input `height` → view-space normal vec3.
 */
export type GraphNodeKind =
  | "output"
  | "coord"
  | "noise"
  | "float"
  | "color"
  | "math"
  | "mix"
  | "ramp"
  | "bump";

/** Scalar math operators for the `math` node (shape-selecting → structural). */
export const MATH_OPS = ["add", "subtract", "multiply", "divide", "min", "max", "power"] as const;
export type MathOp = (typeof MATH_OPS)[number];

/** Coordinate spaces for the `coord` node (shape-selecting → structural). */
export const COORD_SPACES = ["object", "world", "uv"] as const;
export type CoordSpace = (typeof COORD_SPACES)[number];

/**
 * A graph node. `id` is a stable UUID — uniform paths key on `id/param`, so an
 * array-index identity would break `update()` on reorder/delete.
 */
export interface GraphNode {
  id: Uuid;
  kind: GraphNodeKind;
  /**
   * Shape-selecting params (op, blend mode, noise id, coord space). These switch
   * which TSL is built, so they live in {@link graphStructureKey} — editing one
   * recompiles.
   */
  select?: Record<string, string>;
  /** Numeric params → live uniforms. Scrubbing these never recompiles. */
  params?: Record<string, number>;
  /** Color params (hex) → live color uniforms. */
  colors?: Record<string, string>;
  /** Gradient stops for a `ramp` node (Stage 2) → re-baked DataTexture in place. */
  ramp?: GradientRamp;
  /** Editor placement, screen px. UI-only — excluded from the structural key. */
  position?: [number, number];
}

/** A directed wire: the `from` node's output socket → the `to` node's input socket. */
export interface GraphConnection {
  from: { node: Uuid; socket: string };
  to: { node: Uuid; socket: string };
}

/**
 * A material node graph — attached to a {@link MaterialDTO} as optional `graph`
 * (parallel to `procedural`). Absent = a plain scalar/bitmap or layer-stack
 * material. `output` names the single Output node whose channel sockets the
 * compiler walks back from.
 */
export interface MaterialGraphDTO {
  nodes: GraphNode[];
  connections: GraphConnection[];
  /** Id of the single `output` node. */
  output: Uuid;
}

/** The Output node's input sockets — one per procedural channel, same order. */
export const OUTPUT_CHANNELS: ProceduralChannel[] = [
  "color",
  "roughness",
  "metalness",
  "emissive",
  "normal",
];

/** A new, empty graph: just an Output node with nothing wired in. */
export function defaultMaterialGraph(outputId: Uuid): MaterialGraphDTO {
  return {
    nodes: [{ id: outputId, kind: "output", position: [0, 0] }],
    connections: [],
    output: outputId,
  };
}

/** Default `select`/`params`/`colors` for a freshly created node of `kind`. */
export function defaultGraphNode(
  id: Uuid,
  kind: GraphNodeKind,
  position: [number, number] = [0, 0],
): GraphNode {
  const node: GraphNode = { id, kind, position };
  switch (kind) {
    case "coord":
      node.select = { space: "object" };
      break;
    case "noise":
      // params seed from the registry at compile time (materials/ owns that
      // catalog; types stays pure), so the factory leaves them empty.
      node.select = { noise: "perlin" };
      break;
    case "float":
      node.params = { value: 0 };
      break;
    case "color":
      node.colors = { value: "#808080" };
      break;
    case "math":
      node.select = { op: "add" };
      node.params = { a: 0, b: 0 };
      break;
    case "mix":
      node.select = { blend: "normal" };
      node.params = { factor: 0.5 };
      node.colors = { a: "#000000", b: "#ffffff" };
      break;
    case "bump":
      node.params = { strength: 1 };
      break;
    case "output":
    case "ramp":
      break;
  }
  return node;
}

/**
 * The structural fingerprint — everything that affects the SHAPE of the compiled
 * graph (node identity, kind, shape-selecting `select` values, the full wiring,
 * and the output node id) and nothing that is a mere uniform value. Equal keys ⇒
 * the compiled graph is reusable and an edit is a uniform poke; different keys ⇒
 * recompile + swap.
 *
 * Deliberately absent: `params`, `colors`, `ramp` stops, `position` — all live
 * uniforms, texture data, or UI-only. This is the same recompile boundary as the
 * layer stack's {@link structureKey}, adapted to a graph.
 */
export function graphStructureKey(graph: MaterialGraphDTO | undefined): string {
  if (!graph) return "";
  const nodes = [...graph.nodes]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((n) => {
      let sel = "";
      if (n.select) {
        const s = n.select;
        sel = Object.keys(s)
          .sort()
          .map((k) => `${k}=${s[k]}`)
          .join(";");
      }
      // `ramp ? "r" : "-"` mirrors the stack: whether a ramp EXISTS is
      // structural (it changes the emitted lookup), its stop values are not.
      return `${n.id}:${n.kind}:${sel}:${n.ramp ? "r" : "-"}`;
    })
    .join("|");
  const conns = [...graph.connections]
    .map((c) => `${c.from.node}.${c.from.socket}>${c.to.node}.${c.to.socket}`)
    .sort()
    .join("|");
  return `N{${nodes}}C{${conns}}O{${graph.output}}`;
}
