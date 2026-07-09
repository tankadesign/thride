import {
  AmbientLight,
  type BufferGeometry,
  type Camera,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  HemisphereLight,
  Light,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Quaternion,
  RectAreaLight,
  SpotLight,
  Vector3,
} from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import type { Uuid } from "@/types/core";
import { defaultLightData, type LightDataDTO, SHADOW_CAPABLE } from "@/types/core/light";
import type { Document, SceneNode } from "@/core";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { buildPrimitive } from "@/geometry/primitives";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { RenderMesh } from "@/geometry/sync/RenderMesh";
import { buildCameraHelper } from "@/render/helpers/CameraHelper";
import {
  buildBillboardCircle,
  buildOrientedLightHelper,
  isBillboardLightType,
  updateBillboardHelper,
} from "@/render/helpers/LightHelpers";
import { SelectionOutline } from "./SelectionOutline";

// three-mesh-bvh accelerated raycast, wired once for the whole app
Mesh.prototype.raycast = acceleratedRaycast;
// biome-ignore lint/suspicious/noExplicitAny: prototype augmentation
(Object.getPrototypeOf(new Mesh().geometry) as any).computeBoundsTree = computeBoundsTree;
// biome-ignore lint/suspicious/noExplicitAny: prototype augmentation
(Object.getPrototypeOf(new Mesh().geometry) as any).disposeBoundsTree = disposeBoundsTree;

// default PBR material — double-sided (open meshes visible from behind),
// cast/receive shadows enabled on every mesh object
const BASE_MAT = new MeshStandardMaterial({
  color: 0xb8b8c0,
  roughness: 0.65,
  metalness: 0.05,
  side: DoubleSide,
});
const FLAT_MAT = new MeshBasicMaterial({ color: 0xb8b8c0, side: DoubleSide });
const WIRE_MAT = new MeshBasicMaterial({ color: 0x8a93a8, wireframe: true, side: DoubleSide });
// wireframe OVERLAY on top of a solid fill (Display > Lines) — polygon offset
// keeps the lines from z-fighting the filled surface underneath.
const LINES_MAT = new MeshBasicMaterial({
  color: 0x14151a,
  wireframe: true,
  transparent: true,
  opacity: 0.5,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});
/**
 * Projects the Document into a Three scene graph. The Document is the
 * truth; this class only reacts to events. Mesh nodes carry
 * userData.nodeId for picking.
 */
export class SceneSynchronizer {
  readonly root = new Group();
  private objects = new Map<Uuid, Object3D>();
  private renderMeshes = new Map<Uuid, { key: string; rm: RenderMesh; bvhStale: boolean }>();
  private readonly selectionOutline = new SelectionOutline();
  private linesOverlays = new Map<Uuid, Mesh>();
  private lightBillboards = new Map<Uuid, Object3D>();
  private lightCount = 0;
  private readonly lookMatrix = new Matrix4();
  private readonly lookPos = new Vector3();
  private readonly lookQuat = new Quaternion();
  private readonly doc: Document;
  private readonly onDirty: () => void;
  private unsubs: (() => void)[] = [];

  constructor(doc: Document, onDirty: () => void) {
    this.doc = doc;
    this.onDirty = onDirty;
    this.root.name = "thride-document";
    this.unsubs.push(
      doc.events.on("scene:node-added", ({ id }) => {
        this.addNode(id);
        this.onDirty();
      }),
      doc.events.on("scene:node-removed", ({ id }) => {
        this.removeNode(id);
        this.onDirty();
      }),
      doc.events.on("scene:node-changed", ({ id, preview }) => {
        this.updateNode(id, preview ?? false);
        this.onDirty();
      }),
      doc.events.on("scene:hierarchy-changed", ({ id }) => {
        this.reparent(id);
        this.onDirty();
      }),
      doc.events.on("selection:changed", () => {
        this.selectionOutline.sync(this.doc, this.objects);
        this.onDirty();
      }),
      doc.events.on("document:reset", () => {
        this.rebuildAll();
        this.onDirty();
      }),
    );
    this.rebuildAll();
  }

  object(id: Uuid): Object3D | undefined {
    return this.objects.get(id);
  }

  /** True once at least one light node exists — the viewport disables its default lighting rig. */
  get hasLights(): boolean {
    return this.lightCount > 0;
  }

  nodeIdOf(obj: Object3D): Uuid | null {
    let cur: Object3D | null = obj;
    while (cur) {
      if (cur.userData.nodeId) return cur.userData.nodeId as Uuid;
      cur = cur.parent;
    }
    return null;
  }

  /**
   * nodeId of a hit object, but ONLY if that node and every ancestor node is
   * visible — three's raycaster ignores `Object3D.visible` (and a hidden
   * ancestor never sets `.visible=false` on its descendants), so picking must
   * consult the document to match what's actually rendered. Returns null for
   * a hidden node so click-select / context-menu skip it.
   */
  visibleNodeIdOf(obj: Object3D): Uuid | null {
    const id = this.nodeIdOf(obj);
    if (!id) return null;
    let cur: Uuid | null = id;
    while (cur) {
      const node = this.doc.scene.get(cur);
      if (!node) return null;
      if (!node.visible) return null;
      cur = node.parent;
    }
    return id;
  }

  /** Current local Euler (XYZ) of a node's live object — used to bake a
   * target-follow orientation into the document when the target is cleared. */
  currentLocalRotation(id: Uuid): [number, number, number] | null {
    const obj = this.objects.get(id);
    if (!obj) return null;
    return [obj.rotation.x, obj.rotation.y, obj.rotation.z];
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    for (const { rm } of this.renderMeshes.values()) rm.dispose();
    this.renderMeshes.clear();
    this.objects.clear();
    this.root.clear();
  }

  private rebuildAll(): void {
    this.root.clear();
    this.objects.clear();
    this.linesOverlays.clear(); // repopulated by buildMeshObject during the walk below
    this.lightBillboards.clear(); // root.clear() already detached them; drop the stale refs
    this.lightCount = 0;
    const walk = (id: Uuid) => {
      this.addNode(id);
      for (const c of this.doc.scene.childrenOf(id)) walk(c);
    };
    for (const r of this.doc.scene.rootIds()) walk(r);
    this.selectionOutline.clear(); // objects were rebuilt; stale outline children are gone with them
    this.selectionOutline.sync(this.doc, this.objects);
  }

  private addNode(id: Uuid): void {
    if (this.objects.has(id)) return;
    const node = this.doc.scene.mustGet(id);
    let obj: Object3D;
    let lightData: LightDataDTO | null = null;
    if (node.kind === "mesh") obj = this.buildMeshObject(node);
    else if (node.kind === "light") {
      lightData = (node.data?.light as LightDataDTO | undefined) ?? defaultLightData("point");
      obj = this.buildLightObject(node);
      this.lightCount++;
    } else if (node.kind === "camera") obj = this.buildCameraObject();
    else obj = new Group();
    obj.name = node.name;
    obj.userData.nodeId = id;
    obj.visible = node.visible;
    this.objects.set(id, obj);
    this.applyTransform(node, obj);
    const parent = node.parent ? this.objects.get(node.parent) : undefined;
    (parent ?? this.root).add(obj);
    if (lightData) this.refreshLightBillboard(id, lightData);
  }

  private buildCameraObject(): Object3D {
    const group = new Group();
    group.add(buildCameraHelper());
    return group;
  }

  private buildLightObject(node: SceneNode): Object3D {
    const data = (node.data?.light as LightDataDTO | undefined) ?? defaultLightData("point");
    let light: Light;
    switch (data.type) {
      case "spot": {
        const l = new SpotLight(data.color, data.intensity, 0, data.angle, data.penumbra);
        light = l;
        break;
      }
      case "point":
        light = new PointLight(data.color, data.intensity);
        break;
      case "directional":
        light = new DirectionalLight(data.color, data.intensity);
        break;
      case "ambient":
        light = new AmbientLight(data.color, data.intensity);
        break;
      case "hemisphere":
        light = new HemisphereLight(data.color, data.groundColor ?? "#443c30", data.intensity);
        break;
      case "area": {
        const l = new RectAreaLight(data.color, data.intensity, data.width ?? 2, data.height ?? 2);
        light = l;
        break;
      }
    }
    if (
      light instanceof SpotLight ||
      light instanceof PointLight ||
      light instanceof DirectionalLight
    ) {
      light.castShadow = data.castShadow ?? true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.0004;
    }
    if (light instanceof SpotLight || light instanceof DirectionalLight) {
      // three aims spot/directional lights at `.target.position` in world
      // space and ignores the light's own rotation entirely. Without an
      // explicit target node, applyTargets() re-points this un-parented
      // stand-in along the node's own authored rotation each frame, so
      // rotating an untargeted spot/infinite light actually changes where
      // it shines.
      const autoTarget = new Object3D();
      light.userData.autoTarget = autoTarget;
      light.target = autoTarget;
    }
    light.userData.lightType = data.type;
    this.attachLightHelper(light, data);
    return light;
  }

  /** Cone (spot) / rect (area) visualizer as a child, so it follows the light's rotation. */
  private attachLightHelper(light: Light, data: LightDataDTO): void {
    const existing = light.children.find((c) => c.userData.orientedHelper);
    if (existing) light.remove(existing);
    const helper = buildOrientedLightHelper(data);
    if (helper) {
      helper.userData.orientedHelper = true;
      light.add(helper);
    }
  }

  /** Billboarded circle visualizer for non-oriented light types; tracked outside the light's own transform. */
  private refreshLightBillboard(id: Uuid, data: LightDataDTO): void {
    const existing = this.lightBillboards.get(id);
    if (existing) {
      existing.removeFromParent();
      this.lightBillboards.delete(id);
    }
    if (isBillboardLightType(data.type)) {
      const circle = buildBillboardCircle();
      this.root.add(circle);
      this.lightBillboards.set(id, circle);
    }
  }

  /** Apply light payload changes (color/intensity/shadow/params) in place. */
  private updateLightObject(node: SceneNode, obj: Object3D): Object3D {
    const data = node.data?.light as LightDataDTO | undefined;
    if (!data || !(obj instanceof Light)) return obj;
    if (obj.userData.lightType !== data.type) {
      // type changed: rebuild the light, keep real children + hierarchy position
      // (the stale oriented helper is dropped — buildLightObject attaches a fresh one)
      const fresh = this.buildLightObject(node);
      fresh.name = node.name;
      fresh.userData.nodeId = node.id;
      for (const child of [...obj.children]) {
        if (!child.userData.orientedHelper) fresh.add(child);
      }
      obj.parent?.add(fresh);
      obj.removeFromParent();
      this.objects.set(node.id, fresh);
      this.refreshLightBillboard(node.id, data);
      return fresh;
    }
    obj.color = new Color(data.color);
    obj.intensity = data.intensity;
    if (SHADOW_CAPABLE.has(data.type)) obj.castShadow = data.castShadow ?? true;
    if (obj instanceof SpotLight) {
      obj.angle = data.angle ?? obj.angle;
      obj.penumbra = data.penumbra ?? obj.penumbra;
    }
    if (obj instanceof HemisphereLight && data.groundColor) {
      obj.groundColor = new Color(data.groundColor);
    }
    if (obj instanceof RectAreaLight) {
      obj.width = data.width ?? obj.width;
      obj.height = data.height ?? obj.height;
    }
    this.attachLightHelper(obj, data);
    this.refreshLightBillboard(node.id, data);
    return obj;
  }

  private removeNode(id: Uuid): void {
    // subtree children were pruned from the document already; three children
    // of this object are stale projections — drop the whole subtree
    const obj = this.objects.get(id);
    if (!obj) return;
    obj.removeFromParent();
    obj.traverse((o) => {
      const nid = o.userData.nodeId as Uuid | undefined;
      if (nid) {
        this.objects.delete(nid);
        this.dropRenderMesh(nid);
        this.linesOverlays.delete(nid);
        if (o instanceof Light) this.lightCount--;
        const billboard = this.lightBillboards.get(nid);
        if (billboard) {
          billboard.removeFromParent();
          this.lightBillboards.delete(nid);
        }
      }
    });
  }

  private reparent(id: Uuid): void {
    const obj = this.objects.get(id);
    const node = this.doc.scene.mustGet(id);
    if (!obj) return;
    const parent = node.parent ? this.objects.get(node.parent) : undefined;
    (parent ?? this.root).add(obj);
    // sibling order is irrelevant for rendering; object manager reads the doc
  }

  private updateNode(id: Uuid, preview = false): void {
    let obj = this.objects.get(id);
    if (!obj) return;
    const node = this.doc.scene.mustGet(id);
    if (node.kind === "light") obj = this.updateLightObject(node, obj);
    obj.name = node.name;
    obj.visible = node.visible;
    this.applyTransform(node, obj);
    if (node.kind === "mesh" && obj instanceof Mesh) {
      this.syncGeometry(id, node, obj, preview);
    }
  }

  /**
   * Point `obj`'s local -Z at `targetPos`, regardless of object type.
   * `Object3D.lookAt()` swaps its eye/target order for anything that isn't
   * a real Camera/Light (`isCamera`/`isLight`) — so calling it on a camera
   * NODE (a plain Group, not a THREE.Camera) points local +Z at the target
   * instead, exactly reversing the camera pyramid helper. Every oriented
   * helper in this app assumes -Z-forward, so target-following always goes
   * through this instead of the built-in lookAt.
   */
  private lookAtForward(obj: Object3D, targetPos: Vector3): void {
    obj.updateWorldMatrix(true, false);
    this.lookPos.setFromMatrixPosition(obj.matrixWorld);
    this.lookMatrix.lookAt(this.lookPos, targetPos, obj.up);
    obj.quaternion.setFromRotationMatrix(this.lookMatrix);
    const parent = obj.parent;
    if (parent) {
      this.lookMatrix.extractRotation(parent.matrixWorld);
      this.lookQuat.setFromRotationMatrix(this.lookMatrix);
      obj.quaternion.premultiply(this.lookQuat.invert());
    }
  }

  /**
   * Target constraint (lights/cameras/any node with data.target): orient
   * toward the target's world position every frame — a render-side
   * constraint; the document transform is untouched.
   *
   * Spot/directional lights are special: three shines them at
   * `.target.position` in world space and ignores their own rotation
   * entirely. With a target node, we ALSO orient the light itself so its
   * quaternion (and therefore its child helper) visually follows the
   * target, not just the physical light. Without one, `.target` is
   * re-pointed along the node's own authored rotation every frame so
   * rotating the node actually changes where it shines.
   */
  applyTargets(): void {
    const pos = new Vector3();
    const dir = new Vector3();
    for (const [id, obj] of this.objects) {
      const node = this.doc.scene.get(id);
      const targetId = node?.data?.target as Uuid | undefined;
      const targetObj = targetId && targetId !== id ? this.objects.get(targetId) : undefined;
      if (obj instanceof SpotLight || obj instanceof DirectionalLight) {
        if (targetObj) {
          obj.target = targetObj; // three's native light targeting
          this.lookAtForward(obj, targetObj.getWorldPosition(pos));
        } else {
          const autoTarget = obj.userData.autoTarget as Object3D;
          obj.target = autoTarget;
          obj.getWorldPosition(pos);
          // Object3D.getWorldDirection() returns the raw +Z basis (unlike
          // Camera's override, which negates it) — negate to match the
          // -Z-forward convention every oriented helper in this app uses.
          obj.getWorldDirection(dir).negate();
          autoTarget.position.copy(pos).add(dir);
          autoTarget.updateMatrixWorld();
        }
      } else if (targetObj) {
        this.lookAtForward(obj, targetObj.getWorldPosition(pos));
      }
    }
  }

  /** Per-pane shading override (viewport Display menu). */
  applyShading(mode: "pbr" | "flat" | "wireframe", backfaces: boolean, lines: boolean): void {
    const mat = mode === "flat" ? FLAT_MAT : mode === "wireframe" ? WIRE_MAT : BASE_MAT;
    mat.side = backfaces ? DoubleSide : FrontSide;
    for (const obj of this.objects.values()) {
      if (obj instanceof Mesh && !obj.userData.outline) obj.material = mat;
    }
    const showLines = lines && mode !== "wireframe";
    for (const overlay of this.linesOverlays.values()) overlay.visible = showLines;
  }

  /** Resolve the node's geometry source (editable mesh or primitive) into its Mesh. */
  private syncGeometry(id: Uuid, node: SceneNode, obj: Mesh, preview = false): void {
    const source = this.geometrySource(node);
    if (!source) return;
    let entry = this.renderMeshes.get(id);
    const keyChanged = !entry || entry.key !== source.key;
    // live registry meshes are edited in place (component drags): same key,
    // dirty flags set — RenderMesh.sync routes positions-only updates cheaply
    const meshDirty = (source.live ?? false) && source.mesh.dirty !== 0;
    if (entry && !keyChanged && !meshDirty) {
      // drag settled: refresh the BVH skipped during preview frames
      if (!preview && entry.bvhStale) this.rebuildBvh(entry);
      return;
    }
    const rm = entry?.rm ?? new RenderMesh();
    rm.sync(source.mesh);
    if (!entry) {
      entry = { key: source.key, rm, bvhStale: false };
      this.renderMeshes.set(id, entry);
    }
    entry.key = source.key;
    if (preview)
      entry.bvhStale = true; // rebuilding per drag frame would hitch
    else this.rebuildBvh(entry);
    obj.geometry = rm.geometry;
    this.selectionOutline.updateGeometry(id, rm.geometry);
    const overlay = this.linesOverlays.get(id);
    if (overlay) overlay.geometry = rm.geometry;
  }

  private rebuildBvh(entry: { rm: RenderMesh; bvhStale: boolean }): void {
    // biome-ignore lint/suspicious/noExplicitAny: bvh extension
    (entry.rm.geometry as any).computeBoundsTree?.();
    entry.bvhStale = false;
  }

  /** Triangulated render data for a mesh node (face picking, component overlays). */
  renderInfoFor(id: Uuid): { geometry: BufferGeometry; triFace: Uint32Array } | null {
    const entry = this.renderMeshes.get(id);
    return entry ? { geometry: entry.rm.geometry, triFace: entry.rm.triFace } : null;
  }

  private geometrySource(node: SceneNode): { key: string; mesh: HEMesh; live?: boolean } | null {
    const meshRef = node.data?.mesh as { id: Uuid } | undefined;
    if (meshRef) {
      const mesh = meshRegistry.get(meshRef.id);
      if (!mesh) return null;
      return { key: `mesh:${meshRef.id}:${mesh.topologyVersion}`, mesh, live: true };
    }
    const desc = node.data?.primitive as PrimitiveDescriptor | undefined;
    if (desc) return { key: JSON.stringify(desc), mesh: buildPrimitive(desc) };
    return null;
  }

  private buildMeshObject(node: SceneNode): Mesh {
    const mesh = new Mesh(undefined, BASE_MAT);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.syncGeometry(node.id, node, mesh);
    if (!mesh.geometry.getAttribute("position")) {
      // node without geometry data: fall back to a unit cube
      const rm = new RenderMesh();
      rm.sync(buildPrimitive({ type: "cube", params: { width: 1, height: 1, depth: 1 } }));
      mesh.geometry = rm.geometry;
      this.renderMeshes.set(node.id, { key: "fallback", rm, bvhStale: false });
    }
    const overlay = new Mesh(mesh.geometry, LINES_MAT);
    overlay.raycast = () => {}; // never pickable
    overlay.userData.linesOverlay = true;
    overlay.visible = false;
    overlay.renderOrder = 1; // after the filled surface, so the offset lines win the depth test
    mesh.add(overlay);
    this.linesOverlays.set(node.id, overlay);
    return mesh;
  }

  private dropRenderMesh(id: Uuid): void {
    const entry = this.renderMeshes.get(id);
    if (entry) {
      entry.rm.dispose();
      this.renderMeshes.delete(id);
    }
  }

  private applyTransform(node: SceneNode, obj: Object3D): void {
    const t = node.transform;
    obj.position.set(t.position[0], t.position[1], t.position[2]);
    obj.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2], "XYZ");
    obj.scale.set(t.scale[0], t.scale[1], t.scale[2]);
  }

  /**
   * Keep selection outlines a constant pixel width for this pane's camera.
   * Called per pane before rendering (world units per pixel depend on the camera).
   */
  updateOutlines(camera: Camera, viewportHeightPx: number): void {
    this.selectionOutline.updateSizes(camera, viewportHeightPx, this.objects);
  }

  /** Face + resize the billboarded light circles for this pane's camera. Call once per pane, before render. */
  updateHelperBillboards(camera: Camera, viewportHeightPx: number): void {
    if (this.lightBillboards.size === 0 || viewportHeightPx <= 0) return;
    const pos = new Vector3();
    for (const [id, billboard] of this.lightBillboards) {
      const light = this.objects.get(id);
      if (!light) continue;
      light.getWorldPosition(pos);
      billboard.position.copy(pos);
      updateBillboardHelper(billboard, camera, viewportHeightPx);
    }
  }
}
