import type { Texture } from "three";
import type { NodeMaterial } from "three/webgpu";
import type { MaterialDTO, ProceduralChannel, Projection, ProjectionTransform } from "@/types/core";
import { PROCEDURAL_CHANNELS } from "@/types/core";
import {
  compile,
  pokeImageTransform,
  projectedImageNode,
  type CompiledStacks,
  type ImageTransformUniforms,
} from "@/materials/procedural";
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

/** Compile `dto`'s stacks, or undefined when it has none. */
export function compileStacks(dto: MaterialDTO): CompiledStacks | undefined {
  return hasStacks(dto) ? compile(dto.procedural!) : undefined;
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
  compiled: CompiledStacks | undefined,
  images: Partial<Record<ProceduralChannel, ImageSpec>>,
  cache: ImageNodeCache,
  keepColor = false,
): void {
  const m = mat as unknown as Record<string, unknown>;
  let changed = false;
  for (const { channel } of PROCEDURAL_CHANNELS) {
    if (keepColor && channel === "color") continue;
    const slot = CHANNEL_SLOT[channel];
    if (!(slot in mat)) continue;
    const stack = compiled?.nodes[channel];
    const next = stack
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
