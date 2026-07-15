import type { Uuid } from "./ids";
import type { EulerXYZ, Vec3 } from "./math";

/**
 * Procedural layer stacks (chunk E3) — the serializable half of the material
 * layer system. Pure data: the compiler in `materials/procedural/` turns a
 * {@link ProceduralMaterialDoc} into TSL nodes, one per channel.
 *
 * The shape here is deliberately designed **once**, ahead of the code that
 * fills it in: `projection` is on the layer from the start even though E3 only
 * implements `uv`/`flat` (E4 adds the rest), and `ramp` is declared even though
 * only scalar sources use it. Adding either later would be a migration through
 * the compiler, the DTO, serialization and thumbnails.
 */

/**
 * How a layer's output combines with everything beneath it. `normal` is a plain
 * lerp by opacity; the rest are the usual compositing operators, each still
 * scaled by opacity so a layer can always be dialed out.
 */
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "add"
  | "subtract"
  | "difference"
  | "min"
  | "max";

export const BLEND_MODES: { mode: BlendMode; label: string }[] = [
  { mode: "normal", label: "Normal" },
  { mode: "multiply", label: "Multiply" },
  { mode: "screen", label: "Screen" },
  { mode: "overlay", label: "Overlay" },
  { mode: "add", label: "Add" },
  { mode: "subtract", label: "Subtract" },
  { mode: "difference", label: "Difference" },
  { mode: "min", label: "Min" },
  { mode: "max", label: "Max" },
];

/**
 * How a layer derives its sample coordinate from the surface.
 * - `uv` — the mesh's UV set (needs unwrapped UVs).
 * - `flat` — object-space XY (a planar projection down -Z).
 * - `triplanar` — cubic/triplanar: three axis-aligned planar samples blended by
 *   the normal. The seamless default for un-unwrapped geometry.
 * - `cylindrical` / `spherical` — angular wraps around the object's axis.
 * - `camera` — screen-space projection from the viewing camera.
 *
 * **E3 implements `uv` and `flat`; E4 fills in the rest.** The type is complete
 * now so E4 is additive in `materials/procedural/projections.ts` only.
 */
export type Projection = "uv" | "flat" | "triplanar" | "cylindrical" | "spherical" | "camera";

export const PROJECTIONS: { projection: Projection; label: string }[] = [
  { projection: "uv", label: "UV" },
  { projection: "flat", label: "Flat" },
  { projection: "triplanar", label: "Triplanar" },
  { projection: "cylindrical", label: "Cylindrical" },
  { projection: "spherical", label: "Spherical" },
  { projection: "camera", label: "Camera" },
];

/** Placement of a layer's projection in object space (the E4 gizmo edits this). */
export interface ProjectionTransform {
  offset: Vec3;
  /** Euler XYZ, radians (as elsewhere in the DTOs — the UI converts at the widget). */
  rotation: EulerXYZ;
  scale: Vec3;
}

export const defaultProjectionTransform = (): ProjectionTransform => ({
  offset: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

/** One color stop on a {@link GradientRamp}. `t` is 0–1 along the ramp. */
export interface GradientStop {
  t: number;
  /** Hex. */
  color: string;
}

/**
 * Maps a layer's scalar output through a color gradient. Compiled to a 256×1
 * RGBA DataTexture sampled by the noise value — so **editing stops re-writes
 * the texture's pixels in place and never recompiles** the node graph.
 */
export interface GradientRamp {
  stops: GradientStop[];
}

export const defaultRamp = (): GradientRamp => ({
  stops: [
    { t: 0, color: "#000000" },
    { t: 1, color: "#ffffff" },
  ],
});

/**
 * A layer's pattern source: either a flat color (`solid`) or a noise from the
 * E2 registry, referenced by `NoiseDef.id`. Kept as a plain string rather than a
 * union of noise ids so the registry stays the single source of truth.
 */
export const SOLID_SOURCE = "solid";

/**
 * One layer in a channel's stack. Layers composite bottom-up: index 0 is the
 * base, each subsequent layer blends over the result so far.
 */
export interface ProceduralLayer {
  id: Uuid;
  name: string;
  enabled: boolean;
  /** {@link SOLID_SOURCE} or a `NoiseDef.id` from the E2 registry. */
  source: string;
  /** Noise params keyed by `NoiseParam.key`. Ignored for `solid`. */
  params: Record<string, number>;
  /** `solid`'s color, and the tint a ramp-less noise layer modulates. Hex. */
  color: string;
  /** Optional scalar→color gradient. Absent = the raw noise value as grayscale. */
  ramp?: GradientRamp;
  projection: Projection;
  transform: ProjectionTransform;
  blend: BlendMode;
  /** 0–1 layer strength. */
  opacity: number;
}

/**
 * Material channels a stack can drive. `color`/`emissive` are RGB; `roughness`/
 * `metalness` are scalar (the compiler takes the red channel). These mirror the
 * node-material slots the compiler assigns (`colorNode`, `roughnessNode`, …).
 */
export type ProceduralChannel = "color" | "roughness" | "metalness" | "emissive";

export const PROCEDURAL_CHANNELS: {
  channel: ProceduralChannel;
  label: string;
  /** Scalar channels take `.r` of the composited stack. */
  scalar: boolean;
}[] = [
  { channel: "color", label: "Color", scalar: false },
  { channel: "roughness", label: "Roughness", scalar: true },
  { channel: "metalness", label: "Metalness", scalar: true },
  { channel: "emissive", label: "Emissive", scalar: false },
];

/** A channel's layer stack. Empty/absent = the channel falls back to the DTO scalar. */
export interface ProceduralStack {
  layers: ProceduralLayer[];
}

/**
 * The procedural half of a material — per-channel layer stacks. Attached to a
 * {@link MaterialDTO} as `procedural`; absent means a plain scalar material
 * (the overwhelmingly common case, so it stays optional).
 */
export interface ProceduralMaterialDoc {
  channels: Partial<Record<ProceduralChannel, ProceduralStack>>;
}

/** A new layer with sensible defaults, sourcing `source` (noise id or solid). */
export function defaultLayer(id: Uuid, source: string = SOLID_SOURCE): ProceduralLayer {
  return {
    id,
    name: source === SOLID_SOURCE ? "Solid" : source,
    enabled: true,
    source,
    params: {},
    color: "#808080",
    projection: source === SOLID_SOURCE ? "uv" : "triplanar",
    transform: defaultProjectionTransform(),
    blend: "normal",
    opacity: 1,
  };
}

/**
 * The structural fingerprint of a doc — everything that affects the SHAPE of the
 * compiled node graph (layer identity, order, source, blend, projection, whether
 * a ramp exists), and nothing that is merely a uniform value.
 *
 * This is the recompile boundary E3 is specified around: equal keys ⇒ the graph
 * is reusable and a change is applied by poking uniforms; different keys ⇒
 * recompile + swap. Note what is deliberately absent — `params`, `color`,
 * `opacity`, `transform` and ramp stop values are all uniforms or texture data,
 * so editing them must NOT change this key.
 */
export function structureKey(doc: ProceduralMaterialDoc | undefined): string {
  if (!doc) return "";
  const parts: string[] = [];
  for (const { channel } of PROCEDURAL_CHANNELS) {
    const stack = doc.channels[channel];
    if (!stack || stack.layers.length === 0) continue;
    const layers = stack.layers
      .filter((l) => l.enabled)
      .map((l) => `${l.id}:${l.source}:${l.blend}:${l.projection}:${l.ramp ? "r" : "-"}`)
      .join(",");
    if (layers) parts.push(`${channel}[${layers}]`);
  }
  return parts.join("|");
}
