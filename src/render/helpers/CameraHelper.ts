import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  type Object3D,
} from "three";
import { type CameraDataDTO, defaultCameraData, fovFromFocalLength } from "@/types/core/camera";
import { viewportTheme } from "@/render/theme/viewportTheme";

/**
 * Wireframe pyramid marking a camera node in the viewport: apex at the
 * camera's own origin, base on a fixed focus plane, local -Z (three's camera
 * forward) pointing where the camera looks — so it follows node rotation for
 * free as a child of the camera's Object3D.
 *
 * The base rectangle is shaped by the camera's focal length (converted to a
 * vertical fov at a representative 16:9 aspect) at a fixed focus distance (NOT
 * the far plane — a default far of 1000 would draw a helper the size of the
 * scene), so editing the lens visibly reshapes the pyramid. A short "up" tick
 * above the top edge marks which way is up, matching Blender's camera gizmo.
 */
const HELPER_MAT = new LineBasicMaterial({ color: viewportTheme.secondary });

/** Re-apply the themed helper color to the shared camera-helper material. */
export function applyCameraHelperTheme(): void {
  HELPER_MAT.color.copy(viewportTheme.secondary);
}

/** Where the pyramid base sits, in local -Z; a display distance, not the clip far. */
const FOCUS_DIST = 1;
/** Representative sensor aspect for the helper frustum (the pane it renders in
 *  fills its own aspect; this just gives the pyramid a camera-like shape). */
const HELPER_ASPECT = 16 / 9;

/** Flat [x,y,z…] segment endpoints for a frustum of the given vertical fov. */
function frustumSegments(fov: number): Float32Array {
  const halfH = FOCUS_DIST * Math.tan(MathUtils.degToRad(fov) / 2);
  const halfW = halfH * HELPER_ASPECT;
  const z = -FOCUS_DIST;
  const apex: [number, number, number] = [0, 0, 0];
  const tl: [number, number, number] = [-halfW, halfH, z];
  const tr: [number, number, number] = [halfW, halfH, z];
  const br: [number, number, number] = [halfW, -halfH, z];
  const bl: [number, number, number] = [-halfW, -halfH, z];
  // up-tick above the top edge (screen-up marker)
  const um: [number, number, number] = [0, halfH, z];
  const ut: [number, number, number] = [0, halfH + halfH * 0.5, z];
  const segments = [
    apex,
    tl,
    apex,
    tr,
    apex,
    br,
    apex,
    bl, // apex → base corners
    tl,
    tr,
    tr,
    br,
    br,
    bl,
    bl,
    tl, // base rectangle
    um,
    ut, // up tick
  ];
  return new Float32Array(segments.flat());
}

/** The helper's representative vertical fov from the lens focal length. */
const helperFov = (dto: CameraDataDTO): number =>
  fovFromFocalLength(dto.focalLength, HELPER_ASPECT);

export function buildCameraHelper(dto: CameraDataDTO = defaultCameraData()): Object3D {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(frustumSegments(helperFov(dto)), 3));
  const helper = new LineSegments(geo, HELPER_MAT);
  helper.raycast = () => {}; // never pickable
  // three's WebGPU backend mis-culls Line-type objects against a lazily
  // computed bounding sphere; this is cheap enough to never bother culling.
  helper.frustumCulled = false;
  helper.userData.helper = true;
  helper.userData.cameraHelper = true; // so updateNode can find + reshape it
  return helper;
}

/** Reshape an existing camera helper in place after a lens edit (vertex count is fixed). */
export function updateCameraHelper(helper: Object3D, dto: CameraDataDTO): void {
  if (!(helper instanceof LineSegments)) return;
  const attr = helper.geometry.getAttribute("position") as BufferAttribute;
  (attr.array as Float32Array).set(frustumSegments(helperFov(dto)));
  attr.needsUpdate = true;
}
