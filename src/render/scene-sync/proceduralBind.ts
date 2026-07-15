import type { NodeMaterial } from "three/webgpu";
import type { MaterialDTO, ProceduralChannel } from "@/types/core";
import { PROCEDURAL_CHANNELS } from "@/types/core";
import { compile, type CompiledStacks } from "@/materials/procedural";

/**
 * Binding compiled procedural stacks (E3) onto a three node material. Shared by
 * the viewport's {@link MaterialSync} and the material thumbnails — those run on
 * SEPARATE WebGPU devices and must each compile their own graph (a node
 * material's pipeline is per-device), but they have to bind it to the same slots
 * the same way, or a thumbnail silently disagrees with the viewport.
 */

/** Procedural channel → the node-material slot it drives. */
const CHANNEL_SLOT: Record<ProceduralChannel, string> = {
  color: "colorNode",
  roughness: "roughnessNode",
  metalness: "metalnessNode",
  emissive: "emissiveNode",
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

/**
 * Bind a compiled stack's nodes to the material's slots — or clear them when
 * `compiled` is undefined, handing the slots back to the scalar params. Scalar
 * channels take `.r` of the composited vec3.
 */
export function assignStackNodes(mat: NodeMaterial, compiled: CompiledStacks | undefined): void {
  const m = mat as unknown as Record<string, unknown>;
  let changed = false;
  for (const { channel } of PROCEDURAL_CHANNELS) {
    const slot = CHANNEL_SLOT[channel];
    if (!(slot in mat)) continue;
    const node = compiled?.nodes[channel];
    const next = node ? (SCALAR_CHANNEL.has(channel) ? node.r : node) : null;
    if (m[slot] === next) continue;
    m[slot] = next;
    changed = true;
  }
  // adding/removing a node changes the compiled shader
  if (changed) mat.needsUpdate = true;
}
