import {
  AmbientLight,
  BackSide,
  type Camera,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  HemisphereLight,
  Light,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PointLight,
  RectAreaLight,
  SpotLight,
  Vector3,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import type { Uuid } from "@/types/core";
import { defaultLightData, type LightDataDTO, SHADOW_CAPABLE } from "@/types/core/light";
import type { Document, SceneNode } from "@/core";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { buildPrimitive } from "@/geometry/primitives";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { RenderMesh } from "@/geometry/sync/RenderMesh";
import { normalLocal, positionLocal, uniform } from "@/materials/tsl";
import { themeColor } from "./themeColor";

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
const OUTLINE_PX = 2;

interface OutlineEntry {
  mesh: Mesh;
  offset: { value: number }; // uniform node driving the normal expansion
}

/**
 * Projects the Document into a Three scene graph. The Document is the
 * truth; this class only reacts to events. Mesh nodes carry
 * userData.nodeId for picking.
 */
export class SceneSynchronizer {
  readonly root = new Group();
  private objects = new Map<Uuid, Object3D>();
  private renderMeshes = new Map<Uuid, { key: string; rm: RenderMesh }>();
  private outlines = new Map<Uuid, OutlineEntry>();
  private linesOverlays = new Map<Uuid, Mesh>();
  private readonly outlineColor = themeColor("--color-primary", "#ff865b");
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
      doc.events.on("scene:node-changed", ({ id }) => {
        this.updateNode(id);
        this.onDirty();
      }),
      doc.events.on("scene:hierarchy-changed", ({ id }) => {
        this.reparent(id);
        this.onDirty();
      }),
      doc.events.on("selection:changed", () => {
        this.updateSelectionOutlines();
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

  nodeIdOf(obj: Object3D): Uuid | null {
    let cur: Object3D | null = obj;
    while (cur) {
      if (cur.userData.nodeId) return cur.userData.nodeId as Uuid;
      cur = cur.parent;
    }
    return null;
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
    const walk = (id: Uuid) => {
      this.addNode(id);
      for (const c of this.doc.scene.childrenOf(id)) walk(c);
    };
    for (const r of this.doc.scene.rootIds()) walk(r);
    this.outlines.clear(); // objects were rebuilt; stale outline children are gone with them
    this.updateSelectionOutlines();
  }

  private addNode(id: Uuid): void {
    if (this.objects.has(id)) return;
    const node = this.doc.scene.mustGet(id);
    let obj: Object3D;
    if (node.kind === "mesh") obj = this.buildMeshObject(node);
    else if (node.kind === "light") obj = this.buildLightObject(node);
    else obj = new Group();
    obj.name = node.name;
    obj.userData.nodeId = id;
    this.objects.set(id, obj);
    this.applyTransform(node, obj);
    const parent = node.parent ? this.objects.get(node.parent) : undefined;
    (parent ?? this.root).add(obj);
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
    light.userData.lightType = data.type;
    return light;
  }

  /** Apply light payload changes (color/intensity/shadow/params) in place. */
  private updateLightObject(node: SceneNode, obj: Object3D): Object3D {
    const data = node.data?.light as LightDataDTO | undefined;
    if (!data || !(obj instanceof Light)) return obj;
    if (obj.userData.lightType !== data.type) {
      // type changed: rebuild the light, keep children + hierarchy position
      const fresh = this.buildLightObject(node);
      fresh.name = node.name;
      fresh.userData.nodeId = node.id;
      for (const child of [...obj.children]) fresh.add(child);
      obj.parent?.add(fresh);
      obj.removeFromParent();
      this.objects.set(node.id, fresh);
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

  private updateNode(id: Uuid): void {
    let obj = this.objects.get(id);
    if (!obj) return;
    const node = this.doc.scene.mustGet(id);
    if (node.kind === "light") obj = this.updateLightObject(node, obj);
    obj.name = node.name;
    obj.visible = node.visible;
    this.applyTransform(node, obj);
    if (node.kind === "mesh" && obj instanceof Mesh) {
      this.syncGeometry(id, node, obj);
    }
  }

  /**
   * Target constraint (lights/cameras/any node with data.target): orient
   * toward the target's world position every frame — a render-side
   * constraint; the document transform is untouched.
   */
  applyTargets(): void {
    const pos = new Vector3();
    for (const [id, obj] of this.objects) {
      const node = this.doc.scene.get(id);
      const targetId = node?.data?.target as Uuid | undefined;
      if (!targetId || targetId === id) continue;
      const targetObj = this.objects.get(targetId);
      if (!targetObj) continue;
      if (obj instanceof SpotLight || obj instanceof DirectionalLight) {
        obj.target = targetObj; // three's native light targeting
      } else {
        obj.lookAt(targetObj.getWorldPosition(pos));
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
  private syncGeometry(id: Uuid, node: SceneNode, obj: Mesh): void {
    const source = this.geometrySource(node);
    if (!source) return;
    const entry = this.renderMeshes.get(id);
    if (entry && entry.key === source.key) return;
    const rm = entry?.rm ?? new RenderMesh();
    rm.sync(source.mesh);
    // biome-ignore lint/suspicious/noExplicitAny: bvh extension
    (rm.geometry as any).computeBoundsTree?.();
    this.renderMeshes.set(id, { key: source.key, rm });
    obj.geometry = rm.geometry;
    const outline = this.outlines.get(id);
    if (outline) outline.mesh.geometry = rm.geometry;
    const overlay = this.linesOverlays.get(id);
    if (overlay) overlay.geometry = rm.geometry;
  }

  private geometrySource(node: SceneNode): { key: string; mesh: HEMesh } | null {
    const meshRef = node.data?.mesh as { id: Uuid } | undefined;
    if (meshRef) {
      const mesh = meshRegistry.get(meshRef.id);
      if (!mesh) return null;
      return { key: `mesh:${meshRef.id}:${mesh.topologyVersion}`, mesh };
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
      this.renderMeshes.set(node.id, { key: "fallback", rm });
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

  /** 2px primary-color silhouette: backface hull expanded along normals. */
  private updateSelectionOutlines(): void {
    // drop outlines for deselected/removed nodes
    for (const [id, entry] of [...this.outlines]) {
      if (!this.doc.selection.has(id) || !this.objects.has(id)) {
        entry.mesh.removeFromParent();
        (entry.mesh.material as MeshBasicNodeMaterial).dispose();
        this.outlines.delete(id);
      }
    }
    // add outlines for newly selected mesh nodes
    for (const id of this.doc.selection.objectIds) {
      if (this.outlines.has(id)) continue;
      const obj = this.objects.get(id);
      if (!(obj instanceof Mesh)) continue;
      const offset = uniform(0.01);
      const mat = new MeshBasicNodeMaterial();
      mat.color.copy(this.outlineColor);
      mat.side = BackSide;
      mat.positionNode = positionLocal.add(normalLocal.mul(offset));
      const outline = new Mesh(obj.geometry, mat);
      outline.raycast = () => {}; // never pickable
      outline.userData.outline = true;
      outline.renderOrder = -1; // hull first, real surface wins the depth test
      obj.add(outline);
      this.outlines.set(id, { mesh: outline, offset });
    }
  }

  /**
   * Keep outlines exactly OUTLINE_PX thick for this pane's camera. Called
   * per pane before rendering (world units per pixel depend on the camera).
   */
  updateOutlines(camera: Camera, viewportHeightPx: number): void {
    if (this.outlines.size === 0 || viewportHeightPx <= 0) return;
    const objPos = new Vector3();
    const objScale = new Vector3();
    for (const [id, entry] of this.outlines) {
      const obj = this.objects.get(id);
      if (!obj) continue;
      obj.getWorldPosition(objPos);
      obj.getWorldScale(objScale);
      let worldPerPixel: number;
      if (camera instanceof PerspectiveCamera) {
        const dist = camera.position.distanceTo(objPos);
        worldPerPixel =
          (2 * dist * Math.tan(MathUtils.degToRad(camera.fov / 2))) / viewportHeightPx;
      } else {
        const ortho = camera as OrthographicCamera;
        worldPerPixel = (ortho.top - ortho.bottom) / viewportHeightPx;
      }
      // compensate the object's world scale (positionNode offsets in local space)
      const avgScale =
        (Math.abs(objScale.x) + Math.abs(objScale.y) + Math.abs(objScale.z)) / 3 || 1;
      entry.offset.value = (OUTLINE_PX * worldPerPixel) / avgScale;
    }
  }
}
