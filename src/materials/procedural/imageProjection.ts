import type { Texture } from "three";
import type { ProceduralChannel, Projection, ProjectionTransform } from "@/types/core";
import {
  materialColor,
  materialEmissive,
  materialMetalness,
  materialRoughness,
  texture,
  vec3,
  type Float,
  type Vec3,
} from "@/materials/tsl";
import { projectedSample, type TransformNodes } from "./projections";

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
 */

/** Identity placement — used when a channel has no projection transform. */
const IDENTITY: TransformNodes = {
  offset: vec3(0, 0, 0),
  rotation: vec3(0, 0, 0),
  scale: vec3(1, 1, 1),
};

/**
 * Build const placement nodes from a serialized transform. These are constants,
 * not uniforms, so editing the transform rebuilds the node (live uniform-backed
 * editing is M5) — the caller's cache invalidates on transform change.
 */
function transformNodes(t: ProjectionTransform | undefined): TransformNodes {
  if (!t) return IDENTITY;
  return {
    offset: vec3(t.offset[0], t.offset[1], t.offset[2]),
    rotation: vec3(t.rotation[0], t.rotation[1], t.rotation[2]),
    scale: vec3(t.scale[0], t.scale[1], t.scale[2]),
  };
}

export function projectedImageNode(
  channel: ProceduralChannel,
  tex: Texture,
  projection: Projection,
  transform?: ProjectionTransform,
): Vec3 | Float | null {
  if (channel === "normal") return null;
  // `.rgb`: the texture sample is vec4, but projectedSample works in vec3 (and
  // every channel below reads only r/g/b — alpha was never used). Dropping it
  // here keeps the projection math in vec3 and matches projectedSample's type.
  const sample = projectedSample(
    projection,
    transformNodes(transform),
    (coord) => texture(tex, coord.xy).rgb,
  );
  switch (channel) {
    case "color":
      return materialColor.mul(sample.rgb);
    case "roughness":
      return materialRoughness.mul(sample.g);
    case "metalness":
      return materialMetalness.mul(sample.b);
    case "emissive":
      return materialEmissive.mul(sample.rgb);
    default:
      return null;
  }
}
