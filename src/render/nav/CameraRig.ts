import { Box3, MathUtils, OrthographicCamera, PerspectiveCamera, Spherical, Vector3 } from "three";
import type { BuiltinCamera } from "@/ui/state/EditorState";

const ORTHO_DIRS: Record<Exclude<BuiltinCamera, "persp">, Vector3> = {
  top: new Vector3(0, 1, 0),
  front: new Vector3(0, 0, 1),
  right: new Vector3(1, 0, 0),
};

/**
 * One pane's camera + navigation state, C4D-style: orbit around an explicit
 * pivot (set from the picked point under the cursor), pan, dolly, frame.
 * Ortho rigs skip orbit and dolly-as-zoom instead.
 */
export class CameraRig {
  readonly kind: BuiltinCamera;
  readonly camera: PerspectiveCamera | OrthographicCamera;
  readonly pivot = new Vector3(0, 0, 0);
  private readonly spherical = new Spherical(10, Math.PI / 3, Math.PI / 4);
  private orthoZoom = 5; // world units per half-height
  private aspect = 1;

  constructor(kind: BuiltinCamera) {
    this.kind = kind;
    if (kind === "persp") {
      this.camera = new PerspectiveCamera(50, 1, 0.05, 5000);
    } else {
      this.camera = new OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
    }
    this.apply();
  }

  get isPerspective(): boolean {
    return this.kind === "persp";
  }

  setAspect(aspect: number): void {
    this.aspect = aspect || 1;
    this.apply();
  }

  /** Re-pivot without moving the camera (orbit center = clicked point). */
  setPivotKeepingView(point: Vector3): void {
    if (!this.isPerspective) {
      this.pivot.copy(point);
      return;
    }
    const camPos = this.camera.position.clone();
    this.pivot.copy(point);
    const offset = camPos.sub(this.pivot);
    this.spherical.setFromVector3(offset);
    this.clampPhi();
    this.apply();
  }

  orbit(dx: number, dy: number): void {
    if (!this.isPerspective) return; // ortho panes do not orbit (C4D behavior)
    this.spherical.theta -= dx * 0.006;
    this.spherical.phi -= dy * 0.006;
    this.clampPhi();
    this.apply();
  }

  /** Pan in view plane; scaled so the point under the cursor tracks it. */
  pan(dx: number, dy: number, viewportHeightPx: number): void {
    const perPixel = this.isPerspective
      ? (2 * this.spherical.radius * Math.tan(MathUtils.degToRad(25))) / viewportHeightPx
      : (2 * this.orthoZoom) / viewportHeightPx;
    const right = new Vector3();
    const up = new Vector3();
    this.camera.updateMatrixWorld();
    right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    up.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.pivot.addScaledVector(right, -dx * perPixel).addScaledVector(up, dy * perPixel);
    this.apply();
  }

  /** Dolly (persp) / zoom (ortho). delta > 0 moves closer. */
  dolly(delta: number): void {
    const factor = Math.exp(-delta * 0.002);
    if (this.isPerspective) {
      this.spherical.radius = MathUtils.clamp(this.spherical.radius * factor, 0.05, 4000);
    } else {
      this.orthoZoom = MathUtils.clamp(this.orthoZoom * factor, 0.01, 4000);
    }
    this.apply();
  }

  frame(box: Box3): void {
    if (box.isEmpty()) return;
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).length() || 1;
    this.pivot.copy(center);
    if (this.isPerspective) {
      this.spherical.radius = size * 1.2;
    } else {
      this.orthoZoom = size * 0.7;
    }
    this.apply();
  }

  private clampPhi(): void {
    this.spherical.phi = MathUtils.clamp(this.spherical.phi, 0.01, Math.PI - 0.01);
    this.spherical.makeSafe();
  }

  private apply(): void {
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.aspect = this.aspect;
      const offset = new Vector3().setFromSpherical(this.spherical);
      this.camera.position.copy(this.pivot).add(offset);
      this.camera.lookAt(this.pivot);
    } else {
      const halfH = this.orthoZoom;
      const halfW = halfH * this.aspect;
      this.camera.left = -halfW;
      this.camera.right = halfW;
      this.camera.top = halfH;
      this.camera.bottom = -halfH;
      const dir = ORTHO_DIRS[this.kind as Exclude<BuiltinCamera, "persp">];
      this.camera.position.copy(this.pivot).addScaledVector(dir, 1000);
      if (this.kind === "top") this.camera.up.set(0, 0, -1);
      else this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.pivot);
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
}
