import {
  AmbientLight,
  type Camera,
  Color,
  DirectionalLight,
  type Group,
  HemisphereLight,
  Light,
  Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  PointLight,
  RectAreaLight,
  SpotLight,
  Vector3,
} from "three";
import type { Uuid } from "@/types/core";
import { defaultLightData, type LightDataDTO, SHADOW_RESOLUTION_PX } from "@/types/core/light";
import type { SceneNode } from "@/core";
import {
  buildBillboardCircle,
  buildOrientedLightHelper,
  isBillboardLightType,
  updateBillboardHelper,
} from "@/render/helpers/LightHelpers";
import { HELPER_LAYER } from "@/render/layers";

/**
 * True when the light's live shadow-map size no longer matches the requested
 * resolution — the one shadow setting three's WebGPU backend can't apply in
 * place (see LightSync.update: the light gets rebuilt so the map render target
 * is reallocated at the new size).
 */
function shadowResolutionChanged(light: Light, data: LightDataDTO): boolean {
  if (
    !(
      light instanceof SpotLight ||
      light instanceof PointLight ||
      light instanceof DirectionalLight
    )
  ) {
    return false;
  }
  return light.shadow.mapSize.x !== SHADOW_RESOLUTION_PX[data.shadowResolution ?? "normal"];
}

/**
 * Push a light's shadow-quality settings (resolution / blur / frustum size)
 * onto its three.js shadow. normalBias fixes self-shadow acne; a tight frustum
 * keeps depth precision high. Called from build + update so edits are live.
 */
function applyShadowSettings(light: Light, data: LightDataDTO): void {
  if (
    !(
      light instanceof SpotLight ||
      light instanceof PointLight ||
      light instanceof DirectionalLight
    )
  ) {
    return;
  }
  light.castShadow = data.castShadow ?? true;
  const px = SHADOW_RESOLUTION_PX[data.shadowResolution ?? "normal"];
  // Resolution: only ever set here on a fresh light (buildLightObject) — a live
  // resolution change rebuilds the whole light instead (see LightSync.update),
  // because three's WebGPU backend won't resize an existing shadow map in place.
  // So no dispose/realloc dance is needed (and that dance is what produced the
  // "Destroyed texture used in a submit" warning).
  light.shadow.mapSize.set(px, px);
  light.shadow.radius = Math.max(0, data.shadowBlur ?? 4);
  const size = Math.max(1, data.shadowSize ?? (light instanceof DirectionalLight ? 20 : 60));
  // World-space footprint of ONE shadow-map texel on a mid-frustum receiver.
  // The acne bias must scale with it: a fixed normalBias tuned for the default
  // cone/resolution collapses once the texel outgrows it (wide spot angle —
  // fov is 2·angle, so tan explodes past ~1 rad — or a low-res map), painting
  // the texel grid onto every surface as terraced bands / "voxel" crosshatch.
  let texel: number;
  if (light instanceof DirectionalLight) {
    const c = light.shadow.camera as OrthographicCamera;
    c.left = -size;
    c.right = size;
    c.top = size;
    c.bottom = -size;
    c.near = 0.5;
    c.far = Math.max(size * 4, 80);
    c.updateProjectionMatrix();
    texel = (2 * size) / px;
  } else {
    const c = light.shadow.camera as PerspectiveCamera;
    c.near = 0.5;
    c.far = size;
    c.updateProjectionMatrix();
    // spot: the shadow camera's half-fov IS the cone angle (clamped short of
    // π/2, where tan → ∞ and no single map can help); point: six 90° faces.
    const halfFov = light instanceof SpotLight ? Math.min(light.angle, 1.35) : Math.PI / 4;
    texel = (2 * Math.tan(halfFov) * (size / 2)) / px;
  }
  light.shadow.bias = -0.00005;
  // ~1.5 texels of offset along the normal clears the acne. Floor at the old
  // hand-tuned 0.03 so every currently-clean case renders exactly as before;
  // cap so an extreme cone can't push shadows visibly off their contact points.
  light.shadow.normalBias = Math.min(Math.max(0.03, 1.5 * texel), 0.5);
}

/**
 * Light-node projection for the SceneSynchronizer: builds/updates the three
 * Light objects, their oriented helpers (spot cone / area rect / infinite
 * line — children, so they follow rotation), the billboarded circles for
 * non-oriented types, and the auto-target plumbing that makes untargeted
 * spot/directional lights follow their node's own rotation.
 */
export class LightSync {
  private billboards = new Map<Uuid, Object3D>();
  private count = 0;
  private readonly root: Group;

  constructor(root: Group) {
    this.root = root;
  }

  /** True once at least one light exists — viewport disables its default rig. */
  get hasLights(): boolean {
    return this.count > 0;
  }

  clear(): void {
    this.billboards.clear(); // root.clear() already detached the objects
    this.count = 0;
  }

  build(node: SceneNode): Light {
    this.count++;
    return this.buildLightObject(node);
  }

  onNodeAdded(id: Uuid, node: SceneNode): void {
    const data = (node.data?.light as LightDataDTO | undefined) ?? defaultLightData("point");
    this.refreshBillboard(id, data);
  }

  onNodeRemoved(id: Uuid, obj: Object3D): void {
    if (obj instanceof Light) this.count--;
    const billboard = this.billboards.get(id);
    if (billboard) {
      billboard.removeFromParent();
      this.billboards.delete(id);
    }
  }

  /** Apply light payload changes in place; returns the (possibly rebuilt) object. */
  update(node: SceneNode, obj: Object3D): Object3D {
    const data = node.data?.light as LightDataDTO | undefined;
    if (!data || !(obj instanceof Light)) return obj;
    if (obj.userData.lightType !== data.type || shadowResolutionChanged(obj, data)) {
      // type OR shadow resolution changed: rebuild the light, keeping real
      // children + hierarchy position (the stale oriented helper is dropped —
      // buildLightObject attaches a fresh one). Resolution needs a rebuild
      // because three's WebGPU shadow node won't resize its map render target
      // in place — only a fresh light allocates it at the new size (matching
      // what toggling the light's visibility does by hand). Frustum size and
      // blur DO apply live, so they stay in the in-place path below.
      const fresh = this.buildLightObject(node);
      fresh.name = node.name;
      fresh.userData.nodeId = node.id;
      for (const child of [...obj.children]) {
        if (!child.userData.orientedHelper) fresh.add(child);
      }
      obj.parent?.add(fresh);
      obj.removeFromParent();
      this.refreshBillboard(node.id, data);
      return fresh;
    }
    obj.color = new Color(data.color);
    obj.intensity = data.intensity;
    if (obj instanceof SpotLight) {
      obj.angle = data.angle ?? obj.angle;
      obj.penumbra = data.penumbra ?? obj.penumbra;
    }
    applyShadowSettings(obj, data);
    if (obj instanceof HemisphereLight && data.groundColor) {
      obj.groundColor = new Color(data.groundColor);
    }
    if (obj instanceof RectAreaLight) {
      obj.width = data.width ?? obj.width;
      obj.height = data.height ?? obj.height;
    }
    this.attachHelper(obj, data);
    this.refreshBillboard(node.id, data);
    return obj;
  }

  /** Face + resize the billboarded light circles for this pane's camera. */
  updateBillboards(
    camera: Camera,
    viewportHeightPx: number,
    objects: ReadonlyMap<Uuid, Object3D>,
  ): void {
    if (this.billboards.size === 0 || viewportHeightPx <= 0) return;
    const pos = new Vector3();
    for (const [id, billboard] of this.billboards) {
      const light = objects.get(id);
      if (!light) continue;
      light.getWorldPosition(pos);
      billboard.position.copy(pos);
      updateBillboardHelper(billboard, camera, viewportHeightPx);
    }
  }

  private buildLightObject(node: SceneNode): Light {
    const data = (node.data?.light as LightDataDTO | undefined) ?? defaultLightData("point");
    let light: Light;
    switch (data.type) {
      case "spot":
        light = new SpotLight(data.color, data.intensity, 0, data.angle, data.penumbra);
        break;
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
      case "area":
        light = new RectAreaLight(data.color, data.intensity, data.width ?? 2, data.height ?? 2);
        break;
    }
    applyShadowSettings(light, data);
    if (light instanceof SpotLight) {
      // match the shadow camera fov to the cone so the map isn't mostly wasted
      light.shadow.focus = 1;
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
    this.attachHelper(light, data);
    return light;
  }

  /** Cone (spot) / rect (area) / line (infinite) visualizer as a child. */
  private attachHelper(light: Light, data: LightDataDTO): void {
    const existing = light.children.find((c) => c.userData.orientedHelper);
    if (existing) light.remove(existing);
    const helper = buildOrientedLightHelper(data);
    if (helper) {
      helper.userData.orientedHelper = true;
      // helper layer: excluded from SSR / planar-mirror reflections. Only the
      // VISUAL moves — the Light itself must stay on layer 0 (a light only
      // illuminates when its layer matches the rendering camera's mask).
      helper.traverse((o) => o.layers.set(HELPER_LAYER));
      light.add(helper);
    }
  }

  /** Billboarded circle for non-oriented types; lives at the root, not the light. */
  private refreshBillboard(id: Uuid, data: LightDataDTO): void {
    const existing = this.billboards.get(id);
    if (existing) {
      existing.removeFromParent();
      this.billboards.delete(id);
    }
    if (isBillboardLightType(data.type)) {
      const circle = buildBillboardCircle();
      circle.traverse((o) => o.layers.set(HELPER_LAYER)); // not reflected
      this.root.add(circle);
      this.billboards.set(id, circle);
    }
  }
}
