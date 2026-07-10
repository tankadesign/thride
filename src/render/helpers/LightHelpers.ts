import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
} from "three";
import type { LightDataDTO, LightType } from "@/types/core/light";
import { viewportTheme } from "@/render/theme/viewportTheme";

/**
 * Per-type light helpers: spot gets a cone, area a rect with corner ticks,
 * directional (infinite) a single line pointing where it shines — all
 * children of the light's own Object3D so they follow its rotation.
 * Point/ambient/hemisphere aren't directional; they get a screen-facing
 * "billboard" circle, tracked/positioned externally by SceneSynchronizer
 * since a billboard can't just inherit the light's rotation.
 */
const HELPER_COLOR = viewportTheme.secondary;
const HELPER_MAT = new LineBasicMaterial({ color: HELPER_COLOR });

/** Re-apply the themed helper color to the shared light-helper material. */
export function applyLightHelperTheme(): void {
  HELPER_MAT.color.copy(viewportTheme.secondary);
}

function noPick(obj: Object3D): void {
  obj.raycast = () => {};
  // three's WebGPU backend mis-culls Line-type objects against a lazily
  // computed bounding sphere; these are cheap enough to never bother culling.
  obj.frustumCulled = false;
}

/** Circle outline as explicit segment pairs — three's WebGPU backend doesn't draw LineLoop. */
function circleSegmentPoints(segments: number, radius: number, z: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < segments; i++) {
    const t0 = (i / segments) * Math.PI * 2;
    const t1 = ((i + 1) / segments) * Math.PI * 2;
    pts.push(
      Math.cos(t0) * radius,
      Math.sin(t0) * radius,
      z,
      Math.cos(t1) * radius,
      Math.sin(t1) * radius,
      z,
    );
  }
  return pts;
}

// ---- spotlight cone --------------------------------------------------

const CONE_CIRCLE_SEGMENTS = 32;
const CONE_SPOKES = 8;
const CONE_MIN_HEIGHT = 0.3;
const CONE_MAX_HEIGHT = 2.5;

/** Power → cone height (sqrt curve so bright lights don't dwarf the scene). */
function coneHeight(intensity: number): number {
  return MathUtils.clamp(
    0.15 * Math.sqrt(Math.max(0, intensity)),
    CONE_MIN_HEIGHT,
    CONE_MAX_HEIGHT,
  );
}

function buildSpotHelper(data: LightDataDTO): Object3D {
  const height = coneHeight(data.intensity);
  const angle = data.angle ?? Math.PI / 5;
  const radius = height * Math.tan(angle);
  const group = new Object3D();

  const circlePts = circleSegmentPoints(CONE_CIRCLE_SEGMENTS, radius, -height);
  const circleGeo = new BufferGeometry();
  circleGeo.setAttribute("position", new BufferAttribute(new Float32Array(circlePts), 3));
  const circle = new LineSegments(circleGeo, HELPER_MAT);
  noPick(circle);
  group.add(circle);

  const spokePts: number[] = [];
  for (let i = 0; i < CONE_SPOKES; i++) {
    const t = (i / CONE_SPOKES) * Math.PI * 2;
    spokePts.push(0, 0, 0, Math.cos(t) * radius, Math.sin(t) * radius, -height);
  }
  const spokeGeo = new BufferGeometry();
  spokeGeo.setAttribute("position", new BufferAttribute(new Float32Array(spokePts), 3));
  const spokes = new LineSegments(spokeGeo, HELPER_MAT);
  noPick(spokes);
  group.add(spokes);

  noPick(group);
  return group;
}

// ---- area light: rect + 4 corner direction ticks ----------------------

const AREA_TICK_LENGTH = 0.2;

function buildAreaHelper(data: LightDataDTO): Object3D {
  const w = (data.width ?? 2) / 2;
  const h = (data.height ?? 2) / 2;
  const corners: [number, number][] = [
    [-w, h],
    [w, h],
    [w, -h],
    [-w, -h],
  ];
  const pts: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = corners[i]!;
    const [nx, ny] = corners[(i + 1) % 4]!;
    pts.push(x, y, 0, nx, ny, 0); // rectangle edge
  }
  for (const [x, y] of corners) {
    pts.push(x, y, 0, x, y, -AREA_TICK_LENGTH); // direction tick
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
  const lines = new LineSegments(geo, HELPER_MAT);
  noPick(lines);
  return lines;
}

// ---- directional (infinite) light: single direction line --------------

const DIRECTIONAL_LINE_LENGTH = 1.5;

function buildDirectionalHelper(): Object3D {
  const pts = [0, 0, 0, 0, 0, -DIRECTIONAL_LINE_LENGTH];
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
  const line = new LineSegments(geo, HELPER_MAT);
  noPick(line);
  return line;
}

// ---- point/ambient/hemisphere: billboarded circle ----------------------

const CIRCLE_SEGMENTS = 32;
const CIRCLE_PX_RADIUS = 32; // 64px diameter

const BILLBOARD_TYPES: ReadonlySet<LightType> = new Set(["point", "ambient", "hemisphere"]);

export function isBillboardLightType(type: LightType): boolean {
  return BILLBOARD_TYPES.has(type);
}

export function buildBillboardCircle(): Object3D {
  const pts = circleSegmentPoints(CIRCLE_SEGMENTS, 1, 0);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
  const circle = new LineSegments(geo, HELPER_MAT);
  noPick(circle);
  return circle;
}

/** Orient to face the camera and hold a constant 64px screen diameter. `obj.position` must already be the light's world position. */
export function updateBillboardHelper(
  obj: Object3D,
  camera: Camera,
  viewportHeightPx: number,
): void {
  obj.quaternion.copy(camera.quaternion);
  let worldPerPixel: number;
  if (camera instanceof PerspectiveCamera) {
    const dist = camera.position.distanceTo(obj.position);
    worldPerPixel = (2 * dist * Math.tan(MathUtils.degToRad(camera.fov / 2))) / viewportHeightPx;
  } else {
    const ortho = camera as OrthographicCamera;
    worldPerPixel = (ortho.top - ortho.bottom) / viewportHeightPx;
  }
  obj.scale.setScalar(CIRCLE_PX_RADIUS * worldPerPixel);
}

/** Cone (spot) / rect (area) / line (directional) helper to attach as a child of the light object; null for billboard types. */
export function buildOrientedLightHelper(data: LightDataDTO): Object3D | null {
  if (data.type === "spot") return buildSpotHelper(data);
  if (data.type === "area") return buildAreaHelper(data);
  if (data.type === "directional") return buildDirectionalHelper();
  return null;
}
