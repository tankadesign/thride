import type { Texture } from "three";
import type { NodeMaterial } from "three/webgpu";
import type { MaterialDTO, ProceduralChannel, Projection, ProjectionTransform } from "@/types/core";
import {
  graphStructureKey,
  OUTPUT_CHANNELS,
  PROCEDURAL_CHANNELS,
  structureKey,
} from "@/types/core";
import {
  compile,
  pokeImageTransform,
  projectedImageNode,
  type ImageTransformUniforms,
} from "@/materials/procedural";
import { compileGraph } from "@/materials/graph";
import type { Float, Vec3 } from "@/materials/tsl";

/**
 * THE channel-slot binder — the one place a material's node slots
 * (`colorNode`, `roughnessNode`, …) get decided. Shared by the viewport's
 * {@link MaterialSync} and the material thumbnails — those run on SEPARATE
 * WebGPU devices and must each compile their own graphs, but they have to bind
 * them to the same slots the same way, or a thumbnail silently disagrees with
 * the viewport.
 *
 * Per channel the priority is: **noise stack > projected image > null** (the
 * UI enforces image XOR noise; the priority only matters for API-authored
 * docs). UV images never come through here — they ride the plain three map
 * properties.
 */

/** A built procedural/image node: vec3 for color channels, float for scalar ones. */
type ChannelNode = Vec3 | Float;

/** A non-uv image assignment for a channel: decoded texture + its projection + placement. */
export interface ImageSpec {
  tex: Texture;
  projection: Projection;
  /** Projection placement (offset/rotation/scale); undefined = identity. */
  transform?: ProjectionTransform;
}

/**
 * Per-material cache of built projected-image nodes. Node IDENTITY is the
 * point: `assignChannelNodes` compares slots by identity to decide
 * `needsUpdate`, so rebuilding an identical node on every material edit would
 * flip `needsUpdate` — a full shader recompile per slider drag. Placement edits
 * (offset/rotation/scale) poke the cached `uniforms` instead of rebuilding, so
 * dragging a projection stays at frame rate.
 */
export type ImageNodeCache = Map<
  ProceduralChannel,
  ImageSpec & { node: ChannelNode; uniforms: ImageTransformUniforms }
>;

/** Procedural channel → the node-material slot it drives. */
const CHANNEL_SLOT: Record<ProceduralChannel, string> = {
  color: "colorNode",
  roughness: "roughnessNode",
  metalness: "metalnessNode",
  emissive: "emissiveNode",
  // the compiler already converted the height stack to a view-space normal
  normal: "normalNode",
};

const SCALAR_CHANNEL = new Set(PROCEDURAL_CHANNELS.filter((c) => c.scalar).map((c) => c.channel));

/** True when `dto` has at least one channel with at least one layer. */
export function hasStacks(dto: MaterialDTO): boolean {
  const ch = dto.procedural?.channels;
  return !!ch && PROCEDURAL_CHANNELS.some(({ channel }) => ch[channel]?.layers.length);
}

/** True when `dto`'s node graph actually drives at least one Output channel. */
export function hasGraph(dto: MaterialDTO): boolean {
  const g = dto.graph;
  if (!g) return false;
  return OUTPUT_CHANNELS.some((ch) =>
    g.connections.some((c) => c.to.node === g.output && c.to.socket === ch),
  );
}

/** True when `dto` has a procedural front-end at all (graph or layer stack). */
export function hasLook(dto: MaterialDTO): boolean {
  return hasGraph(dto) || hasStacks(dto);
}

/**
 * A front-end-tagged structural fingerprint. The `g:`/`s:` prefix is what makes a
 * switch between the two authoring models (graph ⇄ stack) register as a
 * structural change even if the raw keys happened to collide — so the compiled
 * look is rebuilt, never wrongly reused. Empty when the material has no look.
 */
export function lookKey(dto: MaterialDTO | undefined): string {
  if (!dto) return "";
  if (hasGraph(dto)) return `g:${graphStructureKey(dto.graph)}`;
  if (hasStacks(dto)) return `s:${structureKey(dto.procedural)}`;
  return "";
}

/**
 * A compiled procedural look — the front-end-agnostic view the render/bake/
 * thumbnail layers consume. The node graph (E7) and the layer stack (E3) are
 * alternative authoring models over one compile target; this normalizes both to
 * the same `nodes` map + a `applies`/`update`/`dispose` recompile gate keyed on
 * the whole {@link MaterialDTO}, so callers never branch on which produced it.
 * The graph wins when present (it's the go-forward model).
 */
export interface CompiledLook {
  /** Channel → composited TSL node (vec3; scalar channels are `.r`'d at bind). */
  readonly nodes: Partial<Record<ProceduralChannel, Vec3>>;
  /** Front-end-tagged structural fingerprint (see {@link lookKey}). */
  readonly key: string;
  /** True if `dto` is a uniform-only edit away (same front-end + structure). */
  applies(dto: MaterialDTO): boolean;
  /** Poke live uniforms / re-bake ramps from `dto`. Caller must have checked `applies`. */
  update(dto: MaterialDTO): void;
  dispose(): void;
}

/** Compile `dto`'s procedural look (graph first, else layer stack), or undefined. */
export function compileLook(dto: MaterialDTO): CompiledLook | undefined {
  const key = lookKey(dto);
  if (hasGraph(dto)) {
    const g = compileGraph(dto.graph!);
    return {
      nodes: g.nodes,
      key,
      applies: (d) => lookKey(d) === key,
      update: (d) => {
        if (d.graph) g.update(d.graph);
      },
      dispose: () => g.dispose(),
    };
  }
  if (hasStacks(dto)) {
    const s = compile(dto.procedural!);
    return {
      nodes: s.nodes,
      key,
      applies: (d) => lookKey(d) === key,
      update: (d) => {
        if (d.procedural) s.update(d.procedural);
      },
      dispose: () => s.dispose(),
    };
  }
  return undefined;
}

/** The cached-or-fresh projected-image node for a channel (identity-stable). */
function imageNode(
  channel: ProceduralChannel,
  spec: ImageSpec | undefined,
  cache: ImageNodeCache,
): ChannelNode | null {
  if (!spec) {
    cache.delete(channel);
    return null;
  }
  const hit = cache.get(channel);
  // Same texture + projection → keep the node, just poke the placement uniforms
  // live (no rebuild, no recompile). Only tex/projection changes are structural.
  if (hit && hit.tex === spec.tex && hit.projection === spec.projection) {
    pokeImageTransform(hit.uniforms, spec.transform);
    return hit.node;
  }
  const built = projectedImageNode(channel, spec.tex, spec.projection, spec.transform);
  if (!built) {
    cache.delete(channel);
    return null;
  }
  cache.set(channel, { ...spec, node: built.node, uniforms: built.uniforms });
  return built.node;
}

/**
 * Bind every channel slot: noise stack node, else projected image, else null
 * (handing the slot back to the scalar params / map properties). Scalar noise
 * channels take `.r` of the composited vec3.
 *
 * `keepColor` skips the color slot — the planar-reflection variant owns
 * `colorNode` (it mixes the mirror over the base) and must not have it
 * clobbered on a param update.
 */
export function assignChannelNodes(
  mat: NodeMaterial,
  compiled: Pick<CompiledLook, "nodes"> | undefined,
  images: Partial<Record<ProceduralChannel, ImageSpec>>,
  cache: ImageNodeCache,
  keepColor = false,
  disabled?: ReadonlySet<ProceduralChannel>,
): void {
  const m = mat as unknown as Record<string, unknown>;
  let changed = false;
  for (const { channel } of PROCEDURAL_CHANNELS) {
    if (keepColor && channel === "color") continue;
    const slot = CHANNEL_SLOT[channel];
    if (!(slot in mat)) continue;
    // muted channel → bind nothing (the plain map prop is already cleared upstream)
    const stack = disabled?.has(channel) ? undefined : compiled?.nodes[channel];
    const next = disabled?.has(channel)
      ? null
      : stack
        ? SCALAR_CHANNEL.has(channel)
          ? stack.r
          : stack
        : imageNode(channel, images[channel], cache);
    if (m[slot] === next) continue;
    m[slot] = next;
    changed = true;
  }
  // adding/removing a node changes the compiled shader
  if (changed) mat.needsUpdate = true;
}
