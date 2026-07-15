import type { Projection, ProjectionTransform } from "@/types/core";
import { positionLocal, uv, vec3 } from "@/materials/tsl";

/**
 * Projections (chunks E3/E4) — how a layer derives the 3D coordinate it feeds
 * its noise. Every projection returns a **vec3 sample coordinate** in the
 * layer's projection space, so the noise functions stay projection-agnostic.
 *
 * E3 implements `uv` and `flat`; E4 adds triplanar/cylindrical/spherical/camera.
 * The {@link Projection} union and {@link ProjectionTransform} are already final
 * (see `types/core/procedural.ts`), so E4 only fills in cases here.
 *
 * The transform is applied to the surface position BEFORE projecting: scale then
 * rotate then offset, i.e. the inverse of placing a projector in the scene. All
 * three components are live uniforms — moving a projection must never recompile.
 */

// biome-ignore lint/suspicious/noExplicitAny: TSL node
type Node = any;

/** The transform's uniform nodes, handed to {@link projectionCoord} per layer. */
export interface TransformNodes {
  offset: Node;
  /** Euler XYZ radians. */
  rotation: Node;
  scale: Node;
}

/** Rotate `p` by Euler XYZ `rot` (radians), as three's XYZ order. */
function rotateEuler(p: Node, rot: Node): Node {
  const cx = rot.x.cos();
  const sx = rot.x.sin();
  const cy = rot.y.cos();
  const sy = rot.y.sin();
  const cz = rot.z.cos();
  const sz = rot.z.sin();

  // X
  const y1 = p.y.mul(cx).sub(p.z.mul(sx));
  const z1 = p.y.mul(sx).add(p.z.mul(cx));
  // Y
  const x2 = p.x.mul(cy).add(z1.mul(sy));
  const z2 = z1.mul(cy).sub(p.x.mul(sy));
  // Z
  const x3 = x2.mul(cz).sub(y1.mul(sz));
  const y3 = x2.mul(sz).add(y1.mul(cz));

  return vec3(x3, y3, z2);
}

/** Surface position placed into the layer's projection space. */
function placed(t: TransformNodes): Node {
  return rotateEuler(positionLocal.sub(t.offset), t.rotation).div(t.scale);
}

/**
 * The vec3 sample coordinate for `projection`. `t` carries the live transform
 * uniforms.
 *
 * Unimplemented projections (E4) fall back to `flat` rather than throwing — a
 * material authored against a not-yet-built projection still renders.
 */
export function projectionCoord(projection: Projection, t: TransformNodes): Node {
  switch (projection) {
    case "uv": {
      // the mesh's own UV set, scaled/offset in the UV plane; z carries no
      // information, so noises sample a constant slice unless phase moves it
      const p = uv()
        .sub(vec3(t.offset.x, t.offset.y, 0).xy)
        .div(vec3(t.scale.x, t.scale.y, 1).xy);
      return vec3(p.x, p.y, 0);
    }
    case "flat":
      // object-space planar projection (down -Z): XY carries the pattern, Z is
      // kept so 3D noises still vary through the solid
      return placed(t);
    default:
      // E4 fills these in; until then they read as `flat`
      return placed(t);
  }
}
