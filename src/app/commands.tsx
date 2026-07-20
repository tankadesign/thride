import type { Document } from "@/core";
import { uniqueSiblingName } from "@/core";
import {
  CreateNodeCommand,
  RemoveNodeCommand,
  ReparentNodeCommand,
  SetFlagsCommand,
  SetNodeDataCommand,
  SetTransformCommand,
} from "@/core/history/commands/scene";
import { Box3, Euler, Matrix4, type Object3D, Quaternion, Vector3 } from "three";
import { ConvertToMeshCommand } from "@/geometry/commands/convert";
import {
  ConvertClonerToObjectsCommand,
  MAX_CONVERT_INSTANCES,
} from "@/generators/commands/convertToObjects";
import { MeshTopologyCommand } from "@/geometry/commands/topology";
import { HEMesh } from "@/geometry/kernel/HEMesh";
import { facesForSelection } from "@/geometry/kernel/components";
import { deleteFaces } from "@/geometry/ops/faceOps";
import type { OpResult } from "@/geometry/ops/soup";
import { selectAll } from "@/geometry/selection/selectAll";
import { dissolveVertices } from "@/geometry/ops/weld";
import { splineStamp } from "@/geometry/splines/eval";
import { deletePoints as deleteSplinePoints } from "@/geometry/splines/ops";
import type { SplineData, SplinePrimitiveType } from "@/types/geometry/spline";
import { defaultSplinePrimitive } from "@/types/geometry/spline";
import { buildSplinePrimitive } from "@/geometry/splines/primitives";
import {
  booleanDescriptor,
  clonerDescriptor,
  evaluateGenerator,
  splineExtrudeDescriptor,
  sweepDescriptor,
} from "@/generators/graph";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import type { PrimitiveType } from "@/types/geometry/primitives";
import { defaultPrimitive, primitiveLabels } from "@/types/geometry/primitives";
import { defaultLightData, LIGHT_LABELS, type LightType } from "@/types/core/light";
import { defaultCameraData } from "@/types/core/camera";
import type { AppCommand } from "@/ui/commands/CommandRegistry";
import { createProject } from "@/ui/hooks/doc/projects";
import { openPalette } from "@/ui/hooks/editor/shell";
import { enterEditMode, toggleEditMode } from "@/ui/hooks/editor/keymap";
import { editorState } from "@/ui/hooks/editor/viewport";
import type { AmountKind } from "@/render/tools/AmountTool";
import type { GizmoMode } from "@/render/gizmo/TransformGizmo";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";
import type { ComponentMode, TransformDTO, Uuid } from "@/types/core";
import {
  IconAmbientLight,
  IconAreaLight,
  IconBevel,
  IconBoolean,
  IconCloner,
  IconCamera,
  IconCone,
  IconCube,
  IconCylinder,
  IconDelete,
  IconDirectionalLight,
  IconCircle,
  IconCursor,
  IconDisc,
  IconEdge,
  IconGroup,
  IconHelix,
  IconLine,
  IconNSide,
  IconPivotPoint,
  IconStar,
  IconDissolve,
  IconExtrude,
  IconHemisphereLight,
  IconIcosphere,
  IconInset,
  IconNull,
  IconPen,
  IconPlane,
  IconPoint,
  IconPointLight,
  IconPolygon,
  IconPyramid,
  IconSettings,
  IconSphere,
  IconSpotlight,
  IconSweep,
  IconTorus,
  IconCapsule,
  IconWeld,
} from "@/icons";

const PRIMITIVE_ICONS: Partial<Record<PrimitiveType, React.ReactNode>> = {
  cube: <IconCube size={16} />,
  sphere: <IconSphere size={16} />,
  icosphere: <IconIcosphere size={16} />,
  cylinder: <IconCylinder size={16} />,
  cone: <IconCone size={16} />,
  torus: <IconTorus size={16} />,
  plane: <IconPlane size={16} />,
  pyramid: <IconPyramid size={16} />,
  disc: <IconDisc size={16} />,
  capsule: <IconCapsule size={16} />,
};

const LIGHT_ICONS: Record<LightType, React.ReactNode> = {
  spot: <IconSpotlight size={16} />,
  point: <IconPointLight size={16} />,
  directional: <IconDirectionalLight size={16} />,
  ambient: <IconAmbientLight size={16} />,
  hemisphere: <IconHemisphereLight size={16} />,
  area: <IconAreaLight size={16} />,
};

const LIGHT_TYPES: LightType[] = ["spot", "point", "directional", "ambient", "hemisphere", "area"];

export interface ShellApi {
  getViewport: () => ViewportSystem | null;
  openGallery: () => void;
  openNoiseGallery: () => void;
  openMaterials: () => void;
  openEnvironment: () => void;
  openKeyboardShortcuts: () => void;
  resetLayout: () => void;
}

/** Gizmo mode commands share one shape (set the transform gizmo + redraw). */
const GIZMO_MODES: { id: string; title: string; mode: GizmoMode }[] = [
  { id: "gizmo.translate", title: "Move Gizmo", mode: "translate" },
  { id: "gizmo.rotate", title: "Rotate Gizmo", mode: "rotate" },
  { id: "gizmo.scale", title: "Scale Gizmo", mode: "scale" },
  { id: "gizmo.all", title: "Multi Gizmo", mode: "all" },
];

/** Edit-mode switch commands (Object/Point/Edge/Polygon). */
const EDIT_MODES: {
  id: string;
  title: string;
  mode: "object" | ComponentMode;
  icon: React.ReactNode;
}[] = [
  { id: "mode.object", title: "Object Mode", mode: "object", icon: <IconCursor size={16} /> },
  { id: "mode.point", title: "Point Mode", mode: "point", icon: <IconPoint size={16} /> },
  { id: "mode.edge", title: "Edge Mode", mode: "edge", icon: <IconEdge size={16} /> },
  { id: "mode.polygon", title: "Polygon Mode", mode: "polygon", icon: <IconPolygon size={16} /> },
];

// icosphere is folded into sphere (Icosa toggle); the legacy type still loads
const PRIMITIVES: PrimitiveType[] = [
  "cube",
  "sphere",
  "cylinder",
  "cone",
  "capsule",
  "torus",
  "plane",
  "disc",
  "pyramid",
];

/** A node Ungroup applies to: a null (group) that actually has children. */
function ungroupable(doc: Document, id: Uuid): boolean {
  const n = doc.scene.get(id);
  return n?.kind === "null" && doc.scene.childrenOf(id).length > 0;
}

/**
 * A node Center Axis applies to: anything whose own geometry can be shifted
 * against the moved axis — nulls and generators (no own baked points; children
 * compensate), editable meshes (points offset), hand-drawn splines (points
 * offset). Parametric primitives regenerate about their origin, so their axis
 * can't move without converting first (C4D draws the same line).
 */
function centerable(doc: Document, id: Uuid): boolean {
  const n = doc.scene.get(id);
  if (!n) return false;
  if (n.kind === "null" || n.kind === "generator") return true;
  if (n.data?.mesh !== undefined) return true;
  if (n.kind === "spline")
    return n.data?.spline !== undefined && n.data?.splinePrimitive === undefined;
  return false;
}

/**
 * Union of world-space bounds over the VISIBLE geometry in a render subtree —
 * the "perceived" bounding box. Skips hidden subtrees (a boolean's consumed
 * inputs) and helper-layer visuals (light cones, outlines — not on layer 0).
 */
function visibleWorldBox(root: Object3D, box = new Box3()): Box3 {
  if (!root.visible) return box;
  const geom = (root as { geometry?: { computeBoundingBox(): void; boundingBox: Box3 | null } })
    .geometry;
  if (geom && root.layers.isEnabled(0)) {
    if (!geom.boundingBox) geom.computeBoundingBox();
    if (geom.boundingBox && !geom.boundingBox.isEmpty()) {
      box.union(geom.boundingBox.clone().applyMatrix4(root.matrixWorld));
    }
  }
  for (const c of root.children) visibleWorldBox(c, box);
  return box;
}

/**
 * parent ∘ child as one local TRS — the child's new local transform after its
 * parent is removed from the chain. Rotation+non-uniform-scale composition can
 * shear, which TRS can't hold; Matrix4.decompose's nearest-TRS is the standard
 * approximation (same one reparenting DCCs use).
 */
function composeTransforms(parent: TransformDTO, child: TransformDTO): TransformDTO {
  const m = (t: TransformDTO) =>
    new Matrix4().compose(
      new Vector3(...t.position),
      new Quaternion().setFromEuler(new Euler(t.rotation[0], t.rotation[1], t.rotation[2], "XYZ")),
      new Vector3(...t.scale),
    );
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  m(parent).multiply(m(child)).decompose(p, q, s);
  const e = new Euler().setFromQuaternion(q, "XYZ");
  return { position: [p.x, p.y, p.z], rotation: [e.x, e.y, e.z], scale: [s.x, s.y, s.z] };
}

export function buildCommands(doc: Document, shell: ShellApi): AppCommand[] {
  const createPrimitive = (type: PrimitiveType) => {
    const name = uniqueSiblingName(doc, null, primitiveLabels[type]);
    const cmd = new CreateNodeCommand("mesh", name, null, undefined, {
      primitive: defaultPrimitive(type),
    });
    doc.history.run(cmd);
    doc.selection.selectObjects([cmd.nodeId]);
  };

  const createSplinePrimitive = (type: SplinePrimitiveType, label: string) => {
    const prim = defaultSplinePrimitive(type);
    const cmd = new CreateNodeCommand(
      "spline",
      uniqueSiblingName(doc, null, label),
      null,
      undefined,
      {
        spline: buildSplinePrimitive(prim),
        splinePrimitive: prim,
      },
    );
    doc.history.run(cmd);
    doc.selection.selectObjects([cmd.nodeId]);
  };

  const createLight = (type: LightType) => {
    const name = uniqueSiblingName(doc, null, LIGHT_LABELS[type]);
    if (type === "directional") {
      // an Infinite light gets its aim target created alongside it
      let lightId: Uuid | null = null;
      doc.history.transact("Create Infinite Light", () => {
        const targetName = uniqueSiblingName(doc, null, "Directional Light Target");
        const target = new CreateNodeCommand("null", targetName);
        doc.history.run(target);
        const light = new CreateNodeCommand("light", name, null, undefined, {
          light: defaultLightData(type),
          target: target.nodeId,
        });
        doc.history.run(light);
        lightId = light.nodeId;
      });
      if (lightId) doc.selection.selectObjects([lightId]);
      return;
    }
    const cmd = new CreateNodeCommand("light", name, null, undefined, {
      light: defaultLightData(type),
    });
    doc.history.run(cmd);
    doc.selection.selectObjects([cmd.nodeId]);
  };

  /** top-most selected nodes only (skip ones whose ancestor is also selected) */
  const topmostSelection = () =>
    doc.selection.objectIds.filter(
      (id) =>
        doc.scene.has(id) &&
        !doc.selection.objectIds.some(
          (other) => other !== id && doc.scene.isAncestorOrSelf(other, id),
        ),
    );

  /** Active SPLINE node + its live point selection (spline point ops). */
  const splinePointTarget = () => {
    const active = doc.selection.active;
    if (!active || !doc.scene.has(active)) return null;
    const node = doc.scene.mustGet(active);
    if (node.kind !== "spline") return null;
    const data = node.data?.spline as SplineData | undefined;
    if (!data) return null;
    const sel = doc.selection.componentsFor(active, "point");
    if (!sel || sel.topologyVersion !== splineStamp(data) || sel.bits.count === 0) return null;
    return { nodeId: active, nodeData: node.data, data, sel: sel.bits.toArray() };
  };

  /** Active editable mesh + its live component selection for `mode` (topology ops). */
  const componentTarget = (mode: ComponentMode) => {
    const active = doc.selection.active;
    if (!active || !doc.scene.has(active)) return null;
    const meshRef = doc.scene.mustGet(active).data?.mesh as { id: Uuid } | undefined;
    const mesh = meshRef ? meshRegistry.get(meshRef.id) : undefined;
    if (!meshRef || !mesh) return null;
    const sel = doc.selection.componentsFor(active, mode);
    if (!sel || sel.topologyVersion !== mesh.topologyVersion || sel.bits.count === 0) return null;
    return { nodeId: active, meshId: meshRef.id, mesh, ids: sel.bits.toArray() };
  };

  const runTopologyOp = (
    mode: ComponentMode,
    label: string,
    op: (mesh: HEMesh, ids: number[]) => OpResult | null,
  ) => {
    const target = componentTarget(mode);
    if (!target) return;
    doc.history.run(
      new MeshTopologyCommand(target.nodeId, target.meshId, label, (m) => op(m, target.ids)),
    );
  };

  return [
    // ---- File ----
    {
      id: "file.new",
      title: "New Project",
      menu: "File",
      run: () => {
        // opens a fresh project as a new workspace tab (multi-project)
        void createProject();
      },
    },

    // ---- Edit ----
    {
      id: "edit.undo",
      title: "Undo",
      menu: "Edit",
      enabled: () => doc.history.canUndo,
      run: () => doc.history.undo(),
    },
    {
      id: "edit.redo",
      title: "Redo",
      menu: "Edit",
      enabled: () => doc.history.canRedo,
      run: () => doc.history.redo(),
    },
    {
      id: "edit.delete",
      title: "Delete",
      menu: "Edit",
      icon: <IconDelete size={16} />,
      sep: true,
      enabled: () => {
        const mode = doc.selection.editMode;
        if (mode === "point" && splinePointTarget() !== null) return true;
        if (mode === "point" || mode === "edge" || mode === "polygon") {
          return componentTarget(mode) !== null;
        }
        return doc.selection.objectIds.length > 0;
      },
      run: () => {
        // component modes delete the touched faces; object mode deletes nodes
        const mode = doc.selection.editMode;
        // spline points delete via spline ops (drop the node below 2 points)
        if (mode === "point") {
          const st = splinePointTarget();
          if (st) {
            const remaining = st.data.points.length - st.sel.length;
            if (remaining < 2) {
              doc.history.run(new RemoveNodeCommand(st.nodeId));
              return;
            }
            const after = deleteSplinePoints(st.data, st.sel);
            doc.history.run(
              new SetNodeDataCommand(
                st.nodeId,
                { ...st.nodeData, spline: after },
                { ...st.nodeData, spline: st.data },
                "Delete Points",
                false,
              ),
            );
            return;
          }
        }
        if (mode === "point" || mode === "edge" || mode === "polygon") {
          const target = componentTarget(mode);
          if (!target) return;
          const sel = doc.selection.componentsFor(target.nodeId, mode)!;
          const faces = facesForSelection(target.mesh, mode, sel.bits);
          doc.history.run(
            new MeshTopologyCommand(target.nodeId, target.meshId, "Delete Components", (m) =>
              deleteFaces(m, faces),
            ),
          );
          return;
        }
        const ids = topmostSelection();
        if (ids.length === 0) return;
        doc.history.transact("Delete", () => {
          for (const id of ids) doc.history.run(new RemoveNodeCommand(id));
        });
      },
    },
    {
      id: "edit.group",
      title: "Group Objects",
      menu: "Edit",
      icon: <IconGroup size={16} />,
      enabled: () => doc.selection.objectIds.length > 0,
      run: () => {
        const ids = topmostSelection();
        if (ids.length === 0) return;
        let groupId: Uuid | null = null;
        doc.history.transact("Group Objects", () => {
          const create = new CreateNodeCommand("null", uniqueSiblingName(doc, null, "Group"));
          doc.history.run(create);
          groupId = create.nodeId;
          for (const id of ids) doc.history.run(new ReparentNodeCommand(id, groupId));
        });
        if (groupId) doc.selection.selectObjects([groupId]);
      },
    },
    {
      id: "edit.ungroup",
      title: "Ungroup Objects",
      menu: "Edit",
      icon: <IconGroup size={16} />,
      enabled: () => doc.selection.objectIds.some((id) => ungroupable(doc, id)),
      run: () => {
        const groups = doc.selection.objectIds.filter((id) => ungroupable(doc, id));
        if (groups.length === 0) return;
        const freed: Uuid[] = [];
        doc.history.transact("Ungroup Objects", () => {
          for (const gid of groups) {
            const g = doc.scene.mustGet(gid);
            const parent = g.parent;
            // children land at the group's own sibling slot, keeping tree order
            let index = doc.scene.childrenOf(parent).indexOf(gid);
            const groupT = g.transform;
            for (const cid of [...doc.scene.childrenOf(gid)]) {
              // bake the group's transform into the child so its WORLD placement
              // survives the reparent (reparenting alone keeps local transforms)
              const t = composeTransforms(groupT, doc.scene.mustGet(cid).transform);
              doc.history.run(new SetTransformCommand(cid, t));
              doc.history.run(new ReparentNodeCommand(cid, parent, index++));
              freed.push(cid);
            }
            doc.history.run(new RemoveNodeCommand(gid));
          }
        });
        doc.selection.selectObjects(freed);
      },
    },
    {
      id: "edit.centerAxis",
      title: "Center Axis",
      menu: "Edit",
      icon: <IconPivotPoint size={16} />,
      enabled: () => doc.selection.objectIds.some((id) => centerable(doc, id)),
      run: () => {
        const vs = shell.getViewport();
        if (!vs) return;
        const targets = doc.selection.objectIds.filter((id) => centerable(doc, id));
        if (targets.length === 0) return;
        doc.history.transact("Center Axis", () => {
          for (const id of targets) {
            const obj = vs.sync.object(id);
            if (!obj) continue;
            obj.updateWorldMatrix(true, true); // ancestors + subtree current
            const box = visibleWorldBox(obj);
            if (box.isEmpty()) continue;
            const cWorld = box.getCenter(new Vector3());
            // the new axis position, expressed in the PARENT's space (where
            // node.transform.position lives)
            const cParent = obj.parent
              ? cWorld.clone().applyMatrix4(new Matrix4().copy(obj.parent.matrixWorld).invert())
              : cWorld.clone();
            const t = doc.scene.mustGet(id).transform;
            const p0 = new Vector3(t.position[0], t.position[1], t.position[2]);
            if (p0.distanceToSquared(cParent) < 1e-12) continue;
            // counter-shift for everything the axis carries, in the node's own
            // LOCAL space: o = S⁻¹ R⁻¹ (p0 − c). Applying it to children and
            // baked points keeps every world position exactly where it was —
            // only the axis moves (rotation/scale untouched, as requested).
            const q = new Quaternion().setFromEuler(
              new Euler(t.rotation[0], t.rotation[1], t.rotation[2], "XYZ"),
            );
            const o = p0.clone().sub(cParent).applyQuaternion(q.invert());
            o.set(o.x / (t.scale[0] || 1), o.y / (t.scale[1] || 1), o.z / (t.scale[2] || 1));
            doc.history.run(
              new SetTransformCommand(id, {
                position: [cParent.x, cParent.y, cParent.z],
                rotation: [...t.rotation],
                scale: [...t.scale],
              }),
            );
            for (const cid of doc.scene.childrenOf(id)) {
              const ct = doc.scene.mustGet(cid).transform;
              doc.history.run(
                new SetTransformCommand(cid, {
                  position: [ct.position[0] + o.x, ct.position[1] + o.y, ct.position[2] + o.z],
                  rotation: [...ct.rotation],
                  scale: [...ct.scale],
                }),
              );
            }
            const node = doc.scene.mustGet(id);
            const meshRef = node.data?.mesh as { id: Uuid } | undefined;
            if (meshRef) {
              doc.history.run(
                new MeshTopologyCommand(id, meshRef.id, "Center Axis", (m) => {
                  for (let v = 0; v < m.vCount; v++) {
                    m.setPosition(
                      v,
                      m.vPos[v * 3]! + o.x,
                      m.vPos[v * 3 + 1]! + o.y,
                      m.vPos[v * 3 + 2]! + o.z,
                    );
                  }
                  return { mode: "point", ids: [] };
                }),
              );
            }
            const spline = node.data?.spline as SplineData | undefined;
            if (spline) {
              const moved: SplineData = {
                ...spline,
                // handles are point-relative — translating positions is enough
                points: spline.points.map((p) => ({
                  ...p,
                  position: [p.position[0] + o.x, p.position[1] + o.y, p.position[2] + o.z],
                })),
              };
              doc.history.run(
                new SetNodeDataCommand(
                  id,
                  { ...structuredClone(node.data ?? {}), spline: moved },
                  structuredClone(node.data ?? {}),
                  "Center Axis",
                ),
              );
            }
          }
        });
      },
    },
    {
      id: "edit.convertToMesh",
      title: "Convert to Mesh",
      // Instancers bake to a group of real objects; everything else to a mesh.
      // The label swaps when only Instancers are selected.
      dynamicTitle: () => {
        const sel = doc.selection.objectIds;
        const hasCloner = sel.some((id) => ConvertClonerToObjectsCommand.eligible(doc, id));
        const hasOther = sel.some(
          (id) =>
            !ConvertClonerToObjectsCommand.eligible(doc, id) &&
            (ConvertToMeshCommand.eligible(doc, id) ||
              doc.scene.get(id)?.data?.generator !== undefined),
        );
        return hasCloner && !hasOther ? "Convert to Objects" : "Convert to Mesh";
      },
      menu: "Edit",
      enabled: () =>
        doc.selection.objectIds.some(
          (id) =>
            ConvertToMeshCommand.eligible(doc, id) ||
            doc.scene.get(id)?.data?.generator !== undefined,
        ),
      run: () => {
        const sel = doc.selection.objectIds;
        const cloners = sel.filter((id) => ConvertClonerToObjectsCommand.eligible(doc, id));
        // primitives convert directly; non-Instancer generators bake their mesh
        const prims = sel.filter((id) => ConvertToMeshCommand.eligible(doc, id));
        const gens = sel.filter(
          (id) =>
            !ConvertClonerToObjectsCommand.eligible(doc, id) &&
            doc.scene.get(id)?.data?.generator !== undefined,
        );
        // guard: a huge Instancer would spawn a node per clone and hang the tree
        const okCloners = cloners.filter((id) => {
          const n = ConvertClonerToObjectsCommand.instanceCount(doc, id);
          if (n > MAX_CONVERT_INSTANCES) {
            window.alert(
              `"${doc.scene.get(id)?.name}" has ${n} clones — too many to convert to objects ` +
                `(limit ${MAX_CONVERT_INSTANCES}). Reduce the count first.`,
            );
            return false;
          }
          return n > 0;
        });
        if (prims.length === 0 && gens.length === 0 && okCloners.length === 0) return;
        doc.history.transact("Convert", () => {
          for (const id of prims) doc.history.run(new ConvertToMeshCommand(doc, id));
          for (const id of gens) {
            const result = evaluateGenerator(doc, doc.scene.mustGet(id));
            if (result) {
              // deep-copy: the registry takes ownership; the cache may rebuild
              const baked = HEMesh.fromSnapshot(result.mesh.snapshot());
              doc.history.run(new ConvertToMeshCommand(doc, id, baked));
            }
          }
          for (const id of okCloners) doc.history.run(new ConvertClonerToObjectsCommand(doc, id));
        });
      },
    },
    {
      id: "edit.selectAll",
      title: "Select All",
      menu: "Edit",
      sep: true,
      // Select All, scoped to the viewport (bound to A in the built-in presets):
      // object mode selects all nodes, component modes select all components.
      viewportScoped: true,
      run: () => selectAll(doc),
    },
    {
      id: "edit.deselect",
      title: "Deselect All",
      menu: "Edit",
      run: () => {
        // mirror Select All: component modes clear the active mode's components
        const mode = doc.selection.editMode;
        if (mode === "point" || mode === "edge" || mode === "polygon") {
          if (doc.selection.active) doc.selection.clearComponents(doc.selection.active, mode);
        } else {
          doc.selection.clearObjects();
        }
      },
    },

    // ---- Edit ▸ Mode (object / component modes; also driven by the ToolRail) ----
    ...EDIT_MODES.map(
      ({ id, title, mode, icon }): AppCommand => ({
        id,
        title,
        menu: "Edit",
        submenu: "Mode",
        icon,
        sep: id === "mode.object",
        run: () => enterEditMode(doc, mode),
      }),
    ),
    {
      // Blender-style Tab: flip between object mode and the last component mode
      id: "mode.toggleEdit",
      title: "Toggle Object / Edit Mode",
      menu: "Edit",
      submenu: "Mode",
      icon: <IconCursor size={16} />,
      run: () => toggleEditMode(doc),
    },

    // ---- Edit ▸ Gizmo (transform gizmo mode; was hardcoded E/R/T/V) ----
    ...GIZMO_MODES.map(
      ({ id, title, mode }): AppCommand => ({
        id,
        title,
        menu: "Edit",
        submenu: "Gizmo",
        // gate like the old bare-key handler: no mode switch mid-drag
        enabled: () => !(shell.getViewport()?.inputBusy ?? false),
        run: () => {
          const vs = shell.getViewport();
          vs?.gizmo.setMode(mode);
          vs?.invalidate();
        },
      }),
    ),

    // ---- Create ---- (grouped: Primitives ▸ / Splines ▸ / Generators ▸ /
    // Lights ▸, then Camera + Null. Same-submenu commands must stay CONSECUTIVE
    // — the MenuBar folds a run of them into one flyout.)
    ...PRIMITIVES.map(
      (type): AppCommand => ({
        id: `create.${type}`,
        title: primitiveLabels[type],
        menu: "Create",
        submenu: "Primitives",
        icon: PRIMITIVE_ICONS[type],
        run: () => createPrimitive(type),
      }),
    ),
    {
      // the Spline-style 3D pen: pick a work plane, then draw a bezier spline
      id: "spline.pen",
      title: "Pen (Spline)",
      menu: "Create",
      submenu: "Splines",
      icon: <IconPen size={16} />,
      run: () => shell.getViewport()?.penTool.toggle(),
    },
    // parametric curve primitives — spline nodes with a live `splinePrimitive`
    // recipe (attributes rebuild the points); feed extrude/sweep like any spline
    ...(
      [
        { type: "line", label: "Line", icon: <IconLine size={16} /> },
        { type: "circle", label: "Circle", icon: <IconCircle size={16} /> },
        { type: "nside", label: "N-Side", icon: <IconNSide size={16} /> },
        { type: "star", label: "Star", icon: <IconStar size={16} /> },
        { type: "helix", label: "Helix", icon: <IconHelix size={16} /> },
      ] as const
    ).map(
      ({ type, label, icon }): AppCommand => ({
        id: `create.spline.${type}`,
        title: label,
        menu: "Create",
        submenu: "Splines",
        icon,
        run: () => createSplinePrimitive(type, label),
      }),
    ),
    {
      // Spline's signature: child spline in, extruded mesh out (live sliders)
      id: "create.splineExtrude",
      title: "Spline Extrude",
      menu: "Create",
      submenu: "Generators",
      icon: <IconExtrude size={16} />,
      run: () => {
        const selectedSpline = doc.selection.objectIds.find(
          (id) => doc.scene.get(id)?.kind === "spline",
        );
        let genId: Uuid | null = null;
        doc.history.transact("Create Spline Extrude", () => {
          const cmd = new CreateNodeCommand(
            "generator",
            uniqueSiblingName(doc, null, "Spline Extrude"),
            null,
            undefined,
            { generator: splineExtrudeDescriptor() },
          );
          doc.history.run(cmd);
          genId = cmd.nodeId;
          if (selectedSpline) doc.history.run(new ReparentNodeCommand(selectedSpline, genId));
        });
        if (genId) doc.selection.selectObjects([genId]);
      },
    },
    {
      // C4D-style sweep: profile + path spline children → swept tube
      id: "create.sweep",
      title: "Sweep",
      menu: "Create",
      submenu: "Generators",
      icon: <IconSweep size={16} />,
      run: () => {
        // selection order is profile-first, path-second (like C4D)
        const splines = doc.selection.objectIds.filter(
          (id) => doc.scene.get(id)?.kind === "spline",
        );
        let genId: Uuid | null = null;
        doc.history.transact("Create Sweep", () => {
          const cmd = new CreateNodeCommand(
            "generator",
            uniqueSiblingName(doc, null, "Sweep"),
            null,
            undefined,
            { generator: sweepDescriptor() },
          );
          doc.history.run(cmd);
          genId = cmd.nodeId;
          for (const id of splines.slice(0, 2)) {
            doc.history.run(new ReparentNodeCommand(id, genId));
          }
        });
        if (genId) doc.selection.selectObjects([genId]);
      },
    },
    {
      // live boolean generator: first two mesh/primitive children are A ⊛ B
      id: "create.boolean",
      title: "Boolean",
      menu: "Create",
      submenu: "Generators",
      icon: <IconBoolean size={16} />,
      run: () => {
        const kids = doc.selection.objectIds
          .filter((id) => {
            const n = doc.scene.get(id);
            return n && (n.data?.mesh !== undefined || n.data?.primitive !== undefined);
          })
          .slice(0, 2);
        let genId: Uuid | null = null;
        doc.history.transact("Create Boolean", () => {
          const cmd = new CreateNodeCommand(
            "generator",
            uniqueSiblingName(doc, null, "Boolean"),
            null,
            undefined,
            { generator: booleanDescriptor() },
          );
          doc.history.run(cmd);
          genId = cmd.nodeId;
          for (const id of kids) doc.history.run(new ReparentNodeCommand(id, genId));
        });
        if (genId) doc.selection.selectObjects([genId]);
      },
    },
    {
      // Instancer generator: child[0] = target to clone onto (mesh or spline),
      // child[1] = the object to instance. Object-driven distribution + effector.
      id: "create.cloner",
      title: "Instancer",
      menu: "Create",
      submenu: "Generators",
      icon: <IconCloner size={16} />,
      run: () => {
        // up to two selected mesh/primitive/spline nodes, in selection order →
        // [target, template]; the user can reorder/add children afterwards
        const kids = doc.selection.objectIds
          .filter((id) => {
            const n = doc.scene.get(id);
            return (
              n &&
              (n.data?.mesh !== undefined ||
                n.data?.primitive !== undefined ||
                (n.kind === "spline" && n.data?.spline !== undefined))
            );
          })
          .slice(0, 2);
        let genId: Uuid | null = null;
        doc.history.transact("Create Instancer", () => {
          const cmd = new CreateNodeCommand(
            "generator",
            uniqueSiblingName(doc, null, "Instancer"),
            null,
            undefined,
            { generator: clonerDescriptor() },
          );
          doc.history.run(cmd);
          genId = cmd.nodeId;
          for (const id of kids) doc.history.run(new ReparentNodeCommand(id, genId));
          // hide the target by default — the clones stand in for it (the panel's
          // Hide Target toggle IS the node's visibility, so this stays in sync)
          if (kids[0]) doc.history.run(new SetFlagsCommand(kids[0], { visible: false }));
        });
        if (genId) doc.selection.selectObjects([genId]);
      },
    },
    ...LIGHT_TYPES.map(
      (type): AppCommand => ({
        id: `create.light.${type}`,
        title: LIGHT_LABELS[type],
        menu: "Create",
        submenu: "Lights",
        icon: LIGHT_ICONS[type],
        run: () => createLight(type),
      }),
    ),
    {
      // scene objects (not generators): a separator sets them off from the
      // geometry-producing groups above
      id: "create.camera",
      title: "Camera",
      menu: "Create",
      icon: <IconCamera size={16} />,
      sep: true,
      run: () => {
        const cmd = new CreateNodeCommand(
          "camera",
          uniqueSiblingName(doc, null, "Camera"),
          null,
          undefined,
          {
            camera: defaultCameraData(),
          },
        );
        doc.history.run(cmd);
        doc.selection.selectObjects([cmd.nodeId]);
      },
    },
    {
      id: "create.null",
      title: "Null",
      menu: "Create",
      icon: <IconNull size={16} />,
      run: () => {
        const cmd = new CreateNodeCommand("null", uniqueSiblingName(doc, null, "Null"));
        doc.history.run(cmd);
        doc.selection.selectObjects([cmd.nodeId]);
      },
    },

    // ---- Mesh (modal tools + topology actions) ----
    // extrude/inset are Blender-style modal TOOLS: activating enters an
    // amount drag in the viewport (mouse up/down = amount, LMB confirms)
    ...(["extrude", "inset"] as AmountKind[]).map(
      (kind): AppCommand => ({
        id: `mesh.${kind}`,
        title: kind === "extrude" ? "Extrude" : "Inset",
        menu: "Mesh",
        icon: kind === "extrude" ? <IconExtrude size={16} /> : <IconInset size={16} />,
        enabled: () => doc.selection.editMode === "polygon" && componentTarget("polygon") !== null,
        run: () => shell.getViewport()?.beginAmountTool(kind),
      }),
    ),
    {
      // Bevel dispatches by mode: point → vertex truncation, edge → chamfer
      id: "mesh.bevel",
      title: "Bevel",
      menu: "Mesh",
      icon: <IconBevel size={16} />,
      enabled: () => {
        const m = doc.selection.editMode;
        if (m === "point") return componentTarget("point") !== null;
        if (m === "edge") return componentTarget("edge") !== null;
        return false;
      },
      run: () => {
        const vp = shell.getViewport();
        if (doc.selection.editMode === "edge") vp?.beginBevelTool();
        else vp?.beginAmountTool("bevel");
      },
    },
    {
      id: "mesh.weldTool",
      title: "Weld Tool",
      menu: "Mesh",
      icon: <IconWeld size={16} />,
      enabled: () => doc.selection.editMode === "point",
      run: () => editorState.setWeldArmed(!editorState.weldArmed),
    },
    {
      id: "mesh.dissolve",
      title: "Dissolve",
      menu: "Mesh",
      icon: <IconDissolve size={16} />,
      enabled: () =>
        doc.selection.editMode === "point" && (componentTarget("point")?.ids.length ?? 0) >= 2,
      run: () => runTopologyOp("point", "Dissolve", (m, ids) => dissolveVertices(m, ids)),
    },

    // ---- View ----
    {
      id: "view.toggleLayout",
      title: "Toggle 1-up / 4-up",
      menu: "View",
      run: () => editorState.toggleLayout(),
    },
    {
      id: "view.toggleWorldMode",
      title: "World / Local Gizmo",
      menu: "View",
      run: () => editorState.toggleGizmoSpace(),
    },
    {
      id: "view.frameSelection",
      title: "Frame Selection",
      menu: "View",
      run: () => shell.getViewport()?.frameSelection(),
    },
    {
      id: "view.frameAll",
      title: "Frame All",
      menu: "View",
      run: () => shell.getViewport()?.frameAll(),
    },
    {
      id: "view.palette",
      title: "Command Palette…",
      menu: "View",
      sep: true,
      run: () => openPalette(),
    },
    {
      id: "view.keyBindings",
      title: "Keyboard shortcuts",
      menu: "View",
      icon: <IconSettings size={16} />,
      run: () => shell.openKeyboardShortcuts(),
    },
    {
      id: "view.materials",
      title: "Material Manager",
      menu: "View",
      run: () => shell.openMaterials(),
    },
    {
      id: "view.environment",
      title: "Environment",
      menu: "View",
      run: () => shell.openEnvironment(),
    },
    {
      id: "view.gallery",
      title: "UI Gallery",
      menu: "View",
      run: () => shell.openGallery(),
    },
    {
      id: "view.noiseGallery",
      title: "Noise Gallery",
      menu: "View",
      run: () => shell.openNoiseGallery(),
    },
    {
      id: "view.resetLayout",
      title: "Reset Layout",
      menu: "View",
      run: () => shell.resetLayout(),
    },
  ];
}
