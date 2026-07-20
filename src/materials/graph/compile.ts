import type { MaterialGraphDTO, ProceduralChannel } from "@/types/core";
import { graphStructureKey, OUTPUT_CHANNELS, PROCEDURAL_CHANNELS } from "@/types/core";
import { vec3, type Vec3 } from "@/materials/tsl";
import { UniformTable } from "@/materials/procedural/uniforms";
import { GraphEmit, toVec3, updateGraphUniforms } from "./emit";

/**
 * The graph compiler (E7) — {@link MaterialGraphDTO} → one TSL node per channel,
 * plus the {@link UniformTable} that lets every non-structural edit apply
 * WITHOUT recompiling.
 *
 * Its output deliberately matches the layer-stack compiler's `CompiledStacks`
 * shape (see {@link CompiledMaterial}): the same `nodes` map, `applies`/`update`
 * recompile-gate, and `dispose`. That's what lets the render/bake/viewer bind
 * path (`assignChannelNodes`) and `MaterialSync` consume a graph exactly as they
 * consume a stack — the two are alternative front-ends over one compile target.
 */

/**
 * The compiler-output contract shared by the layer-stack (`CompiledStacks`) and
 * graph (`CompiledGraph`) compilers. Made explicit so the binder can be widened
 * to accept either without either compiler knowing about the other. (The binder
 * is NOT widened yet — that's Stage 3; this interface documents the target.)
 */
export interface CompiledMaterial<TDoc> {
  /** Channel → composited TSL node (vec3; scalar channels are `.r`'d at bind). */
  readonly nodes: Partial<Record<ProceduralChannel, Vec3>>;
  /** Structural fingerprint of the doc this was compiled from. */
  readonly key: string;
  /** True if `doc` differs only in uniform values (same structure). */
  applies(doc: TDoc): boolean;
  /** Push `doc`'s values into the live uniforms. Caller must have checked `applies`. */
  update(doc: TDoc): void;
  dispose(): void;
}

const SCALAR = new Set<ProceduralChannel>(
  PROCEDURAL_CHANNELS.filter((c) => c.scalar).map((c) => c.channel),
);

/** A compiled graph: per-channel nodes + everything needed to live-update them. */
export class CompiledGraph implements CompiledMaterial<MaterialGraphDTO> {
  readonly nodes: Partial<Record<ProceduralChannel, Vec3>> = {};
  readonly uniforms = new UniformTable();
  readonly key: string;

  constructor(graph: MaterialGraphDTO) {
    this.key = graphStructureKey(graph);
    const out = graph.nodes.find((n) => n.id === graph.output && n.kind === "output");
    if (!out) return;
    const emit = new GraphEmit(graph, this.uniforms);
    for (const channel of OUTPUT_CHANNELS) {
      const conn = graph.connections.find((c) => c.to.node === out.id && c.to.socket === channel);
      if (!conn) continue; // undriven channel → falls back to the material scalar
      const value = toVec3(emit.emit(conn.from.node));
      // store vec3 for every channel and re-`.r` scalars at bind (identical to
      // CompiledStacks), so the binder treats graph and stack nodes the same way.
      // The normal channel binds directly — the bump node (Stage 2) already emits
      // a view-space normal, so there is NO central height→normal step here.
      this.nodes[channel] = SCALAR.has(channel) ? vec3(value.r) : value;
    }
  }

  applies(graph: MaterialGraphDTO): boolean {
    return graphStructureKey(graph) === this.key;
  }

  update(graph: MaterialGraphDTO): void {
    // emit.ts owns the path scheme so create/poke can never drift
    updateGraphUniforms(this.uniforms, graph);
  }

  dispose(): void {
    // Stage 2 adds ramp DataTextures to dispose; nothing owns GPU resources yet.
  }
}

/**
 * Compile `graph`. Every call builds a fresh node graph — the counter lets the
 * E7 acceptance test ("param edits never recompile") assert against a real,
 * observable number rather than a proxy (mirrors the stack's `getCompileCount`).
 */
export function compileGraph(graph: MaterialGraphDTO): CompiledGraph {
  graphCompileCount++;
  return new CompiledGraph(graph);
}

let graphCompileCount = 0;

/** Total {@link compileGraph} calls this session. Instrumentation for the E7 test. */
export const getGraphCompileCount = (): number => graphCompileCount;
export const resetGraphCompileCount = (): void => {
  graphCompileCount = 0;
};
