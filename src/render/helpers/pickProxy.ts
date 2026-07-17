import { Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import { PICK_LAYER } from "@/render/layers";

/**
 * Invisible pickable proxy for click-selecting lights and cameras.
 *
 * A bare `THREE.Light` has no geometry and a camera object is a bare `Group`,
 * so the viewport raycast never hits them and they can't be selected. This
 * proxy is a small sphere added as a CHILD of the light/camera object — the
 * raycast hit then resolves to the node id via `SceneSynchronizer.nodeIdOf`,
 * which walks up to the parent's `userData.nodeId`.
 *
 * It lives on {@link PICK_LAYER}, which no camera renders (so it's never drawn),
 * while the picking raycaster's `layers.enableAll()` still tests it. `visible`
 * can't be used to hide it — three's raycast skips `visible === false` objects.
 *
 * The radius (~0.35 world units) roughly matches the billboard light circle at
 * the default view distance; a fixed size is fine for v1 (not screen-constant).
 */
const PROXY_GEO = /*@__PURE__*/ new SphereGeometry(0.35, 12, 8);
const PROXY_MAT = /*@__PURE__*/ new MeshBasicMaterial();

export function buildPickProxy(): Mesh {
  const proxy = new Mesh(PROXY_GEO, PROXY_MAT);
  proxy.layers.set(PICK_LAYER);
  proxy.frustumCulled = false;
  proxy.userData.pickProxy = true;
  return proxy;
}
