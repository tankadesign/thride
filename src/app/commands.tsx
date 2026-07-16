import type { Document } from "@/core";
import { uniqueSiblingName } from "@/core";
import {
  CreateNodeCommand,
  RemoveNodeCommand,
  ReparentNodeCommand,
  SetNodeDataCommand,
  SetTransformCommand,
} from "@/core/history/commands/scene";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { ConvertToMeshCommand } from "@/geometry/commands/convert";
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
  evaluateGenerator,
  splineExtrudeDescriptor,
  sweepDescriptor,
} from "@/generators/graph";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import type { PrimitiveType } from "@/types/geometry/primitives";
import { defaultPrimitive, primitiveLabels } from "@/types/geometry/primitives";
import { defaultLightData, LIGHT_LABELS, type LightType } from "@/types/core/light";
import type { AppCommand } from "@/ui/commands/CommandRegistry";
import { createProject } from "@/ui/hooks/doc/projects";
import { openPalette } from "@/ui/hooks/editor/shell";
import { editorState } from "@/ui/hooks/editor/viewport";
import type { AmountKind } from "@/render/tools/AmountTool";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";
import type { ComponentMode, TransformDTO, Uuid } from "@/types/core";
import {
  IconAmbientLight,
  IconAreaLight,
  IconBevel,
  IconBoolean,
  IconCamera,
  IconCone,
  IconCube,
  IconCylinder,
  IconDelete,
  IconDirectionalLight,
  IconCircle,
  IconDisc,
  IconGroup,
  IconHelix,
  IconNSide,
  IconStar,
  IconDissolve,
  IconExtrude,
  IconHemisphereLight,
  IconIcosphere,
  IconInset,
  IconNull,
  IconPen,
  IconPlane,
  IconPointLight,
  IconPyramid,
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
  resetLayout: () => void;
}

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
      shortcut: "mod+z",
      enabled: () => doc.history.canUndo,
      run: () => doc.history.undo(),
    },
    {
      id: "edit.redo",
      title: "Redo",
      menu: "Edit",
      shortcut: "shift+mod+z",
      enabled: () => doc.history.canRedo,
      run: () => doc.history.redo(),
    },
    {
      id: "edit.delete",
      title: "Delete",
      menu: "Edit",
      icon: <IconDelete size={16} />,
      sep: true,
      shortcut: "delete",
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
      shortcut: "mod+g",
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
      shortcut: "shift+mod+g",
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
      id: "edit.convertToMesh",
      title: "Convert to Mesh",
      menu: "Edit",
      shortcut: "c",
      enabled: () =>
        doc.selection.objectIds.some(
          (id) =>
            ConvertToMeshCommand.eligible(doc, id) ||
            doc.scene.get(id)?.data?.generator !== undefined,
        ),
      run: () => {
        // primitives convert directly; generators bake their evaluated mesh
        const prims = doc.selection.objectIds.filter((id) =>
          ConvertToMeshCommand.eligible(doc, id),
        );
        const gens = doc.selection.objectIds.filter(
          (id) => doc.scene.get(id)?.data?.generator !== undefined,
        );
        if (prims.length === 0 && gens.length === 0) return;
        doc.history.transact("Convert to Mesh", () => {
          for (const id of prims) doc.history.run(new ConvertToMeshCommand(doc, id));
          for (const id of gens) {
            const result = evaluateGenerator(doc, doc.scene.mustGet(id));
            if (result) {
              // deep-copy: the registry takes ownership; the cache may rebuild
              const baked = HEMesh.fromSnapshot(result.mesh.snapshot());
              doc.history.run(new ConvertToMeshCommand(doc, id, baked));
            }
          }
        });
      },
    },
    {
      id: "edit.selectAll",
      title: "Select All",
      menu: "Edit",
      sep: true,
      // bare A, scoped to the viewport (Blender-style): object mode selects all
      // nodes, component modes select all points/edges/polygons of the mesh
      shortcut: "a",
      viewportScoped: true,
      run: () => selectAll(doc),
    },
    {
      id: "edit.deselect",
      title: "Deselect All",
      menu: "Edit",
      shortcut: "mod+d",
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
      shortcut: "p",
      run: () => shell.getViewport()?.penTool.toggle(),
    },
    // parametric curve primitives — spline nodes with a live `splinePrimitive`
    // recipe (attributes rebuild the points); feed extrude/sweep like any spline
    ...(
      [
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
        const cmd = new CreateNodeCommand("camera", uniqueSiblingName(doc, null, "Camera"));
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
        shortcut: kind === "extrude" ? "d" : "i",
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
      shortcut: "b",
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
      shortcut: "mod+4",
      run: () => editorState.toggleLayout(),
    },
    {
      id: "view.toggleWorldMode",
      title: "World / Local Gizmo",
      menu: "View",
      shortcut: "w",
      run: () => editorState.toggleGizmoSpace(),
    },
    {
      id: "view.frameSelection",
      title: "Frame Selection",
      menu: "View",
      shortcut: "f",
      run: () => shell.getViewport()?.frameSelection(),
    },
    {
      id: "view.frameAll",
      title: "Frame All",
      menu: "View",
      shortcut: "h",
      run: () => shell.getViewport()?.frameAll(),
    },
    {
      id: "view.palette",
      title: "Command Palette…",
      menu: "View",
      sep: true,
      shortcut: "mod+k",
      run: () => openPalette(),
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
