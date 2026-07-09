import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Object3D } from "three";
import { themeColor } from "@/render/scene-sync/themeColor";

/**
 * Wireframe pyramid marking a camera node in the viewport: apex at the
 * camera's own origin, base on its focus plane, local -Z (three's camera
 * forward) pointing where the camera looks — so it follows node rotation
 * for free as a child of the camera's Object3D.
 */
const HELPER_COLOR = themeColor("--color-secondary", "#c084fc");
const HELPER_MAT = new LineBasicMaterial({ color: HELPER_COLOR });

const FOCUS_DIST = 0.8;
const HALF_W = 0.5;
const HALF_H = 0.35;

export function buildCameraHelper(): Object3D {
  const apex: [number, number, number] = [0, 0, 0];
  const tl: [number, number, number] = [-HALF_W, HALF_H, -FOCUS_DIST];
  const tr: [number, number, number] = [HALF_W, HALF_H, -FOCUS_DIST];
  const br: [number, number, number] = [HALF_W, -HALF_H, -FOCUS_DIST];
  const bl: [number, number, number] = [-HALF_W, -HALF_H, -FOCUS_DIST];
  // 4 edges apex→base corner, 4 edges around the base rectangle
  const segments = [apex, tl, apex, tr, apex, br, apex, bl, tl, tr, tr, br, br, bl, bl, tl];
  const positions = new Float32Array(segments.flat());
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  const helper = new LineSegments(geo, HELPER_MAT);
  helper.raycast = () => {}; // never pickable
  // three's WebGPU backend mis-culls Line-type objects against a lazily
  // computed bounding sphere; this is cheap enough to never bother culling.
  helper.frustumCulled = false;
  helper.userData.helper = true;
  return helper;
}
