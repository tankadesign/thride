import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import type { Uuid } from "@/types/core";
import { MeshTopologyCommand } from "@/geometry/commands/topology";
import { weldVerticesTo } from "@/geometry/ops/weld";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { pickComponent } from "@/render/picking/componentPicking";
import { themeColor } from "@/render/scene-sync/themeColor";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";

/** Screen-space radius around a neighbor point that arms the weld (px). */
const WELD_RADIUS_PX = 50;
const GHOST_PX = 9;
const TARGET_PX = 12;

/**
 * C4D-style weld-as-a-tool: with the tool armed (point mode), dragging a
 * vertex slides a GHOST copy along its best incident edge (screen-space
 * projection — the real vertex never moves). When the ghost comes within
 * WELD_RADIUS_PX of the edge's far vertex, that target lights up in the
 * success color with a connecting line; releasing then welds source INTO
 * target (target keeps its exact position) as one undo step. Releasing
 * outside the radius does nothing.
 */
export class WeldTool {
  readonly group = new Group();
  private readonly vs: ViewportSystem;
  private readonly success = themeColor("--color-success", "#00b16a");
  private readonly ghost: Mesh;
  private readonly target: Mesh;
  private readonly link: Line;
  private drag: {
    nodeId: Uuid;
    meshId: Uuid;
    source: number;
    neighbors: number[];
    object: Object3D;
    pane: number;
    locked: number | null;
  } | null = null;

  constructor(vs: ViewportSystem) {
    this.vs = vs;
    this.group.name = "weld-tool";
    this.group.visible = false;
    const quad = (color: ReturnType<typeof themeColor>, opacity: number) => {
      const m = new Mesh(
        new PlaneGeometry(1, 1),
        new MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false }),
      );
      m.renderOrder = 960;
      m.raycast = () => {};
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.ghost = quad(themeColor("--color-base-content", "#e0e0e6"), 0.85);
    this.target = quad(this.success, 0.95);
    const lineGeo = new BufferGeometry();
    lineGeo.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
    this.link = new Line(
      lineGeo,
      new LineBasicMaterial({ color: this.success, depthTest: false, transparent: true }),
    );
    this.link.renderOrder = 955;
    this.link.raycast = () => {};
    this.link.frustumCulled = false;
    this.group.add(this.link);
  }

  get isDragging(): boolean {
    return this.drag !== null;
  }

  /** LMB down while armed: start sliding if a vertex is under the cursor. */
  beginDrag(e: PointerEvent, pane: number): boolean {
    const vs = this.vs;
    const doc = vs.doc;
    const active = doc.selection.active;
    if (!active || !doc.scene.has(active)) return false;
    const meshRef = doc.scene.mustGet(active).data?.mesh as { id: Uuid } | undefined;
    const mesh = meshRef ? meshRegistry.get(meshRef.id) : undefined;
    const object = vs.sync.object(active);
    if (!meshRef || !mesh || !(object instanceof Mesh)) return false;
    const rect = vs.canvas.getBoundingClientRect();
    vs.setRayFromEvent(e, pane);
    const source = pickComponent("point", {
      mesh,
      meshObject: object,
      camera: vs.rigFor(pane).camera,
      pane: vs.paneRect(pane),
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      raycaster: vs.raycaster,
      triFace: vs.sync.renderInfoFor(active)?.triFace ?? null,
    });
    if (source === null) return false;
    // slide targets: every vertex sharing an edge with the source
    const neighbors = new Set<number>();
    for (let h = 0; h < mesh.heCount; h++) {
      const a = mesh.heVert[h]!;
      const b = mesh.heVert[mesh.heNext[h]!]!;
      if (a === source) neighbors.add(b);
      else if (b === source) neighbors.add(a);
    }
    if (neighbors.size === 0) return false;
    this.drag = {
      nodeId: active,
      meshId: meshRef.id,
      source,
      neighbors: [...neighbors],
      object,
      pane,
      locked: null,
    };
    this.update(e);
    return true;
  }

  /** Slide the ghost along the incident edge closest to the cursor. */
  update(e: PointerEvent): void {
    const drag = this.drag;
    const mesh = drag ? meshRegistry.get(drag.meshId) : undefined;
    if (!drag || !mesh) return;
    const vs = this.vs;
    const rect = vs.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const camera = vs.rigFor(drag.pane).camera;
    const pane = vs.paneRect(drag.pane);
    camera.updateMatrixWorld();
    drag.object.updateMatrixWorld();

    const toPane = (v: number, out: { x: number; y: number }): boolean => {
      const w = new Vector3(mesh.vPos[v * 3]!, mesh.vPos[v * 3 + 1]!, mesh.vPos[v * 3 + 2]!)
        .applyMatrix4(drag.object.matrixWorld)
        .applyMatrix4(camera.matrixWorldInverse);
      if ((camera as PerspectiveCamera).isPerspectiveCamera && w.z >= -1e-6) return false;
      w.applyMatrix4(camera.projectionMatrix);
      out.x = pane.x + ((w.x + 1) / 2) * pane.w;
      out.y = pane.y + ((1 - w.y) / 2) * pane.h;
      return true;
    };

    const src = { x: 0, y: 0 };
    if (!toPane(drag.source, src)) return;
    // best incident edge = the screen segment nearest the cursor; ghost sits
    // at the cursor's parameter t along it
    let best: { neighbor: number; t: number; dist: number; px: number; py: number } | null = null;
    const nb = { x: 0, y: 0 };
    for (const n of drag.neighbors) {
      if (!toPane(n, nb)) continue;
      const dx = nb.x - src.x;
      const dy = nb.y - src.y;
      const lenSq = dx * dx + dy * dy;
      const t =
        lenSq === 0 ? 0 : MathUtils.clamp(((cx - src.x) * dx + (cy - src.y) * dy) / lenSq, 0, 1);
      const px = src.x + t * dx;
      const py = src.y + t * dy;
      const dist = Math.hypot(cx - px, cy - py);
      if (!best || dist < best.dist) best = { neighbor: n, t, dist, px, py };
    }
    if (!best) return;
    const local = (v: number) =>
      new Vector3(mesh.vPos[v * 3]!, mesh.vPos[v * 3 + 1]!, mesh.vPos[v * 3 + 2]!);
    const ghostWorld = local(drag.source)
      .lerp(local(best.neighbor), best.t)
      .applyMatrix4(drag.object.matrixWorld);
    const targetWorld = local(best.neighbor).applyMatrix4(drag.object.matrixWorld);
    const targetPane = { x: 0, y: 0 };
    toPane(best.neighbor, targetPane);
    drag.locked =
      Math.hypot(best.px - targetPane.x, best.py - targetPane.y) <= WELD_RADIUS_PX
        ? best.neighbor
        : null;

    // billboards sized in pane pixels (same math as the vertex overlays)
    const quat = new Quaternion();
    camera.getWorldQuaternion(quat);
    const perPixel = (at: Vector3): number => {
      const ortho = camera as OrthographicCamera;
      if (ortho.isOrthographicCamera) return (ortho.top - ortho.bottom) / Math.max(1, pane.h);
      const persp = camera as PerspectiveCamera;
      const camPos = new Vector3().setFromMatrixPosition(camera.matrixWorld);
      return (
        (2 * camPos.distanceTo(at) * Math.tan(MathUtils.degToRad(persp.fov / 2))) /
        Math.max(1, pane.h)
      );
    };
    const compose = (m: Mesh, at: Vector3, px: number) =>
      m.matrix.compose(at, quat, new Vector3().setScalar(Math.max(1e-6, px * perPixel(at))));
    this.ghost.matrixAutoUpdate = false;
    this.target.matrixAutoUpdate = false;
    compose(this.ghost, ghostWorld, GHOST_PX);
    compose(this.target, targetWorld, TARGET_PX);
    this.target.visible = drag.locked !== null;
    this.link.visible = drag.locked !== null;
    const pos = this.link.geometry.getAttribute("position") as BufferAttribute;
    pos.setXYZ(0, ghostWorld.x, ghostWorld.y, ghostWorld.z);
    pos.setXYZ(1, targetWorld.x, targetWorld.y, targetWorld.z);
    pos.needsUpdate = true;
    this.group.visible = true;
  }

  /** Release: weld source into the locked target, or do nothing. */
  finish(): void {
    const drag = this.drag;
    this.reset();
    if (!drag || drag.locked === null) return;
    const target = drag.locked;
    this.vs.doc.history.run(
      new MeshTopologyCommand(drag.nodeId, drag.meshId, "Weld", (m) =>
        weldVerticesTo(m, [drag.source], target),
      ),
    );
  }

  cancel(): void {
    this.reset();
  }

  private reset(): void {
    this.drag = null;
    this.group.visible = false;
    this.target.visible = false;
    this.link.visible = false;
    this.vs.invalidate();
  }
}
