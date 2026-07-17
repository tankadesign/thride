import {
  BoxGeometry,
  type BufferGeometry,
  Camera,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  type Intersection,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import type { TransformDTO, Uuid } from "@/types/core";
import type { GizmoSpace } from "@/types/editor";
import type { Document } from "@/core";
import { TransformDragSession } from "@/core/session/TransformDragSession";
import { viewportTheme } from "@/render/theme/viewportTheme";
import { ComponentDrag, componentContext } from "./componentDrag";

export interface GizmoModifiers {
  /** Uniform scale on scale handles. */
  uniformScale?: boolean;
  /** Snap deltas to snapSize steps — LOCAL, relative to drag start. */
  snap?: boolean;
  snapSize?: number;
  /**
   * Magnet: given the moved pivot's would-be world position, return a snapped
   * position (nearest scene vertex/edge) or null. Applied on translate.
   */
  snapWorld?: (world: Vector3) => Vector3 | null;
}

const ROTATE_SNAP = Math.PI / 36; // 5°
const SCALE_SNAP = 0.1;
const snapTo = (v: number, step: number) => Math.round(v / step) * step;

/** Hit areas are ≥2.5× the visual handle footprint. */
const PICK_SCALE = 2.5;
/** Thin parts (shafts, rings) also get an absolute minimum pick radius —
 * 2.5× a hairline is still a hairline (~0.06 gizmo units ≈ 4 screen px). */
const PICK_MIN_RADIUS = 0.06;
/** Raycastable but never rendered (material-invisible keeps raycasting intact). */
const PICKER_MAT = new MeshBasicMaterial({ visible: false, depthTest: false, depthWrite: false });

type HandleKind =
  | "translate"
  | "rotate"
  | "scale"
  | "translate-view"
  | "translate-plane"
  | "scale-plane"
  | "scale-view"
  | "rotate-free";
type Axis = 0 | 1 | 2;

/** Which handle kinds each gizmo mode shows (V=all, E=move, R=rotate, T=scale). */
export type GizmoMode = "all" | "translate" | "rotate" | "scale";
const MODE_KINDS: Record<Exclude<GizmoMode, "all">, ReadonlySet<HandleKind>> = {
  translate: new Set(["translate", "translate-view", "translate-plane"]),
  rotate: new Set(["rotate", "rotate-free"]),
  scale: new Set(["scale", "scale-plane", "scale-view"]),
};

interface Handle {
  kind: HandleKind;
  axis: Axis;
}

/**
 * Pick precedence when handles overlap in screen space (higher wins,
 * independent of camera distance). In an orthographic top/side view the
 * edge-on rotation rings project onto the move axes and would otherwise
 * steal their clicks; scale cubes and move arrows (both outside the rings)
 * and the near-center plane quads must win so translate/scale stay usable
 * head-on. rotate-free (the fill of the rotate sphere) sits BELOW the rings
 * so touching a ring always wins over the trackball. Ties at equal priority
 * fall back to nearest-first (raycaster hit order).
 */
const HANDLE_PRIORITY: Record<HandleKind, number> = {
  scale: 3,
  "scale-plane": 3,
  "scale-view": 3,
  translate: 2,
  "translate-view": 2,
  "translate-plane": 2,
  rotate: 1,
  "rotate-free": 0,
};

/** Rotate-ring radius in gizmo units — the whole radial layout keys off it. */
const RING_R = 1.0;

// X/Y/Z axis colors from the viewport theme (error/success/info).
const AXIS_COLORS = [viewportTheme.gizmo.x, viewportTheme.gizmo.y, viewportTheme.gizmo.z] as const;
const AXIS_VECS = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)] as const;

interface DragState {
  handle: Handle;
  nodeIds: Uuid[];
  begin: Map<Uuid, TransformDTO>;
  pivot: Vector3;
  axisWorld: Vector3;
  /** Gizmo orientation at drag start (local vs world axes). */
  basis: Quaternion;
  plane: Plane;
  startPoint: Vector3;
  startAngle: number;
  /** Gizmo world radius at drag start — trackball drag-to-angle scale. */
  freeRadius: number;
  /** Camera frame at drag start (scale-view): maps a drag onto screen right/up. */
  viewRight?: Vector3;
  viewUp?: Vector3;
  /** Set in component edit modes: the drag drives vertices, not transforms. */
  component?: ComponentDrag;
}

/**
 * Unified TRS gizmo (C4D-style single gizmo): translate arrows, rotate
 * rings, scale cubes, view-plane center handle. Lives in the main scene
 * with depthTest off; drags run through the document's SessionRunner so
 * every drag is exactly one undo step.
 */
export class TransformGizmo {
  readonly group = new Group();
  private readonly doc: Document;
  private drag: DragState | null = null;
  private hovered: Mesh | null = null;
  private activeObject: Object3D | null = null;
  private readonly hoverColor = viewportTheme.primary;
  private mode: GizmoMode = "all";

  constructor(doc: Document) {
    this.doc = doc;
    this.group.name = "gizmo";
    this.group.renderOrder = 999;
    this.build();
    this.group.visible = false;
  }

  get isDragging(): boolean {
    return this.drag !== null;
  }

  get currentMode(): GizmoMode {
    return this.mode;
  }

  /** Show only one handle family (E move / R rotate / T scale) or all (V). */
  setMode(mode: GizmoMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.group.traverse((o) => {
      const handle = (o as Mesh).userData.handle as Handle | undefined;
      // top-level handle meshes only — pickers are children and follow along
      if (handle && o.parent === this.group) o.visible = this.handleShown(o as Mesh);
    });
  }

  /**
   * Mode gate for one handle mesh: its kind must belong to the mode, and
   * single-mode extras (scale shafts/quads, the trackball fill) only exist in
   * their own mode — the multi gizmo already fills those spots.
   */
  private handleShown(mesh: Mesh): boolean {
    const handle = mesh.userData.handle as Handle;
    const only = mesh.userData.onlyMode as GizmoMode | undefined;
    if (only) return this.mode === only;
    return this.mode === "all" || MODE_KINDS[this.mode].has(handle.kind);
  }

  /** Reposition/orient on the active selection; hide when nothing is selected. */
  update(camera: Camera, activeObject: Object3D | null, space: GizmoSpace = "local"): void {
    this.activeObject = activeObject;
    const ids = this.doc.selection.objectIds;
    const active = this.doc.selection.active;
    if (!active || ids.length === 0 || !this.doc.scene.has(active)) {
      this.group.visible = false;
      return;
    }
    const mode = this.doc.selection.editMode;
    if (mode === "point" || mode === "edge" || mode === "polygon") {
      // component mode: gizmo sits on the component-selection centroid and
      // hides while nothing is selected (a bare object gizmo would edit the
      // node transform — confusing inside a component mode)
      const ctx = componentContext(this.doc, activeObject);
      if (!ctx) {
        this.group.visible = false;
        return;
      }
      this.group.position.copy(ctx.centroidWorld);
    } else {
      const t = this.doc.scene.mustGet(active).transform;
      this.group.position.set(t.position[0], t.position[1], t.position[2]);
    }
    // local mode: gizmo axes follow the object's world orientation
    if (space === "local" && activeObject) {
      activeObject.getWorldQuaternion(this.group.quaternion);
    } else {
      this.group.quaternion.identity();
    }
    this.group.visible = true;
    // screen-constant size: perspective scales by distance, ortho by frustum height
    const ortho = camera as OrthographicCamera;
    const scale = ortho.isOrthographicCamera
      ? Math.max(0.0001, (ortho.top - ortho.bottom) * 0.092)
      : Math.max(0.0001, camera.position.distanceTo(this.group.position) * 0.0805);
    this.group.scale.setScalar(scale);
  }

  /**
   * Resolve overlapping handle hits by precedence (scale > translate >
   * rotate), then nearest-first for ties. `hits` come back distance-sorted,
   * so the first hit at the top priority wins.
   */
  private pickHandle(hits: Intersection[]): Mesh | null {
    let best: Mesh | null = null;
    let bestPriority = -1;
    for (const h of hits) {
      const obj = h.object as Mesh;
      const handle = obj.userData.handle as Handle | undefined;
      if (!handle) continue;
      // three's raycaster ignores .visible — enforce the mode gate here via
      // the visual mesh's visibility (pickers are children of the visual)
      const visual = (obj.userData.visual as Mesh | undefined) ?? obj;
      if (!visual.visible) continue;
      const priority = HANDLE_PRIORITY[handle.kind];
      if (priority > bestPriority) {
        best = obj;
        bestPriority = priority;
      }
    }
    return best;
  }

  /** Try to begin a drag. Returns true when the pointer hit a handle. */
  pointerDown(raycaster: Raycaster): boolean {
    if (!this.group.visible) return false;
    const hitObj = this.pickHandle(raycaster.intersectObject(this.group, true));
    if (!hitObj) return false;
    return this.startDrag(hitObj.userData.handle as Handle, raycaster);
  }

  /**
   * Start a view-plane move WITHOUT a handle hit — move-only mode in a 2D
   * viewport lets a drag anywhere slide the selection in the pane's plane
   * (the caller has already given handles/gizmo picks their precedence).
   */
  beginViewDrag(raycaster: Raycaster): boolean {
    if (!this.group.visible) return false;
    return this.startDrag({ kind: "translate-view", axis: 0 }, raycaster);
  }

  private startDrag(handle: Handle, raycaster: Raycaster): boolean {
    const mode = this.doc.selection.editMode;
    const componentMode = mode === "point" || mode === "edge" || mode === "polygon";
    const ids = componentMode ? [] : [...this.doc.selection.objectIds];
    const begin = new Map<Uuid, TransformDTO>();
    for (const id of ids) begin.set(id, structuredClone(this.doc.scene.mustGet(id).transform));

    const pivot = this.group.position.clone();
    const basis = this.group.quaternion.clone();
    const axisWorld = AXIS_VECS[handle.axis].clone().applyQuaternion(basis);
    const viewDir = raycaster.ray.direction.clone();

    let plane: Plane;
    if (
      handle.kind === "rotate" ||
      handle.kind === "translate-plane" ||
      handle.kind === "scale-plane"
    ) {
      // plane translate/scale works IN the plane whose normal is the handle's axis
      plane = new Plane().setFromNormalAndCoplanarPoint(axisWorld, pivot);
    } else if (
      handle.kind === "translate-view" ||
      handle.kind === "rotate-free" ||
      handle.kind === "scale-view"
    ) {
      // view plane through the pivot: free move / trackball / uniform scale
      plane = new Plane().setFromNormalAndCoplanarPoint(viewDir.clone().negate(), pivot);
    } else {
      // plane containing the axis, facing the camera as much as possible
      const n = viewDir
        .clone()
        .sub(axisWorld.clone().multiplyScalar(viewDir.dot(axisWorld)))
        .normalize();
      plane = new Plane().setFromNormalAndCoplanarPoint(n, pivot);
    }
    const startPoint = new Vector3();
    if (!raycaster.ray.intersectPlane(plane, startPoint)) return false;

    const rel = startPoint.clone().sub(pivot);
    const startAngle = this.angleOnPlane(rel, handle.axis, basis);

    // scale-view maps the drag onto SCREEN right/up (up/right grows, down/left
    // shrinks), so it needs the camera frame at drag start. setFromCamera
    // stashes the camera on the raycaster; a bare synthetic ray falls back to
    // a world-up-derived frame.
    let viewRight: Vector3 | undefined;
    let viewUp: Vector3 | undefined;
    if (handle.kind === "scale-view") {
      const cam = (raycaster as Raycaster & { camera?: Camera }).camera;
      if (cam) {
        const m = cam.matrixWorld.elements;
        viewRight = new Vector3(m[0], m[1], m[2]).normalize();
        viewUp = new Vector3(m[4], m[5], m[6]).normalize();
      } else {
        viewRight = new Vector3().crossVectors(viewDir, new Vector3(0, 1, 0));
        if (viewRight.lengthSq() < 1e-6) viewRight.set(1, 0, 0);
        viewRight.normalize();
        viewUp = new Vector3().crossVectors(viewRight, viewDir).normalize();
      }
    }

    let component: ComponentDrag | undefined;
    if (componentMode) {
      const ctx = componentContext(this.doc, this.activeObject);
      if (!ctx || !this.activeObject) return false;
      // starts the ComponentTransformSession itself (one undo step per drag)
      component = new ComponentDrag(this.doc, ctx, this.activeObject, handle.kind);
    } else {
      this.doc.sessions.start(new TransformDragSession(ids, labelFor(handle.kind)));
    }
    this.drag = {
      handle,
      nodeIds: ids,
      begin,
      pivot,
      axisWorld,
      basis,
      plane,
      startPoint,
      startAngle,
      freeRadius: Math.max(1e-6, this.group.scale.x * RING_R),
      viewRight,
      viewUp,
      component,
    };
    return true;
  }

  pointerMove(raycaster: Raycaster, mods: GizmoModifiers = {}): void {
    const d = this.drag;
    if (!d) return;
    const point = new Vector3();
    if (!raycaster.ray.intersectPlane(d.plane, point)) return;
    const snapSize = mods.snapSize ?? 0.1;

    const updates = new Map<Uuid, TransformDTO>();
    if (
      d.handle.kind === "translate" ||
      d.handle.kind === "translate-view" ||
      d.handle.kind === "translate-plane"
    ) {
      // plane/view handles take the raw in-plane delta; axis handles project it
      const delta = point.clone().sub(d.startPoint);
      if (d.handle.kind === "translate") {
        let along = delta.dot(d.axisWorld);
        if (mods.snap) along = snapTo(along, snapSize);
        delta.copy(d.axisWorld).multiplyScalar(along);
      } else if (mods.snap) {
        delta.set(snapTo(delta.x, snapSize), snapTo(delta.y, snapSize), snapTo(delta.z, snapSize));
      }
      // magnet: snap the moved pivot to nearby scene geometry (constrained
      // handles keep their constraint — axis handles take the along-axis
      // component, plane handles the in-plane one)
      if (mods.snapWorld) {
        const snapped = mods.snapWorld(d.pivot.clone().add(delta));
        if (snapped) {
          const sd = snapped.sub(d.pivot);
          if (d.handle.kind === "translate")
            delta.copy(d.axisWorld).multiplyScalar(sd.dot(d.axisWorld));
          else if (d.handle.kind === "translate-plane")
            delta.copy(sd).addScaledVector(d.axisWorld, -sd.dot(d.axisWorld));
          else delta.copy(sd);
        }
      }
      if (d.component) {
        d.component.applyTranslate(delta);
        return;
      }
      for (const [id, t0] of d.begin) {
        const t = structuredClone(t0);
        t.position[0] = t0.position[0] + delta.x;
        t.position[1] = t0.position[1] + delta.y;
        t.position[2] = t0.position[2] + delta.z;
        updates.set(id, t);
      }
    } else if (d.handle.kind === "rotate" || d.handle.kind === "rotate-free") {
      let axis = d.axisWorld;
      let angle: number;
      if (d.handle.kind === "rotate-free") {
        // C4D trackball: drag in the view plane spins about the in-plane axis
        // PERPENDICULAR to the drag (normal × delta) — the grabbed point
        // follows the cursor. One ring-radius of drag = 1 radian.
        const delta = point.clone().sub(d.startPoint);
        if (delta.lengthSq() < 1e-12) return;
        axis = new Vector3().crossVectors(d.plane.normal, delta).normalize();
        angle = delta.length() / d.freeRadius;
      } else {
        angle =
          this.angleOnPlane(point.clone().sub(d.pivot), d.handle.axis, d.basis) - d.startAngle;
      }
      if (mods.snap) angle = snapTo(angle, ROTATE_SNAP);
      if (d.component) {
        d.component.applyRotate(axis, angle, d.pivot);
        return;
      }
      const dq = new Quaternion().setFromAxisAngle(axis, angle);
      for (const [id, t0] of d.begin) {
        const t = structuredClone(t0);
        const q0 = new Quaternion().setFromEuler(
          new Euler(t0.rotation[0], t0.rotation[1], t0.rotation[2], "XYZ"),
        );
        const e = new Euler().setFromQuaternion(dq.clone().multiply(q0), "XYZ");
        t.rotation = [e.x, e.y, e.z];
        updates.set(id, t);
      }
    } else if (d.handle.kind === "scale-view") {
      // uniform scale from the center sphere: up or right grows, down or left
      // shrinks — one ring-radius of drag = ±1× (crossing zero mirrors).
      const delta = point.clone().sub(d.startPoint);
      const along = delta.dot(d.viewRight!) + delta.dot(d.viewUp!);
      let ratio = 1 + along / d.freeRadius;
      if (mods.snap) ratio = snapTo(ratio, SCALE_SNAP);
      // an exact 0 collapses the matrix — hold just off zero until the drag
      // crosses to the mirrored side
      if (Math.abs(ratio) < 0.01) ratio = ratio < 0 ? -0.01 : 0.01;
      if (d.component) {
        d.component.applyScale(d.basis, 0, ratio, true, d.pivot);
        return;
      }
      for (const [id, t0] of d.begin) {
        const t = structuredClone(t0);
        t.scale = [t0.scale[0] * ratio, t0.scale[1] * ratio, t0.scale[2] * ratio];
        updates.set(id, t);
      }
    } else if (d.handle.kind === "scale-plane") {
      // two-axis scale: ratio of pivot distances within the plane, applied to
      // both in-plane axes (Shift still = uniform on all three)
      const r0 = d.startPoint.clone().sub(d.pivot).length();
      const r1 = point.clone().sub(d.pivot).length();
      let ratio = r0 > 1e-6 ? r1 / r0 : 1;
      if (mods.snap) ratio = Math.max(SCALE_SNAP, snapTo(ratio, SCALE_SNAP));
      if (d.component) {
        // component drags have no per-axis-pair path — uniform reads best
        d.component.applyScale(d.basis, d.handle.axis, ratio, true, d.pivot);
        return;
      }
      const u = ((d.handle.axis + 1) % 3) as Axis;
      const v = ((d.handle.axis + 2) % 3) as Axis;
      for (const [id, t0] of d.begin) {
        const t = structuredClone(t0);
        if (mods.uniformScale) {
          t.scale = [t0.scale[0] * ratio, t0.scale[1] * ratio, t0.scale[2] * ratio];
        } else {
          t.scale[u] = t0.scale[u]! * ratio;
          t.scale[v] = t0.scale[v]! * ratio;
        }
        updates.set(id, t);
      }
    } else {
      // scale along axis: ratio of distances from pivot along axis.
      // Shift = uniform scale on all three axes.
      const a0 = d.startPoint.clone().sub(d.pivot).dot(d.axisWorld);
      const a1 = point.clone().sub(d.pivot).dot(d.axisWorld);
      let ratio = Math.abs(a0) > 1e-6 ? a1 / a0 : 1;
      if (mods.snap) ratio = Math.max(SCALE_SNAP, snapTo(ratio, SCALE_SNAP));
      if (d.component) {
        d.component.applyScale(d.basis, d.handle.axis, ratio, !!mods.uniformScale, d.pivot);
        return;
      }
      for (const [id, t0] of d.begin) {
        const t = structuredClone(t0);
        if (mods.uniformScale) {
          t.scale = [t0.scale[0] * ratio, t0.scale[1] * ratio, t0.scale[2] * ratio];
        } else {
          t.scale[d.handle.axis] = t0.scale[d.handle.axis]! * ratio;
        }
        updates.set(id, t);
      }
    }
    this.doc.sessions.update(updates);
  }

  pointerUp(): void {
    if (!this.drag) return;
    this.drag = null;
    this.doc.sessions.commit();
  }

  cancelDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.doc.sessions.cancel();
  }

  /** Hover feedback: handle under the pointer turns primary (theme) color. */
  updateHover(raycaster: Raycaster): void {
    if (this.drag || !this.group.visible) return;
    const hitObj = this.pickHandle(raycaster.intersectObject(this.group, true));
    const mesh = hitObj ? ((hitObj.userData.visual as Mesh | undefined) ?? hitObj) : null;
    if (mesh === this.hovered) return;
    if (this.hovered) {
      const m = this.hovered.material as MeshBasicMaterial;
      m.opacity = (this.hovered.userData.baseOpacity as number | undefined) ?? BASE_OPACITY;
      m.color.copy(this.hovered.userData.baseColor as Color);
    }
    this.hovered = mesh;
    if (mesh) {
      const m = mesh.material as MeshBasicMaterial;
      m.opacity = 1;
      m.color.copy(this.hoverColor);
    }
  }

  /** Re-apply themed axis/center colors to existing handles (see viewportTheme). */
  applyTheme(): void {
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      const base = mesh.userData.baseColor as Color | undefined;
      if (!base) return; // pickers/non-handles carry no baseColor
      const handle = mesh.userData.handle as Handle;
      const color =
        handle.kind === "translate-view" || handle.kind === "scale-view"
          ? viewportTheme.gizmo.center
          : AXIS_COLORS[handle.axis];
      base.copy(color);
      if (mesh !== this.hovered) (mesh.material as MeshBasicMaterial).color.copy(color);
    });
  }

  private angleOnPlane(rel: Vector3, axis: Axis, basis: Quaternion): number {
    // signed angle of rel projected on the plane orthogonal to the (oriented) axis
    const u = AXIS_VECS[((axis + 1) % 3) as Axis].clone().applyQuaternion(basis);
    const v = AXIS_VECS[((axis + 2) % 3) as Axis].clone().applyQuaternion(basis);
    return Math.atan2(rel.dot(v), rel.dot(u));
  }

  private build(): void {
    // Radial layout (gizmo units), inside → out: plane quads near the center,
    // rotation rings, scale cubes just OUTSIDE the rings, move arrowheads
    // beyond those — so an edge-on ring in an ortho view never covers the
    // translate/scale handles and each family stays separately grabbable on a
    // crowded selection. See HANDLE_PRIORITY for the matching hit precedence.
    const PLANE_OFF = 0.35; // plane-quad center, along both in-plane axes
    const PLANE_SIZE = 0.22;
    const SCALE_R = 1.18; // just outside the ring
    const SHAFT_LEN = 1.36; // spans ~0.16 → 1.52, threading the scale cube
    const SHAFT_MID = 0.84;
    const ARROW_R = 1.6; // arrowhead clear beyond the scale cubes
    for (let axis = 0 as Axis; axis < 3; axis = (axis + 1) as Axis) {
      const color = AXIS_COLORS[axis];
      const dir = AXIS_VECS[axis];
      const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);

      const shaft = this.handleMesh(
        new CylinderGeometry(0.012, 0.012, SHAFT_LEN, 6),
        color,
        { kind: "translate", axis },
        new CylinderGeometry(PICK_MIN_RADIUS, PICK_MIN_RADIUS, SHAFT_LEN + 0.06, 6),
      );
      shaft.position.copy(dir).multiplyScalar(SHAFT_MID);
      shaft.quaternion.copy(quat);

      const head = this.handleMesh(
        new ConeGeometry(0.05, 0.16, 12),
        color,
        { kind: "translate", axis },
        new ConeGeometry(0.05 * PICK_SCALE, 0.16 * 1.6, 8),
      );
      head.position.copy(dir).multiplyScalar(ARROW_R);
      head.quaternion.copy(quat);

      const ring = this.handleMesh(
        new TorusGeometry(RING_R, 0.014, 8, 48),
        color,
        { kind: "rotate", axis },
        new TorusGeometry(RING_R, PICK_MIN_RADIUS, 6, 32),
      );
      ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir);

      const cube = this.handleMesh(
        new BoxGeometry(0.09, 0.09, 0.09),
        color,
        { kind: "scale", axis },
        new BoxGeometry(0.09 * PICK_SCALE, 0.09 * PICK_SCALE, 0.09 * PICK_SCALE),
      );
      cube.position.copy(dir).multiplyScalar(SCALE_R);

      // scale-only mode extras: the multi gizmo's translate shafts/quads fill
      // these spots, so the scale-mode gizmo brings its own — axis lines out
      // to the cubes, and near-center quads scaling both in-plane axes.
      const scaleShaft = this.handleMesh(
        new CylinderGeometry(0.012, 0.012, SCALE_R, 6),
        color,
        { kind: "scale", axis },
        new CylinderGeometry(PICK_MIN_RADIUS, PICK_MIN_RADIUS, SCALE_R, 6),
        { onlyMode: "scale" },
      );
      scaleShaft.position.copy(dir).multiplyScalar(SCALE_R / 2);
      scaleShaft.quaternion.copy(quat);

      // two-axis plane handle: a quad in the plane NORMAL to this axis, offset
      // along both in-plane axes (Blender-style). Edge-on quads (2D ortho
      // views) degenerate to hairlines and give way to the facing one, which
      // is exactly the pane's natural pan plane. Semi-transparent + DoubleSide
      // so it reads as a surface from either side.
      const u = AXIS_VECS[((axis + 1) % 3) as Axis];
      const v = AXIS_VECS[((axis + 2) % 3) as Axis];
      const planeQuad = (kind: "translate-plane" | "scale-plane", onlyMode?: GizmoMode) => {
        const quad = this.handleMesh(
          new PlaneGeometry(PLANE_SIZE, PLANE_SIZE),
          color,
          { kind, axis },
          new BoxGeometry(PLANE_SIZE * 1.6, PLANE_SIZE * 1.6, 0.04),
          { opacity: 0.4, doubleSide: true, onlyMode },
        );
        quad.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir);
        quad.position.addScaledVector(u, PLANE_OFF).addScaledVector(v, PLANE_OFF);
      };
      planeQuad("translate-plane");
      planeQuad("scale-plane", "scale"); // same spot — only one mode shows each
    }
    // C4D free-rotate: the fill of the rotate sphere (rotate-only mode).
    // Never rendered (picker material) — clicking inside the rings without
    // touching one starts a trackball drag; rings out-prioritize it.
    const trackball = new Mesh(new SphereGeometry(RING_R * 0.95, 16, 12), PICKER_MAT);
    trackball.userData.handle = { kind: "rotate-free", axis: 0 } satisfies Handle;
    trackball.userData.onlyMode = "rotate" satisfies GizmoMode;
    trackball.visible = false; // mode is "all" at build
    this.group.add(trackball);
    const center = this.handleMesh(
      new SphereGeometry(0.07, 16, 12),
      viewportTheme.gizmo.center,
      { kind: "translate-view", axis: 0 },
      new SphereGeometry(0.07 * PICK_SCALE, 8, 6),
    );
    center.position.set(0, 0, 0);

    // scale-only mode's center sphere: same look, but drags scale UNIFORMLY
    // (up/right grows, down/left shrinks — see the scale-view drag branch)
    const scaleCenter = this.handleMesh(
      new SphereGeometry(0.07, 16, 12),
      viewportTheme.gizmo.center,
      { kind: "scale-view", axis: 0 },
      new SphereGeometry(0.07 * PICK_SCALE, 8, 6),
      { onlyMode: "scale" },
    );
    scaleCenter.position.set(0, 0, 0);
  }

  /**
   * Visible handle + an invisible fat "picker" child that carries the same
   * handle payload — hit areas are PICK_SCALE× the visual footprint (the
   * same trick three's TransformControls uses).
   */
  private handleMesh(
    geometry: BufferGeometry,
    color: Color,
    handle: Handle,
    pickerGeometry: BufferGeometry,
    opts: { opacity?: number; doubleSide?: boolean; onlyMode?: GizmoMode } = {},
  ): Mesh {
    const opacity = opts.opacity ?? BASE_OPACITY;
    const mat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      // three's setValues warns on explicit undefined — only pass when set
      ...(opts.doubleSide ? { side: DoubleSide } : {}),
    });
    const mesh = new Mesh(geometry, mat);
    mesh.userData.handle = handle;
    mesh.userData.baseColor = color.clone();
    mesh.userData.baseOpacity = opacity;
    if (opts.onlyMode) mesh.userData.onlyMode = opts.onlyMode;
    mesh.visible = this.handleShown(mesh);
    mesh.renderOrder = 1000;

    const picker = new Mesh(pickerGeometry, PICKER_MAT);
    picker.userData.handle = handle;
    picker.userData.visual = mesh; // hover/hit resolve back to the visible mesh
    mesh.add(picker);

    this.group.add(mesh);
    return mesh;
  }
}

const BASE_OPACITY = 0.82;

function labelFor(kind: HandleKind): string {
  return kind.startsWith("rotate") ? "Rotate" : kind.startsWith("scale") ? "Scale" : "Move";
}
