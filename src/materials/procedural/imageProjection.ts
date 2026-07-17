import { Vector3, type Texture } from "three";
import type { ProceduralChannel, Projection, ProjectionTransform } from "@/types/core";
import {
  materialColor,
  materialEmissive,
  materialMetalness,
  materialRoughness,
  texture,
  uniform,
  type Float,
  type Vec3,
} from "@/materials/tsl";
import { projectedSample, type TransformNodes } from "./projections";
import type { Vec3Uniform } from "./uniforms";

/**
 * Image maps sampled through a projection (the per-channel Projection control
 * on image slots). `uv` never comes through here — that's the plain
 * `map`/`roughnessMap` property fast path; this builds a TSL node for the
 * channel's slot instead, reusing {@link projectedSample} (triplanar = three
 * samples blended by the normal, exactly as for noises).
 *
 * Each node composes with the material's own scalar the same way three's
 * property pipeline does — including three's map channel conventions
 * (roughness reads `.g`, metalness reads `.b`) — so switching a channel
 * between UV and a projection changes the mapping, never the brightness.
 *
 * `normal` returns null by design: tangent-space normal maps encode vectors in
 * a UV-derived frame, and projecting them without that frame produces wrong
 * (not just distorted) shading. Normal images stay UV; procedural normal
 * (height + bump) projects fine.
 *
 * Placement (offset/rotation/scale) is UNIFORM-backed: the node is built once
 * and editing the placement pokes these uniforms' `.value` (see
 * `proceduralBind.pokeImageTransform`) — no node rebuild, no shader recompile.
 */

/** The projection placement uniforms — poked live on edit. */
export interface ImageTransformUniforms {
  offset: Vec3Uniform;
  rotation: Vec3Uniform;
  scale: Vec3Uniform;
}

/** A built projected-image node plus the placement uniforms that drive it live. */
export interface ProjectedImage {
  node: Vec3 | Float;
  uniforms: ImageTransformUniforms;
}

const v3 = (t: readonly [number, number, number] | undefined, fallback: number): Vector3 =>
  t ? new Vector3(t[0], t[1], t[2]) : new Vector3(fallback, fallback, fallback);

export function projectedImageNode(
  channel: ProceduralChannel,
  tex: Texture,
  projection: Projection,
  transform?: ProjectionTransform,
): ProjectedImage | null {
  if (channel === "normal") return null;
  const uniforms: ImageTransformUniforms = {
    offset: uniform(v3(transform?.offset, 0)),
    rotation: uniform(v3(transform?.rotation, 0)),
    scale: uniform(v3(transform?.scale, 1)),
  };
  // Vec3Uniform is a Node<"vec3">, so it satisfies TransformNodes directly.
  const tNodes: TransformNodes = uniforms;
  // `.rgb`: the texture sample is vec4, but projectedSample works in vec3 (and
  // every channel below reads only r/g/b — alpha was never used). Dropping it
  // here keeps the projection math in vec3 and matches projectedSample's type.
  const sample = projectedSample(projection, tNodes, (coord) => texture(tex, coord.xy).rgb);
  const node: Vec3 | Float | null =
    channel === "color"
      ? materialColor.mul(sample.rgb)
      : channel === "roughness"
        ? materialRoughness.mul(sample.g)
        : channel === "metalness"
          ? materialMetalness.mul(sample.b)
          : channel === "emissive"
            ? materialEmissive.mul(sample.rgb)
            : null;
  return node ? { node, uniforms } : null;
}

/** Poke the placement uniforms in place (identity when `t` is undefined). */
export function pokeImageTransform(u: ImageTransformUniforms, t: ProjectionTransform | undefined) {
  u.offset.value.set(t?.offset[0] ?? 0, t?.offset[1] ?? 0, t?.offset[2] ?? 0);
  u.rotation.value.set(t?.rotation[0] ?? 0, t?.rotation[1] ?? 0, t?.rotation[2] ?? 0);
  u.scale.value.set(t?.scale[0] ?? 1, t?.scale[1] ?? 1, t?.scale[2] ?? 1);
}
