import {
  Box3,
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Spherical,
  Vector3,
} from "three";
import type { BuiltinCamera } from "@/types/editor";

const ORTHO_DIRS: Record<Exclude<BuiltinCamera, "persp">, Vector3> = {
  ortho: new Vector3(1, 1, 1).normalize(), // 45° parallel (axonometric)
  top: new Vector3(0, 1, 0),
  bottom: new Vector3(0, -1, 0),
  left: new Vector3(-1, 0, 0),
  right: new Vector3(1, 0, 0),
  front: new Vector3(0, 0, 1),
  rear: new Vector3(0, 0, -1),
};

const MIN_PHI = 0.05; // keep away from the poles

// Sane zoom limits (shared by dolly / dollyToward / framing so hard limits
// hold everywhere). Persp is a camera→focus distance; ortho is world units per
// half-height — kept ~2× smaller so the two rigs feel similar at the extremes.
const MIN_FOCUS = 0.2;
const MAX_FOCUS = 2000;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 1000;
const clampFocus = (d: number) => MathUtils.clamp(d, MIN_FOCUS, MAX_FOCUS);
const clampZoom = (z: number) => MathUtils.clamp(z, MIN_ZOOM, MAX_ZOOM);

/**
 * One pane's camera + navigation state, C4D-style.
 *
 * The perspective rig is a FREE camera: orbiting rotates the camera rigidly
 * around an explicit per-drag pivot WITHOUT re-aiming at it — re-aiming is
 * what caused the "jump" when option-clicking an object (the view would
 * recenter on the clicked point). The clicked point stays put on screen.
 * Ortho rigs keep a center+zoom model and never orbit.
 */
export class CameraRig {
  readonly kind: BuiltinCamera;
  readonly camera: PerspectiveCamera | OrthographicCamera;
  /** Ortho view center; persp keeps a focus distance instead. */
  readonly pivot = new Vector3(0, 0, 0);
  private focusDistance = 10;
  private orthoZoom = 5; // world units per half-height
  private aspect = 1;

  constructor(kind: BuiltinCamera) {
    this.kind = kind;
    if (kind === "persp") {
      this.camera = new PerspectiveCamera(50, 1, 0.05, 5000);
      const offset = new Vector3().setFromSpherical(new Spherical(10, Math.PI / 3, Math.PI / 4));
      this.camera.position.copy(offset);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateMatrixWorld();
    } else {
      this.camera = new OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
      this.applyOrtho();
    }
  }

  get isPerspective(): boolean {
    return this.kind === "persp";
  }

  setAspect(aspect: number): void {
    this.aspect = aspect || 1;
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.aspect = this.aspect;
      this.camera.updateProjectionMatrix();
    } else {
      this.applyOrtho();
    }
  }

  /**
   * Resolve the orbit pivot for a drag: the picked point if any (also
   * refocuses), else the point straight ahead at the current focus distance
   * — the "center of the viewport" — so empty-space orbits stay predictable.
   */
  beginOrbitPivot(hit: Vector3 | null): Vector3 {
    if (hit) {
      this.focusDistance = clampFocus(this.camera.position.distanceTo(hit));
      return hit.clone();
    }
    const fwd = this.camera.getWorldDirection(new Vector3());
    return this.camera.position.clone().addScaledVector(fwd, this.focusDistance);
  }

  /** Rigid turntable rotation around `pivot`: world-Y yaw + horizontal-right pitch. */
  orbitAround(pivot: Vector3, dx: number, dy: number): void {
    if (!this.isPerspective) return; // ortho panes do not orbit (C4D behavior)
    const yaw = -dx * 0.006;
    let pitch = -dy * 0.006;

    // pitch axis = camera right FLATTENED to the horizon: pitching around a
    // horizontal axis can never introduce roll, so the camera cannot drift
    // into an inverted orientation over many drags
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    right.y = 0;
    if (right.lengthSq() < 1e-10) right.set(1, 0, 0); // degenerate (rolled at a pole)
    right.normalize();

    // clamp pitch so the view direction never crosses the poles. Rotating
    // around `right` by +pitch tilts the view UP, i.e. DECREASES phi
    // (the sign here was inverted before — the clamp let the camera flip
    // over the pole and then trapped it upside down).
    const fwd = this.camera.getWorldDirection(new Vector3());
    const phi = Math.acos(MathUtils.clamp(fwd.y, -1, 1)); // 0 = looking straight up
    const phiAfter = phi - pitch;
    if (phiAfter < MIN_PHI) pitch = phi - MIN_PHI;
    else if (phiAfter > Math.PI - MIN_PHI) pitch = phi - (Math.PI - MIN_PHI);

    const q = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 1, 0), yaw)
      .multiply(new Quaternion().setFromAxisAngle(right, pitch));
    const offset = this.camera.position.clone().sub(pivot).applyQuaternion(q);
    this.camera.position.copy(pivot).add(offset);
    this.camera.quaternion.premultiply(q);
    this.camera.updateMatrixWorld();
  }

  /** Pan in the view plane; scaled so the point in focus tracks the cursor. */
  pan(dx: number, dy: number, viewportHeightPx: number): void {
    this.camera.updateMatrixWorld();
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    if (this.camera instanceof PerspectiveCamera) {
      const perPixel =
        (2 * this.focusDistance * Math.tan(MathUtils.degToRad(this.camera.fov / 2))) /
        viewportHeightPx;
      this.camera.position
        .addScaledVector(right, -dx * perPixel)
        .addScaledVector(up, dy * perPixel);
      this.camera.updateMatrixWorld();
    } else {
      const perPixel = (2 * this.orthoZoom) / viewportHeightPx;
      this.pivot.addScaledVector(right, -dx * perPixel).addScaledVector(up, dy * perPixel);
      this.applyOrtho();
    }
  }

  /** Dolly (persp, along view direction) / zoom (ortho). delta > 0 = closer. */
  dolly(delta: number): void {
    const factor = Math.exp(-delta * 0.002);
    if (this.camera instanceof PerspectiveCamera) {
      // clamp FIRST, then move the camera by the distance actually consumed —
      // else the camera keeps sliding while focusDistance is pinned at a limit
      const next = clampFocus(this.focusDistance * factor);
      const fwd = this.camera.getWorldDirection(new Vector3());
      this.camera.position.addScaledVector(fwd, this.focusDistance - next);
      this.focusDistance = next;
      this.camera.updateMatrixWorld();
    } else {
      this.orthoZoom = clampZoom(this.orthoZoom * factor);
      this.applyOrtho();
    }
  }

  /**
   * Dolly toward an explicit world `point` — the crosshair pivot under the
   * cursor at drag start — so zooming homes in on the picked object instead of
   * the viewport center, matching orbit's pivot behavior. Perspective slides
   * the camera along the camera→point ray, which keeps `point` on the same
   * screen pixel (projection is scale-invariant along a view ray). Ortho scales
   * zoom and shifts the view center so `point` holds still. delta > 0 = closer.
   */
  dollyToward(point: Vector3, delta: number): void {
    const factor = Math.exp(-delta * 0.002);
    if (this.camera instanceof PerspectiveCamera) {
      const offset = this.camera.position.clone().sub(point);
      const dist = offset.length();
      if (dist < 1e-6) return; // camera sitting on the pivot — nothing to do
      const newDist = clampFocus(dist * factor);
      offset.multiplyScalar(newDist / dist);
      this.camera.position.copy(point).add(offset);
      this.focusDistance = clampFocus(this.focusDistance * factor);
      this.camera.updateMatrixWorld();
    } else {
      const newZoom = clampZoom(this.orthoZoom * factor);
      const k = newZoom / this.orthoZoom;
      // keep `point` fixed on screen: center' = point + (center - point) * k
      this.pivot.sub(point).multiplyScalar(k).add(point);
      this.orthoZoom = newZoom;
      this.applyOrtho();
    }
  }

  /** Frame a box: intentional recenter (lookAt is expected here, unlike orbit). */
  frame(box: Box3): void {
    if (box.isEmpty()) return;
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).length() || 1;
    if (this.camera instanceof PerspectiveCamera) {
      const fwd = this.camera.getWorldDirection(new Vector3());
      this.focusDistance = clampFocus(size * 1.2);
      this.camera.position.copy(center).addScaledVector(fwd, -this.focusDistance);
      this.camera.lookAt(center);
      this.camera.updateMatrixWorld();
    } else {
      this.pivot.copy(center);
      this.orthoZoom = clampZoom(size * 0.7);
      this.applyOrtho();
    }
  }

  /**
   * Where the view is centered on the ground and the world height it spans
   * there — recenters and sizes the infinite grid. Persp: the focus point and
   * its frustum height; ortho: the pivot and full view height.
   */
  groundView(): { center: Vector3; extent: number } {
    if (this.camera instanceof PerspectiveCamera) {
      const fwd = this.camera.getWorldDirection(new Vector3());
      const center = this.camera.position.clone().addScaledVector(fwd, this.focusDistance);
      const extent = 2 * this.focusDistance * Math.tan(MathUtils.degToRad(this.camera.fov / 2));
      return { center, extent };
    }
    return { center: this.pivot.clone(), extent: this.orthoZoom * 2 };
  }

  private applyOrtho(): void {
    const cam = this.camera as OrthographicCamera;
    const halfH = this.orthoZoom;
    const halfW = halfH * this.aspect;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    const dir = ORTHO_DIRS[this.kind as Exclude<BuiltinCamera, "persp">];
    cam.position.copy(this.pivot).addScaledVector(dir, 1000);
    if (this.kind === "top") cam.up.set(0, 0, -1);
    else if (this.kind === "bottom") cam.up.set(0, 0, 1);
    else cam.up.set(0, 1, 0);
    cam.lookAt(this.pivot);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
}
