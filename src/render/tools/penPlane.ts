import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Quaternion,
  type Vector3,
} from "three";
import { viewportTheme } from "@/render/theme/viewportTheme";

/** Work-plane preview: half-extent (world units) and grid divisions. */
const PLANE_HALF = 5;
const PLANE_DIVS = 10;

/**
 * The pen tool's red work-plane preview: a translucent fill + red grid that
 * follows the cursor while picking an orientation, then dims once locked.
 */
export class PenPlanePreview {
  readonly group = new Group();
  private readonly fill: Mesh;
  private readonly grid: LineSegments;

  constructor() {
    const red = viewportTheme.error;
    this.fill = new Mesh(
      new PlaneGeometry(PLANE_HALF * 2, PLANE_HALF * 2),
      new MeshBasicMaterial({
        color: red,
        transparent: true,
        opacity: 0.07,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    this.fill.raycast = () => {};
    this.grid = new LineSegments(
      buildGridGeometry(),
      new LineBasicMaterial({ color: red, transparent: true, opacity: 0.35 }),
    );
    this.grid.raycast = () => {};
    this.grid.frustumCulled = false;
    this.group.add(this.fill, this.grid);
  }

  /** Bright while picking the plane orientation. */
  setPicking(): void {
    (this.fill.material as MeshBasicMaterial).opacity = 0.07;
    (this.grid.material as LineBasicMaterial).opacity = 0.35;
  }

  /** Dimmed once the plane is locked and drawing starts. */
  setLocked(): void {
    (this.fill.material as MeshBasicMaterial).opacity = 0.04;
    (this.grid.material as LineBasicMaterial).opacity = 0.18;
  }

  place(position: Vector3, quaternion: Quaternion): void {
    this.group.position.copy(position);
    this.group.quaternion.copy(quaternion);
    this.group.visible = true;
  }
}

/** Red preview grid: PLANE_DIVS × PLANE_DIVS cells in the local XY plane. */
function buildGridGeometry(): BufferGeometry {
  const pts: number[] = [];
  const step = (PLANE_HALF * 2) / PLANE_DIVS;
  for (let i = 0; i <= PLANE_DIVS; i++) {
    const c = -PLANE_HALF + i * step;
    pts.push(c, -PLANE_HALF, 0, c, PLANE_HALF, 0);
    pts.push(-PLANE_HALF, c, 0, PLANE_HALF, c, 0);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
  return geo;
}
