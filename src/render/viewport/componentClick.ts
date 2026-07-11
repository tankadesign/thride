import { Mesh } from "three";
import type { ComponentMode, Uuid } from "@/types/core";
import { Bitset } from "@/core/selection/Bitset";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { pickComponent } from "@/render/picking/componentPicking";
import type { ViewportSystem } from "./ViewportSystem";

/**
 * Click-select components of the ACTIVE editable mesh (shift add, mod
 * toggle). Split from ViewportInput for the 500-line rule.
 */
export function componentClick(
  vs: ViewportSystem,
  e: PointerEvent,
  pane: number,
  mode: ComponentMode,
): void {
  const doc = vs.doc;
  const active = doc.selection.active;
  if (!active || !doc.scene.has(active)) return;
  const meshRef = doc.scene.mustGet(active).data?.mesh as { id: Uuid } | undefined;
  const mesh = meshRef ? meshRegistry.get(meshRef.id) : undefined;
  const obj = vs.sync.object(active);
  if (!mesh || !(obj instanceof Mesh)) return; // nothing editable under this mode
  const rect = vs.canvas.getBoundingClientRect();
  const hit = pickComponent(mode, {
    mesh,
    meshObject: obj,
    camera: vs.rigFor(pane).camera,
    pane: vs.paneRect(pane),
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    raycaster: vs.raycaster,
    triFace: vs.sync.renderInfoFor(active)?.triFace ?? null,
  });
  const op = e.shiftKey ? "add" : e.metaKey || e.ctrlKey ? "toggle" : "replace";
  if (hit === null) {
    // clear only THIS mode's selection — other modes keep their memory
    if (op === "replace") doc.selection.clearComponents(active, mode);
    return;
  }
  const prev = doc.selection.componentsFor(active, mode);
  const valid = prev && prev.topologyVersion === mesh.topologyVersion;
  const bits = valid && op !== "replace" ? prev.bits.clone() : new Bitset();
  const order = valid && op !== "replace" ? [...prev.order] : [];
  if (op === "toggle" && bits.has(hit)) {
    bits.delete(hit);
    const i = order.indexOf(hit);
    if (i !== -1) order.splice(i, 1);
  } else if (!bits.has(hit)) {
    bits.add(hit);
    order.push(hit);
  }
  doc.selection.setComponents(active, {
    mode,
    bits,
    order,
    topologyVersion: mesh.topologyVersion,
  });
}
