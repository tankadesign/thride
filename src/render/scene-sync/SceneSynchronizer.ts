import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SpotLight,
  Vector3,
} from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import type { PlanarReflectionDTO, Uuid } from "@/types/core";
import { type LightDataDTO, SHADOW_CAPABLE } from "@/types/core/light";
import type { Document, SceneNode } from "@/core";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { edgeVerts, uniqueEdges } from "@/geometry/kernel/components";
import { buildPrimitive } from "@/geometry/primitives";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { RenderMesh } from "@/geometry/sync/RenderMesh";
import { buildCameraHelper } from "@/render/helpers/CameraHelper";
import { buildPickProxy } from "@/render/helpers/pickProxy";
import { HELPER_LAYER } from "@/render/layers";
import { viewportTheme } from "@/render/theme/viewportTheme";
import { evaluateGenerator } from "@/generators/graph";
import { LightSync } from "./LightSync";
import { MaterialSync, type WarmFn } from "./MaterialSync";
import { SelectionOutline } from "./SelectionOutline";
import { buildSplineObject, syncSplineGeometry } from "./SplineSync";

// three-mesh-bvh accelerated raycast, wired once for the whole app
Mesh.prototype.raycast = acceleratedRaycast;
// biome-ignore lint/suspicious/noExplicitAny: prototype augmentation
(Object.getPrototypeOf(new Mesh().geometry) as any).computeBoundsTree = computeBoundsTree;
// biome-ignore lint/suspicious/noExplicitAny: prototype augmentation
(Object.getPrototypeOf(new Mesh().geometry) as any).disposeBoundsTree = disposeBoundsTree;

// default PBR material — double-sided (open meshes visible from behind),
// cast/receive shadows enabled on every mesh object
const BASE_MAT = new MeshStandardMaterial({
  color: viewportTheme.polygonColor,
  roughness: 0.65,
  metalness: 0.05,
  side: DoubleSide,
});
const FLAT_MAT = new MeshBasicMaterial({ color: viewportTheme.polygonColor, side: DoubleSide });
// Wireframe shading hides the surface but keeps it raycastable (picking).
const HIDDEN_MAT = new MeshBasicMaterial({ visible: false });
// KERNEL edges (quads stay quads — no triangulation diagonals, C4D-style).
// depthTest off: lines always win over the surface (no z-fighting games);
// the Lines overlay stays subtle via opacity, wireframe mode reads solid.
const LINES_EDGE_MAT = new LineBasicMaterial({
  color: viewportTheme.lineColor,
  transparent: true,
  opacity: 0.55,
  depthTest: false,
});
const WIRE_EDGE_MAT = new LineBasicMaterial({
  color: viewportTheme.wireframeColor,
  depthTest: false,
});
// Selected objects in wireframe mode read via wire COLOR alone — the
// silhouette hull is hidden there (nothing paints over its interior, it
// would read as a solid fill; see applyShading).
const SELECTED_WIRE_MAT = new LineBasicMaterial({
  color: viewportTheme.selectedWireframeColor,
  depthTest: false,
});

/**
 * Sorted attribute names of a geometry — the material-pipeline-relevant part of
 * its layout. Changes here (notably `uv` appearing) mean a node material must
 * recompile; a positions-only edit leaves this identical (see syncGeometry).
 */
function attrSignature(geometry: { attributes?: Record<string, unknown> } | undefined): string {
  return geometry?.attributes ? Object.keys(geometry.attributes).sort().join(",") : "";
}

/** Re-apply theme colors to the shared mesh materials (see viewportTheme). */
export function applyMeshMaterialsTheme(): void {
  BASE_MAT.color.copy(viewportTheme.polygonColor);
  FLAT_MAT.color.copy(viewportTheme.polygonColor);
  LINES_EDGE_MAT.color.copy(viewportTheme.lineColor);
  WIRE_EDGE_MAT.color.copy(viewportTheme.wireframeColor);
  SELECTED_WIRE_MAT.color.copy(viewportTheme.selectedWireframeColor);
}
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
  /** Per mesh node: kernel-edge wireframe (Display > Lines + wireframe shading). */
  private edgeWires = new Map<Uuid, LineSegments>();
  private readonly lights = new LightSync(this.root);
  /** Library-material cache; resolves per-mesh materials in the PBR shading path. */
  private materials!: MaterialSync;
  /** Last-seen shadow-caster count — drives material recompiles (see below). */
  private shadowCasterCount = -1;
  private readonly lookMatrix = new Matrix4();
  private readonly lookPos = new Vector3();
  private readonly lookQuat = new Quaternion();
  private readonly doc: Document;
  private readonly onDirty: (burst?: boolean) => void;
  private unsubs: (() => void)[] = [];

  constructor(doc: Document, onDirty: (burst?: boolean) => void) {
    this.doc = doc;
    this.onDirty = onDirty;
    this.materials = new MaterialSync(doc, BASE_MAT, onDirty);
    this.root.name = "thride-document";
    this.unsubs.push(
      doc.events.on("scene:node-added", ({ id }) => {
        this.addNode(id);
        if (this.doc.scene.get(id)?.kind === "light") this.refreshShadowMaterials();
        // a newly added/restored child re-supplies a generator's input, so the
        // parent generator must re-evaluate (mirrors node-removed). Undo of a
        // deleted sweep/spline-extrude restores the subtree PARENTS-FIRST, so the
        // generator is re-added childless (renders empty) — without this it never
        // recomputes when its children come back.
        const parent = this.doc.scene.get(id)?.parent ?? null;
        if (parent && this.doc.scene.has(parent)) this.updateNode(parent);
        this.onDirty();
      }),
      doc.events.on("scene:node-removed", ({ id, parent }) => {
        this.removeNode(id);
        this.refreshShadowMaterials(); // may have removed the last shadow caster
        // losing a child may change an ancestor generator's input
        if (parent && this.doc.scene.has(parent)) this.updateNode(parent);
        this.onDirty();
      }),
      doc.events.on("scene:node-changed", ({ id, preview }) => {
        this.updateNode(id, preview ?? false);
        if (this.doc.scene.get(id)?.kind === "light") this.refreshShadowMaterials();
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
        this.materials.clear();
        this.rebuildAll();
        this.onDirty();
      }),
      doc.events.on("material:added", () => this.onDirty()),
      doc.events.on("material:changed", ({ id }) => {
        this.materials.onChanged(id);
        this.onDirty();
      }),
      doc.events.on("material:removed", ({ id }) => {
        this.materials.onRemoved(id);
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
    return this.lights.hasLights;
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
    if (this.isConsumed(id)) return null; // boolean inputs click through to the result
    let cur: Uuid | null = id;
    while (cur) {
      const node = this.doc.scene.get(cur);
      if (!node) return null;
      if (!node.visible) return null;
      cur = node.parent;
    }
    return id;
  }

  /**
   * True when a node is a descendant of a boolean generator, which consumes
   * its inputs — they must render nothing and never pick (clicks fall through
   * to the boolean result), matching C4D. Extrude/sweep keep their spline
   * children visible as guides, so this is boolean-specific.
   */
  private isConsumed(id: Uuid): boolean {
    let parent = this.doc.scene.get(id)?.parent;
    while (parent) {
      const node = this.doc.scene.get(parent);
      if (!node) return false;
      const gen = node.data?.generator as { type?: string } | undefined;
      if (node.kind === "generator" && gen?.type === "boolean") return true;
      parent = node.parent;
    }
    return false;
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
    this.edgeWires.clear(); // repopulated by buildMeshObject during the walk below
    this.lights.clear(); // root.clear() already detached the billboards
    const walk = (id: Uuid) => {
      this.addNode(id);
      for (const c of this.doc.scene.childrenOf(id)) walk(c);
    };
    for (const r of this.doc.scene.rootIds()) walk(r);
    this.selectionOutline.clear(); // objects were rebuilt; stale outline children are gone with them
    this.selectionOutline.sync(this.doc, this.objects);
  }

  /**
   * three's WebGPU node materials bake shadow-receiving code at compile time
   * from the scene's shadow-casting lights. Adding the first caster (or
   * removing the last, or toggling a light's Shadows) at runtime does NOT
   * recompile them, so cast shadows would silently not appear until a reload.
   * Recompile the lit material whenever that set's size changes. (No-op — and
   * so no shader hitch — while scrubbing a light's intensity/color/angle.)
   */
  private refreshShadowMaterials(): void {
    let count = 0;
    for (const node of this.doc.scene.toDTO()) {
      const light = node.data?.light as LightDataDTO | undefined;
      if (light && SHADOW_CAPABLE.has(light.type) && (light.castShadow ?? true)) count++;
    }
    if (count !== this.shadowCasterCount) {
      this.shadowCasterCount = count;
      BASE_MAT.needsUpdate = true;
    }
  }

  private addNode(id: Uuid): void {
    if (this.objects.has(id)) return;
    const node = this.doc.scene.mustGet(id);
    let obj: Object3D;
    try {
      if (node.kind === "mesh" || node.kind === "generator") obj = this.buildMeshObject(node);
      else if (node.kind === "spline") obj = buildSplineObject(node);
      else if (node.kind === "light") obj = this.lights.build(node);
      else if (node.kind === "camera") obj = this.buildCameraObject();
      else obj = new Group();
    } catch (err) {
      // Corrupt node payload (bad import, format drift, …) — render nothing
      // for THIS node instead of letting the throw unmount the whole app.
      // The empty group keeps the hierarchy intact so children still attach.
      console.warn(`thride: node "${node.name}" (${node.kind}) failed to build — skipped`, err);
      obj = new Group();
    }
    obj.name = node.name;
    obj.userData.nodeId = id;
    // splines own their visibility in syncSplineGeometry (a <2-point spline
    // must stay hidden — its empty Line2 pipeline kills the WebGPU pass)
    if (!obj.userData.spline) obj.visible = node.visible && !this.isConsumed(id);
    this.objects.set(id, obj);
    this.applyTransform(node, obj);
    const parent = node.parent ? this.objects.get(node.parent) : undefined;
    (parent ?? this.root).add(obj);
    if (node.kind === "light") this.lights.onNodeAdded(id, node);
  }

  private buildCameraObject(): Object3D {
    const group = new Group();
    const helper = buildCameraHelper();
    // helper layer: the camera pyramid must not appear in SSR / planar-mirror
    // reflections; the viewport's overlay render draws it instead
    helper.traverse((o) => o.layers.set(HELPER_LAYER));
    group.add(helper);
    group.add(buildPickProxy()); // invisible proxy so the camera is click-selectable
    return group;
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
        this.materials.releasePlanar(nid);
        this.edgeWires.get(nid)?.geometry.dispose();
        this.edgeWires.delete(nid);
        this.lights.onNodeRemoved(nid, o);
      }
    });
  }

  private reparent(id: Uuid): void {
    const obj = this.objects.get(id);
    const node = this.doc.scene.mustGet(id);
    if (!obj) return;
    // the node the child is LEAVING (its old three parent still holds it here);
    // that generator loses an input and must re-evaluate to shed the old mesh
    const oldParentId = obj.parent?.userData.nodeId as Uuid | undefined;
    const parent = node.parent ? this.objects.get(node.parent) : undefined;
    (parent ?? this.root).add(obj);
    // sibling order is irrelevant for rendering; object manager reads the doc.
    // A node moving under/out of a generator changes that generator's input.
    this.updateNode(id);
    if (oldParentId && oldParentId !== node.parent && this.doc.scene.has(oldParentId)) {
      this.updateNode(oldParentId);
    }
  }

  private updateNode(id: Uuid, preview = false): void {
    let obj = this.objects.get(id);
    if (!obj) return;
    const node = this.doc.scene.mustGet(id);
    try {
      if (node.kind === "light") {
        obj = this.lights.update(node, obj);
        this.objects.set(id, obj); // type changes rebuild the light object
      }
      obj.name = node.name;
      // splines: see addNode. Consumed = a boolean input (hidden + unpickable).
      if (!obj.userData.spline) obj.visible = node.visible && !this.isConsumed(id);
      this.applyTransform(node, obj);
      if (
        (node.kind === "mesh" || node.kind === "generator") &&
        obj instanceof Mesh &&
        !obj.userData.spline
      ) {
        this.syncGeometry(id, node, obj, preview);
      }
      if (node.kind === "spline" && obj.userData.spline) {
        syncSplineGeometry(node, obj as Parameters<typeof syncSplineGeometry>[1]);
      }
    } catch (err) {
      // corrupt payload on a live edit — keep the stale visual, don't let the
      // throw take down the event dispatch / undo machinery (see addNode)
      console.warn(`thride: node "${node.name}" (${node.kind}) failed to update — kept stale`, err);
    }
    // dirty propagation: a change inside a generator's subtree re-evaluates
    // the generator (pull-based — the memo key decides if work happens)
    let parent = node.parent;
    while (parent) {
      const pNode = this.doc.scene.get(parent);
      if (!pNode) break;
      if (pNode.kind === "generator") this.updateNode(parent, preview);
      parent = pNode.parent;
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
  /**
   * Install the material pipeline-warm hook. Only the render layer has the
   * renderer, so it injects the compile; MaterialSync decides when to call it.
   */
  setMaterialWarm(fn: WarmFn | null): void {
    this.materials.setWarm(fn);
  }

  /**
   * A detached mesh carrying `mat` on the geometry of a real mesh that uses
   * `matId` — for warming a pipeline before swapping the material in. Using the
   * REAL geometry matters: the compiled pipeline is keyed partly on the vertex
   * attribute layout, so a stand-in box could warm the wrong variant.
   *
   * Never added to the scene (so it never draws) and `frustumCulled` off, since
   * `compileAsync` runs the same frustum test `render` does and would otherwise
   * skip it.
   */
  warmProbe(matId: Uuid, mat: Material): Mesh | null {
    for (const [id, obj] of this.objects) {
      if (!(obj instanceof Mesh) || obj.userData.outline || obj.userData.spline) continue;
      if ((this.doc.scene.get(id)?.data?.material as Uuid | undefined) !== matId) continue;
      const probe = new Mesh(obj.geometry, mat);
      probe.frustumCulled = false;
      return probe;
    }
    return null;
  }

  /**
   * First scene object whose node is assigned `matId` — the Texture-mode gizmo's
   * fallback anchor when the material's object isn't the current selection.
   * Insertion order, so it's stable across frames.
   */
  objectForMaterial(matId: Uuid): Object3D | null {
    for (const [id, obj] of this.objects) {
      if (obj.userData.outline || obj.userData.spline) continue;
      if ((this.doc.scene.get(id)?.data?.material as Uuid | undefined) === matId) return obj;
    }
    return null;
  }

  applyShading(
    mode: "pbr" | "flat" | "wireframe",
    backfaces: boolean,
    lines: boolean,
    hiddenLines: boolean,
  ): void {
    const side = backfaces ? DoubleSide : FrontSide;
    // flat/wireframe force one global override material; PBR resolves each mesh's
    // assigned library material (or the default). wireframe = hidden surface
    // (still raycastable for picking) + edges.
    const override = mode === "flat" ? FLAT_MAT : mode === "wireframe" ? HIDDEN_MAT : null;
    if (override) override.side = side;
    for (const [id, obj] of this.objects) {
      // Line2 splines extend Mesh — never clobber their wide-line material
      if (!(obj instanceof Mesh) || obj.userData.outline || obj.userData.spline) continue;
      if (override) {
        obj.material = override;
      } else {
        const data = this.doc.scene.get(id)?.data;
        const matId = data?.material as Uuid | undefined;
        const planar = data?.planar as PlanarReflectionDTO | undefined;
        const m = planar
          ? this.materials.resolvePlanar(id, matId, planar, obj)
          : (this.materials.releasePlanar(id), this.materials.resolve(matId));
        m.side = side; // shared material: per-pane side is last-pane-wins (pre-existing)
        obj.material = m;
      }
    }
    const wireMode = mode === "wireframe";
    // depthTest off makes edges behind the surface show through. For the Lines
    // overlay that's opt-in (Hidden Lines); wireframe mode always shows all edges.
    LINES_EDGE_MAT.depthTest = !hiddenLines;
    // wireframe selection reads via wire COLOR (object mode): the silhouette
    // hull is hidden below — with the surface invisible, nothing paints over
    // the hull's interior and it would show as a solid fill on the selection
    const wireSelect = wireMode && this.doc.selection.editMode === "object";
    for (const [id, wire] of this.edgeWires) {
      wire.visible = wireMode || lines;
      wire.material = wireMode
        ? wireSelect && this.doc.selection.has(id)
          ? SELECTED_WIRE_MAT
          : WIRE_EDGE_MAT
        : LINES_EDGE_MAT;
    }
    this.selectionOutline.setVisible(!wireMode);
  }

  /** Resolve the node's geometry source (editable mesh or primitive) into its Mesh. */
  private syncGeometry(id: Uuid, node: SceneNode, obj: Mesh, preview = false): void {
    const source = this.geometrySource(node);
    if (!source) {
      // a generator whose input vanished (its spline/mesh child was moved out)
      // must render nothing — drop the stale mesh instead of freezing it
      if (node.kind === "generator") this.clearGeometry(id, obj);
      return;
    }
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
    // defer the BVH only for positions-only previews (component drags —
    // per-frame rebuilds would hitch). Key changes rebuild the geometry
    // anyway AND arrive preview-tagged from param scrubs, so deferring
    // there would leave picking stuck on the old shape.
    if (preview && !keyChanged) entry.bvhStale = true;
    else this.rebuildBvh(entry);
    const prevAttrs = attrSignature(obj.geometry);
    const prevEmpty = (obj.geometry?.attributes?.position?.count ?? 0) === 0;
    obj.geometry = rm.geometry;
    // A generator's geometry arrives ASYNC (a boolean's Manifold worker; a
    // rebuild on a structural change), so its mesh can be EMPTY when the
    // material's WebGPU pipeline first compiles against it. Once the real
    // geometry swaps in with a different attribute layout, that pipeline is
    // stale and the mesh silently fails to draw — even for the default
    // MeshStandardMaterial (not just uv-sampling image/noise materials). This
    // is why re-assigning a material "un-hides" the mesh: it forces a rebuild.
    // Recompiling against the new layout fixes it; gate on the attribute SET
    // changing so param scrubs (same attributes, new positions) don't thrash.
    const nowAttrs = attrSignature(rm.geometry);
    if (prevAttrs !== nowAttrs) this.refreshMeshMaterial(obj);
    // Geometry that just went from empty→real (a generator's async worker
    // result on load) — OR whose attribute set changed — needs a fresh WebGPU
    // pipeline variant, which compiles in the background and can miss the next
    // on-demand frame. Ask the viewport to hold rendering briefly so the mesh
    // draws once its pipeline is ready, regardless of material type.
    if (prevAttrs !== nowAttrs || (prevEmpty && (rm.geometry.attributes.position?.count ?? 0) > 0))
      this.onDirty(true);
    this.selectionOutline.updateGeometry(id, rm.geometry);
    this.rebuildEdgeWire(id, source.mesh);
  }

  /** Force the mesh's material(s) to recompile their pipeline against current geometry. */
  private refreshMeshMaterial(obj: Mesh): void {
    const mat = obj.material;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      // WebGPU caches each material's render pipeline against the geometry's
      // attribute layout. When a generator's async geometry swaps in over the
      // empty placeholder (boolean worker result on load), that cached pipeline
      // is stale and the mesh silently stops drawing until a material change
      // rebuilds it. Bump needsUpdate to force the rebuild — for the DEFAULT
      // MeshStandardMaterial too, not only node materials: a no-material boolean
      // vanished on reload precisely because the standard material was skipped.
      if (m) m.needsUpdate = true;
    }
  }

  /** Drop a node's render geometry (generator input removed → renders empty). */
  private clearGeometry(id: Uuid, obj: Mesh): void {
    // an attribute-less geometry still makes WebGPU build a pipeline that fails
    // validation (the material's shader expects normal/uv slots), which aborts
    // the whole frame — hide the object rather than submit empty geometry.
    // updateNode restores visibility when the generator gets an input again.
    obj.visible = false;
    const entry = this.renderMeshes.get(id);
    if (!entry) return; // geometry never built (fresh childless generator)
    entry.rm.dispose();
    this.renderMeshes.delete(id);
    obj.geometry = new BufferGeometry();
    this.selectionOutline.updateGeometry(id, obj.geometry);
    const wire = this.edgeWires.get(id);
    if (wire) {
      wire.geometry.dispose();
      wire.geometry = new BufferGeometry();
    }
  }

  /** Kernel-edge line buffer for a mesh node (local coords — child of the mesh). */
  private rebuildEdgeWire(id: Uuid, mesh: HEMesh): void {
    const wire = this.edgeWires.get(id);
    if (!wire) return;
    const edges = uniqueEdges(mesh);
    const positions = new Float32Array(edges.length * 6);
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edgeVerts(mesh, edges[i]!);
      positions[i * 6] = mesh.vPos[a * 3]!;
      positions[i * 6 + 1] = mesh.vPos[a * 3 + 1]!;
      positions[i * 6 + 2] = mesh.vPos[a * 3 + 2]!;
      positions[i * 6 + 3] = mesh.vPos[b * 3]!;
      positions[i * 6 + 4] = mesh.vPos[b * 3 + 1]!;
      positions[i * 6 + 5] = mesh.vPos[b * 3 + 2]!;
    }
    wire.geometry.dispose();
    wire.geometry = new BufferGeometry();
    wire.geometry.setAttribute("position", new BufferAttribute(positions, 3));
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
    // a converted (made-editable) generator has plain mesh data — falls through
    if (node.kind === "generator" && node.data?.generator) {
      return evaluateGenerator(this.doc, node);
    }
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
    // kernel-edge wire child registered BEFORE the first geometry sync fills it
    const wire = new LineSegments(new BufferGeometry(), LINES_EDGE_MAT);
    wire.raycast = () => {}; // never pickable
    wire.frustumCulled = false; // WebGPU mis-culls Line objects (see helpers)
    wire.visible = false;
    wire.renderOrder = 2; // above the surface, below component overlays/gizmo
    mesh.add(wire);
    this.edgeWires.set(node.id, wire);
    this.syncGeometry(node.id, node, mesh);
    if (node.kind === "mesh" && !mesh.geometry.getAttribute("position")) {
      // mesh node without geometry data: fall back to a unit cube
      // (generators legitimately render nothing until they have an input)
      const rm = new RenderMesh();
      const fallback = buildPrimitive({ type: "cube", params: { width: 1, height: 1, depth: 1 } });
      rm.sync(fallback);
      mesh.geometry = rm.geometry;
      this.renderMeshes.set(node.id, { key: "fallback", rm, bvhStale: false });
      this.rebuildEdgeWire(node.id, fallback);
    }
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
    this.lights.updateBillboards(camera, viewportHeightPx, this.objects);
  }
}
