import type {
  BlendMode,
  GraphConnection,
  GraphNode,
  GraphSocketType,
  MaterialGraphDTO,
  MathOp,
  Projection,
  Uuid,
} from "@/types/core";
import { defaultRamp, GRAPH_NODE_DEFS, SHAPING_DEFAULTS as SD } from "@/types/core";
import {
  max,
  min,
  positionLocal,
  positionWorld,
  pow,
  texture,
  uv,
  vec2,
  vec3,
  type Float,
  type Vec3,
} from "@/materials/tsl";
import { noiseDef } from "@/materials/noises";
import { blendLayer } from "@/materials/procedural/blend";
import { bumpNormal } from "@/materials/procedural/bump";
import { projectedSample } from "@/materials/procedural/projections";
import { RampTexture } from "@/materials/procedural/ramp";
import { shapeValue } from "@/materials/procedural/shape";
import type { UniformTable } from "@/materials/procedural/uniforms";

/**
 * Per-node TSL emission for the graph compiler (E7). Split from
 * {@link ./compile} so the node vocabulary and its live-uniform paths live in one
 * place — the same path builders {@link P} are used by emission (which creates
 * the uniforms) and by {@link updateGraphUniforms} (which pokes them), so the two
 * can never drift.
 *
 * A node emits a tagged value ({@link Emitted}): the TSL node plus its socket
 * type, so an input socket can coerce (float↔vec3) at the wire. Every numeric
 * param becomes a live uniform keyed `nodeId/…`, so scrubbing never recompiles.
 */

/** A node's output: the TSL value plus the socket type it carries. */
export interface Emitted {
  value: Vec3 | Float;
  type: GraphSocketType;
}

/** Unknown/cyclic/unhandled node → mid-gray, so a graph always renders. */
const FALLBACK: Emitted = { value: vec3(0.5), type: "vec3" };

// Coercion to the socket type an input feeds: float↔vec3 only. `Emitted.type`
// is the runtime tag for `value`, so the casts below are checked by it —
// float → vec3 splats the scalar; vec3 → float reads `.r` (the stack's rule).
function coerceVec3(e: Emitted): Vec3 {
  return e.type === "vec3" ? (e.value as Vec3) : vec3(e.value as Float);
}
function coerceFloat(e: Emitted): Float {
  return e.type === "float" ? (e.value as Float) : (e.value as Vec3).r;
}
function coerce(e: Emitted, to: GraphSocketType): Vec3 | Float {
  return to === "vec3" ? coerceVec3(e) : coerceFloat(e);
}

/** Live-uniform path builders — shared by emission and {@link updateGraphUniforms}. */
const P = {
  param: (id: Uuid, k: string) => `${id}/param.${k}`,
  phase: (id: Uuid) => `${id}/phase`,
  seed: (id: Uuid) => `${id}/seed`,
  value: (id: Uuid) => `${id}/value`,
  color: (id: Uuid) => `${id}/color`,
  factor: (id: Uuid) => `${id}/factor`,
  strength: (id: Uuid) => `${id}/strength`,
  /** shaping knob (clipLow/clipHigh/contrast/bias) — mirrors the layer paths. */
  shaping: (id: Uuid, k: string) => `${id}/${k}`,
  /** inline float fallback for an unconnected input socket. */
  in: (id: Uuid, s: string) => `${id}/in.${s}`,
  /** inline color fallback for an unconnected input socket. */
  inc: (id: Uuid, s: string) => `${id}/inc.${s}`,
};

/** The noise node's shaping knobs — same keys/defaults as a layer's shaping. */
const SHAPING_KEYS = ["clipLow", "clipHigh", "contrast", "bias"] as const;
const SHAPING_DEFAULT: Record<(typeof SHAPING_KEYS)[number], number> = {
  clipLow: SD.clipLow,
  clipHigh: SD.clipHigh,
  contrast: SD.contrast,
  bias: SD.bias,
};

/** Identity projector placement for an unwired noise's projection sampling —
 *  wire a Coordinate Space (or any vec3) into `coord` for custom placement. */
const IDENTITY = { offset: vec3(0, 0, 0), rotation: vec3(0, 0, 0), scale: vec3(1, 1, 1) };

const MATH: Record<MathOp, (a: Float, b: Float) => Float> = {
  add: (a, b) => a.add(b),
  subtract: (a, b) => a.sub(b),
  multiply: (a, b) => a.mul(b),
  divide: (a, b) => a.div(b),
  min: (a, b) => min(a, b),
  max: (a, b) => max(a, b),
  power: (a, b) => pow(a, b),
};

/**
 * Compiles a graph to TSL, memoizing per node and guarding against cycles. One
 * instance per compile pass; {@link emit} is the entry point the Output node's
 * channel sockets call.
 */
export class GraphEmit {
  private readonly byId = new Map<Uuid, GraphNode>();
  private readonly memo = new Map<Uuid, Emitted>();
  private readonly visiting = new Set<Uuid>();
  /** Ramp DataTextures built this pass, keyed by node id — the compiler re-bakes
   *  them on a stop edit (no recompile) and disposes them with the graph. */
  readonly ramps = new Map<Uuid, RampTexture>();

  private readonly graph: MaterialGraphDTO;
  private readonly uniforms: UniformTable;

  constructor(graph: MaterialGraphDTO, uniforms: UniformTable) {
    this.graph = graph;
    this.uniforms = uniforms;
    for (const n of graph.nodes) this.byId.set(n.id, n);
  }

  /** The value at a node's output socket (memoized; cycles → mid-gray). */
  emit(id: Uuid): Emitted {
    const cached = this.memo.get(id);
    if (cached) return cached;
    // a back-edge to a node still on the stack is a cycle — fail safe rather
    // than recurse forever. The offending wire reads mid-gray; the rest compiles.
    if (this.visiting.has(id)) return FALLBACK;
    this.visiting.add(id);
    const node = this.byId.get(id);
    const result = node ? this.emitKind(node) : FALLBACK;
    this.visiting.delete(id);
    this.memo.set(id, result);
    return result;
  }

  private incoming(nodeId: Uuid, socket: string): GraphConnection | undefined {
    return this.graph.connections.find((c) => c.to.node === nodeId && c.to.socket === socket);
  }

  /** The value feeding an input socket: the wired source, or the inline fallback. */
  private input(
    node: GraphNode,
    socket: string,
    type: GraphSocketType,
    fallback: () => Vec3 | Float,
  ): Vec3 | Float {
    const conn = this.incoming(node.id, socket);
    return conn ? coerce(this.emit(conn.from.node), type) : fallback();
  }

  /** Bypass: the first WIRED input passes straight through, coerced to the
   *  node's output type; a bypassed source (nothing wired) reads as mid-gray. */
  private bypassed(node: GraphNode): Emitted {
    const def = GRAPH_NODE_DEFS[node.kind];
    const out = def.output ?? "vec3";
    for (const s of def.inputs) {
      const conn = this.incoming(node.id, s.key);
      if (conn) return { value: coerce(this.emit(conn.from.node), out), type: out };
    }
    return FALLBACK;
  }

  private emitKind(node: GraphNode): Emitted {
    if (node.bypass && node.kind !== "output") return this.bypassed(node);
    const u = this.uniforms;
    switch (node.kind) {
      case "coord": {
        const space = node.select?.space ?? "object";
        const v =
          space === "world" ? positionWorld : space === "uv" ? vec3(uv(), 0) : positionLocal;
        return { value: vec3(v), type: "vec3" };
      }
      case "noise": {
        const def = noiseDef(node.select?.noise ?? "perlin");
        if (!def) return FALLBACK;
        const params: Record<string, Float> = {};
        for (const p of def.params) {
          params[p.key] = u.float(P.param(node.id, p.key), node.params?.[p.key] ?? p.default);
        }
        // phase is a live uniform (animation drives it; static graphs leave it 0);
        // seed decorrelates instances by shifting the sample coordinate.
        const phase = u.float(P.phase(node.id), 0);
        const seed = u.float(P.seed(node.id), node.params?.seed ?? 0);
        const off = vec3(seed.mul(13.37), seed.mul(7.77), seed.mul(3.33));
        const sampler = (c: Vec3) => def.sample(vec3(c).add(off), params, phase);

        // Sample coordinate: a wired `coord` wins; otherwise `select.space` — a
        // plain coordinate space, or a layer-system projection via
        // projectedSample (triplanar & friends multi-sample the noise, so they
        // only exist here, never on a wire).
        const conn = this.incoming(node.id, "coord");
        let value: Vec3;
        if (conn) {
          value = sampler(coerceVec3(this.emit(conn.from.node)));
        } else {
          const space = node.select?.space ?? "object";
          if (space === "object") value = sampler(positionLocal);
          else if (space === "world") value = sampler(positionWorld);
          else if (space === "uv") value = sampler(vec3(uv(), 0));
          else value = projectedSample(space as Projection, IDENTITY, sampler);
        }

        // value shaping — full layer-editor parity (contrast/bias/clip), every
        // knob a live uniform; defaults are a visual no-op.
        const [lo, hi, contrast, bias] = SHAPING_KEYS.map((k) =>
          u.float(P.shaping(node.id, k), node.params?.[k] ?? SHAPING_DEFAULT[k]),
        );
        return { value: shapeValue(value, lo!, hi!, contrast!, bias!), type: "vec3" };
      }
      case "float":
        return { value: u.float(P.value(node.id), node.params?.value ?? 0), type: "float" };
      case "color":
        return { value: u.color(P.color(node.id), node.colors?.value ?? "#808080"), type: "vec3" };
      case "math": {
        const a = this.input(node, "a", "float", () =>
          u.float(P.in(node.id, "a"), node.params?.a ?? 0),
        ) as Float;
        const b = this.input(node, "b", "float", () =>
          u.float(P.in(node.id, "b"), node.params?.b ?? 0),
        ) as Float;
        const op = (node.select?.op ?? "add") as MathOp;
        return { value: MATH[op](a, b), type: "float" };
      }
      case "mix": {
        const a = this.input(node, "a", "vec3", () =>
          u.color(P.inc(node.id, "a"), node.colors?.a ?? "#000000"),
        ) as Vec3;
        const b = this.input(node, "b", "vec3", () =>
          u.color(P.inc(node.id, "b"), node.colors?.b ?? "#ffffff"),
        ) as Vec3;
        const factor = u.float(P.factor(node.id), node.params?.factor ?? 0.5);
        const blend = (node.select?.blend ?? "normal") as BlendMode;
        return { value: blendLayer(blend, vec3(a), vec3(b), factor), type: "vec3" };
      }
      case "ramp": {
        // 256×1 lookup of the input value: `t` carries the value, v is arbitrary.
        // `.clamp` mirrors the layer stack — a value outside [0,1] would sample
        // the edge texel. The texture is owned by `ramps` (re-baked, not rebuilt).
        const t = this.input(node, "t", "float", () =>
          u.float(P.in(node.id, "t"), node.params?.t ?? 0),
        ) as Float;
        const rt = new RampTexture(node.ramp ?? defaultRamp());
        this.ramps.set(node.id, rt);
        return { value: texture(rt.texture, vec2(t.clamp(0, 1), 0.5)).rgb, type: "vec3" };
      }
      case "bump": {
        // height field → view-space normal (three's perturbNormalArb, shared with
        // the stack's normal channel). Binds straight to Output.normal — no
        // central height→normal step, the bump node owns the conversion.
        const height = this.input(node, "height", "float", () =>
          u.float(P.in(node.id, "height"), node.params?.height ?? 0),
        ) as Float;
        const strength = u.float(P.strength(node.id), node.params?.strength ?? 1);
        return { value: bumpNormal(height, strength), type: "vec3" };
      }
      // output is a sink — walked by the compiler, never emitted as a source.
      default:
        return FALLBACK;
    }
  }
}

/** Coerce an emitted value to a channel's bound vec3 (public for the compiler). */
export function toVec3(e: Emitted): Vec3 {
  return coerceVec3(e);
}

/**
 * Push a graph's live values into an existing {@link UniformTable}. Caller must
 * have checked `applies` (same structural key), so every path already exists;
 * `setFloat`/`setColor` no-op for connected inputs (whose fallback uniform was
 * never created). `phase` is intentionally left untouched — animation owns it.
 */
export function updateGraphUniforms(uniforms: UniformTable, graph: MaterialGraphDTO): void {
  for (const node of graph.nodes) {
    switch (node.kind) {
      case "noise": {
        const def = noiseDef(node.select?.noise ?? "perlin");
        if (def) {
          for (const p of def.params) {
            uniforms.setFloat(P.param(node.id, p.key), node.params?.[p.key] ?? p.default);
          }
        }
        uniforms.setFloat(P.seed(node.id), node.params?.seed ?? 0);
        for (const k of SHAPING_KEYS) {
          uniforms.setFloat(P.shaping(node.id, k), node.params?.[k] ?? SHAPING_DEFAULT[k]);
        }
        break;
      }
      case "float":
        uniforms.setFloat(P.value(node.id), node.params?.value ?? 0);
        break;
      case "color":
        uniforms.setColor(P.color(node.id), node.colors?.value ?? "#808080");
        break;
      case "math":
        uniforms.setFloat(P.in(node.id, "a"), node.params?.a ?? 0);
        uniforms.setFloat(P.in(node.id, "b"), node.params?.b ?? 0);
        break;
      case "mix":
        uniforms.setFloat(P.factor(node.id), node.params?.factor ?? 0.5);
        uniforms.setColor(P.inc(node.id, "a"), node.colors?.a ?? "#000000");
        uniforms.setColor(P.inc(node.id, "b"), node.colors?.b ?? "#ffffff");
        break;
      case "bump":
        uniforms.setFloat(P.strength(node.id), node.params?.strength ?? 1);
        break;
      // ramp stops re-bake into the DataTexture (owned by the compiler, not the
      // uniform table); coord/output carry no uniforms.
    }
  }
}
