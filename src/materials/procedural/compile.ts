import type {
  ProceduralChannel,
  ProceduralLayer,
  ProceduralMaterialDoc,
  ProceduralStack,
} from "@/types/core";
import { PROCEDURAL_CHANNELS, SOLID_SOURCE, structureKey } from "@/types/core";
import { texture, vec2, vec3 } from "@/materials/tsl";
import { noiseDef } from "@/materials/noises";
import { blendLayer } from "./blend";
import { projectionCoord } from "./projections";
import { RampTexture } from "./ramp";
import { UniformTable } from "./uniforms";

/**
 * The layer-stack compiler (E3): {@link ProceduralMaterialDoc} → one TSL node
 * per channel, plus the {@link UniformTable} and ramp textures that let every
 * non-structural edit apply **without recompiling**.
 *
 * The contract this chunk is specified around:
 * - `compile(doc)` is the ONLY thing that builds nodes, and it is countable —
 *   `CompiledStacks.compileCount` proves the no-recompile behavior in a test.
 * - `applies(doc)` returns true when `doc` is a param-only change away from the
 *   compiled graph (identical {@link structureKey}); `update(doc)` then pokes
 *   uniforms and re-bakes ramp textures in place.
 * - Anything that changes the graph's shape changes the structure key, and the
 *   caller must compile a fresh instance and swap.
 */

// biome-ignore lint/suspicious/noExplicitAny: TSL node
type Node = any;

const uPath = (layerId: string, field: string) => `${layerId}/${field}`;

/** A compiled doc: the per-channel nodes + everything needed to live-update them. */
export class CompiledStacks {
  /** Channel → composited TSL node (vec3; scalar channels are `.r` at assign). */
  readonly nodes: Partial<Record<ProceduralChannel, Node>> = {};
  readonly uniforms = new UniformTable();
  /** Structural fingerprint of the doc this was compiled from. */
  readonly key: string;
  private readonly ramps = new Map<string, RampTexture>();

  constructor(doc: ProceduralMaterialDoc) {
    this.key = structureKey(doc);
    for (const { channel, scalar } of PROCEDURAL_CHANNELS) {
      const stack = doc.channels[channel];
      if (!stack) continue;
      const node = this.compileStack(stack, channel);
      if (node) this.nodes[channel] = scalar ? vec3(node.r) : node;
    }
  }

  /** True if `doc` differs from the compiled graph only in uniform values. */
  applies(doc: ProceduralMaterialDoc): boolean {
    return structureKey(doc) === this.key;
  }

  /**
   * Push `doc`'s values into the live uniforms + ramp textures. Caller must have
   * checked {@link applies} — this cannot change the graph's shape.
   */
  update(doc: ProceduralMaterialDoc): void {
    for (const { channel } of PROCEDURAL_CHANNELS) {
      const stack = doc.channels[channel];
      if (!stack) continue;
      for (const layer of stack.layers) {
        if (!layer.enabled) continue;
        this.updateLayer(layer);
      }
    }
  }

  private updateLayer(layer: ProceduralLayer): void {
    const u = this.uniforms;
    u.setFloat(uPath(layer.id, "opacity"), layer.opacity);
    u.setColor(uPath(layer.id, "color"), layer.color);
    const t = layer.transform;
    u.setVec3(uPath(layer.id, "offset"), t.offset[0], t.offset[1], t.offset[2]);
    u.setVec3(uPath(layer.id, "rotation"), t.rotation[0], t.rotation[1], t.rotation[2]);
    u.setVec3(uPath(layer.id, "scale"), t.scale[0], t.scale[1], t.scale[2]);
    for (const [key, value] of Object.entries(layer.params)) {
      u.setFloat(uPath(layer.id, `param.${key}`), value);
    }
    // ramp stops re-bake into the SAME DataTexture — never a graph change
    if (layer.ramp) this.ramps.get(layer.id)?.update(layer.ramp);
  }

  private compileStack(stack: ProceduralStack, channel: ProceduralChannel): Node | null {
    let composite: Node | null = null;
    for (const layer of stack.layers) {
      if (!layer.enabled) continue;
      const color = this.compileLayer(layer, channel);
      const opacity = this.uniforms.float(uPath(layer.id, "opacity"), layer.opacity);
      composite =
        composite === null
          ? vec3(color).mul(opacity)
          : blendLayer(layer.blend, composite, color, opacity);
    }
    return composite;
  }

  /** One layer's vec3 output: source → (ramp | tint). */
  private compileLayer(layer: ProceduralLayer, channel: ProceduralChannel): Node {
    const tint = this.uniforms.color(uPath(layer.id, "color"), layer.color);
    if (layer.source === SOLID_SOURCE) return vec3(tint);

    const value = this.compileSource(layer, channel);
    if (!layer.ramp) {
      // no ramp: the noise modulates the layer's tint
      return vec3(tint).mul(value);
    }
    const ramp = new RampTexture(layer.ramp);
    this.ramps.set(layer.id, ramp);
    // 256×1 lookup — u carries the value, v is arbitrary. `.r` matters: sources
    // are vec3 (curl is a genuine vector field), and a vec3 here would build a
    // 4-component vec2 and blow up at graph build.
    return texture(ramp.texture, vec2(value.r.clamp(0, 1), 0.5)).rgb;
  }

  /** The layer's noise value (vec3), sampled through its projection. */
  private compileSource(layer: ProceduralLayer, _channel: ProceduralChannel): Node {
    const def = noiseDef(layer.source);
    // an unknown source id (a doc from a newer build) reads as mid-gray rather
    // than throwing — a material must always render
    if (!def) return vec3(0.5);

    const t = layer.transform;
    const pos = projectionCoord(layer.projection, {
      offset: this.uniforms.vec3(uPath(layer.id, "offset"), t.offset[0], t.offset[1], t.offset[2]),
      rotation: this.uniforms.vec3(
        uPath(layer.id, "rotation"),
        t.rotation[0],
        t.rotation[1],
        t.rotation[2],
      ),
      scale: this.uniforms.vec3(uPath(layer.id, "scale"), t.scale[0], t.scale[1], t.scale[2]),
    });

    // every declared param becomes a live uniform, so slider drags never recompile
    const params: Record<string, Node> = {};
    for (const p of def.params) {
      const value = layer.params[p.key] ?? p.default;
      params[p.key] = this.uniforms.float(uPath(layer.id, `param.${p.key}`), value);
    }
    // phase is a live uniform per layer: animation (chunk G) drives it, and a
    // static material simply leaves it at 0 — either way, never a recompile
    const phase = this.uniforms.float(uPath(layer.id, "phase"), 0);
    return def.sample(pos, params, phase);
  }

  dispose(): void {
    for (const r of this.ramps.values()) r.dispose();
    this.ramps.clear();
  }
}

/**
 * Compile `doc`. Every call builds a fresh node graph — the counter exists so
 * the E3 acceptance test ("param edits never recompile") can assert against a
 * real, observable number rather than a proxy.
 */
export function compile(doc: ProceduralMaterialDoc): CompiledStacks {
  compileCount++;
  return new CompiledStacks(doc);
}

let compileCount = 0;

/** Total {@link compile} calls this session. Instrumentation for the E3 test. */
export const getCompileCount = (): number => compileCount;
export const resetCompileCount = (): void => {
  compileCount = 0;
};
