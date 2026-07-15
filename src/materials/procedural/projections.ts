import type { Projection } from "@/types/core";
import {
  abs,
  acos,
  atan,
  length,
  normalLocal,
  positionLocal,
  pow,
  screenUV,
  uv,
  vec3,
} from "@/materials/tsl";

/**
 * Projections (chunk E4) — how a layer derives the coordinate it feeds its
 * noise. Every projection is applied through {@link projectedSample}, which
 * takes the noise as a callback rather than returning a single coordinate.
 *
 * That indirection is what triplanar needs: it is not one coordinate but three
 * axis-aligned samples blended by the surface normal, so it has to invoke the
 * noise three times. Returning a bare coord would make triplanar impossible to
 * express (and triplanar is the seamless default for un-unwrapped geometry).
 *
 * The transform is applied BEFORE projecting — the inverse of placing a
 * projector in the scene. All three components are live uniforms, so moving a
 * projection never recompiles; only changing the projection TYPE is structural.
 *
 * A note on "matches reference renders": the repo has no reference-render
 * harness, so each projection is checked visually on a sphere + cube (see
 * PLAN_PROGRESS). `projections.test.ts` covers the invariants that are actually
 * assertable without a GPU.
 */

// biome-ignore lint/suspicious/noExplicitAny: TSL node
type Node = any;

/** The transform's uniform nodes, handed to {@link projectedSample} per layer. */
export interface TransformNodes {
  offset: Node;
  /** Euler XYZ radians. */
  rotation: Node;
  scale: Node;
}

const TAU = Math.PI * 2;

/**
 * Triplanar blend exponent. Higher = tighter transitions between the three
 * planar samples (less cross-fade smear on flat faces), at the cost of a
 * visible seam on 45° surfaces. 4 is the usual compromise.
 */
const TRIPLANAR_SHARPNESS = 4;

/** Rotate `p` by Euler XYZ `rot` (radians), matching three's XYZ order. */
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

/** Surface position moved into the projector's frame (offset + rotation, no scale). */
function oriented(t: TransformNodes): Node {
  return rotateEuler(positionLocal.sub(t.offset), t.rotation);
}

/**
 * Scale a 2D (u,v) result. The angular projections must scale the ANGLE, not the
 * position — dividing the position first would barely change an angle, so their
 * `scale` control would read as almost inert.
 */
function scaled2d(u: Node, v: Node, t: TransformNodes): Node {
  return vec3(u.div(t.scale.x), v.div(t.scale.y), 0);
}

/** Normal in the projector's frame — the triplanar blend axis. */
function orientedNormal(t: TransformNodes): Node {
  return rotateEuler(normalLocal, t.rotation);
}

/**
 * Sample `noise` through `projection`. Returns the noise's own output type
 * (vec3 for every noise in the registry).
 */
export function projectedSample(
  projection: Projection,
  t: TransformNodes,
  noise: (coord: Node) => Node,
): Node {
  switch (projection) {
    case "uv": {
      // the mesh's own UV set — needs unwrapped UVs. z stays 0, so a 3D noise
      // samples one constant slice (phase still moves it).
      const p = uv();
      return noise(scaled2d(p.x.sub(t.offset.x), p.y.sub(t.offset.y), t));
    }

    case "flat": {
      // planar projection down the projector's -Z: XY carries the pattern and Z
      // is DROPPED, so the pattern is constant along the projection axis. That
      // means faces parallel to it get the classic stretched streaks — the
      // expected behavior of a flat projection everywhere, and precisely the
      // artifact `triplanar` exists to fix. (Keeping z here instead would make
      // this a solid/object projection, and would make triplanar pointless.)
      const p = oriented(t).div(t.scale);
      return noise(vec3(p.x, p.y, 0));
    }

    case "triplanar": {
      // three FLAT samples — one per axis, each dropping its own axis — blended
      // by the normal, so every face is mapped face-on and no face streaks. The
      // seamless choice for un-unwrapped geometry, at 3x the noise cost.
      const p = oriented(t).div(t.scale);
      const n = orientedNormal(t);
      // |n|^k normalized to sum 1: each plane contributes where it faces
      const w0 = pow(abs(n), vec3(TRIPLANAR_SHARPNESS, TRIPLANAR_SHARPNESS, TRIPLANAR_SHARPNESS));
      const w = w0.div(w0.x.add(w0.y).add(w0.z).max(1e-4));
      const sx = noise(vec3(p.y, p.z, 0)); // plane facing ±X
      const sy = noise(vec3(p.z, p.x, 0)); // plane facing ±Y
      const sz = noise(vec3(p.x, p.y, 0)); // plane facing ±Z
      return sx.mul(w.x).add(sy.mul(w.y)).add(sz.mul(w.z));
    }

    case "cylindrical": {
      // angle around the projector's Y axis + height. Wraps seamlessly around
      // the circumference only when the noise's own period aligns; a hard seam
      // at atan's ±pi branch cut is inherent to the projection (as in every DCC).
      const p = oriented(t);
      const u = atan(p.x, p.z).div(TAU).add(0.5); // [0,1)
      return noise(scaled2d(u, p.y, t));
    }

    case "spherical": {
      // longitude/latitude. Poles converge (the classic pinch) — inherent, not
      // a bug: every texel of a v=0 row maps to one point.
      const p = oriented(t);
      const u = atan(p.x, p.z).div(TAU).add(0.5);
      // acos of the normalized height; guard the zero-length center
      const v = acos(p.y.div(length(p).max(1e-6)).clamp(-1, 1)).div(Math.PI);
      return noise(scaled2d(u, v, t));
    }

    case "camera": {
      // screen-space projection from the viewing camera — the pattern is pinned
      // to the frame, so it slides across the surface as the camera orbits
      const p = screenUV;
      return noise(scaled2d(p.x.sub(t.offset.x), p.y.sub(t.offset.y), t));
    }
  }
}
