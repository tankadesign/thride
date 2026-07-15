import type { Texture } from "three";
import type { ProceduralChannel, Projection } from "@/types/core";
import {
  materialColor,
  materialEmissive,
  materialMetalness,
  materialRoughness,
  texture,
  vec3,
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

// biome-ignore lint/suspicious/noExplicitAny: TSL node
type Node = any;

/** Identity transform — image slots have no placement controls (yet). */
const IDENTITY: TransformNodes = {
  offset: vec3(0, 0, 0),
  rotation: vec3(0, 0, 0),
  scale: vec3(1, 1, 1),
};

export function projectedImageNode(
  channel: ProceduralChannel,
  tex: Texture,
  projection: Projection,
): Node | null {
  if (channel === "normal") return null;
  const sample = projectedSample(projection, IDENTITY, (coord) => texture(tex, coord.xy));
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
