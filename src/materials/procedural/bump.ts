import {
  cross,
  faceDirection,
  normalView,
  positionView,
  vec2,
  type Float,
  type Vec3,
} from "@/materials/tsl";

/**
 * Height field → perturbed view-space normal, for the `normal` procedural
 * channel (a noise is a height field, not a normal map).
 *
 * This is three's `perturbNormalArb` (BumpMapNode.js) re-stated over an
 * arbitrary height NODE. three's own `bumpMap` can't be used here: it derives
 * dHdxy by re-sampling a *texture* at UV offsets, and our noises sample
 * `positionLocal` through a projection — there is no texture to re-sample.
 * Screen-space derivatives of the evaluated height give the same gradient for
 * any expression, at the cost of the mild grazing-angle grit inherent to
 * derivative bump (accepted at design time).
 *
 * Output is view-space, matching what `material.normalNode` expects (the same
 * space three's bumpMap/normalMap nodes emit). `faceDirection` keeps backfaces
 * correct — materials here are DoubleSide.
 */

export function bumpNormal(height: Float, strength: Float): Vec3 {
  const dHdxy = vec2(height.dFdx(), height.dFdy()).mul(strength);

  const vSigmaX = positionView.dFdx();
  const vSigmaY = positionView.dFdy();
  const vN = normalView.mul(faceDirection);

  const R1 = cross(vSigmaY, vN);
  const R2 = cross(vN, vSigmaX);
  const fDet = vSigmaX.dot(R1);

  const vGrad = fDet.sign().mul(dHdxy.x.mul(R1).add(dHdxy.y.mul(R2)));
  return fDet.abs().mul(vN).sub(vGrad).normalize();
}
