import type { Document } from "@/core";
import { uniqueSiblingName } from "@/core";
import {
  CreateNodeCommand,
  RemoveNodeCommand,
  ReparentNodeCommand,
} from "@/core/history/commands/scene";
import { ConvertToMeshCommand } from "@/geometry/commands/convert";
import { MeshTopologyCommand } from "@/geometry/commands/topology";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { facesForSelection } from "@/geometry/kernel/components";
import { deleteFaces } from "@/geometry/ops/faceOps";
import type { OpResult } from "@/geometry/ops/soup";
import { dissolveVertices } from "@/geometry/ops/weld";
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
import type { ComponentMode, Uuid } from "@/types/core";
import {
  IconAmbientLight,
  IconAreaLight,
  IconCamera,
  IconCone,
  IconCube,
  IconCylinder,
  IconDirectionalLight,
  IconDisc,
  IconDissolve,
  IconExtrude,
  IconHemisphereLight,
  IconIcosphere,
  IconInset,
  IconNull,
  IconPlane,
  IconPointLight,
  IconPyramid,
  IconSphere,
  IconSpotlight,
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

export function buildCommands(doc: Document, shell: ShellApi): AppCommand[] {
  const createPrimitive = (type: PrimitiveType) => {
    const name = uniqueSiblingName(doc, null, primitiveLabels[type]);
    const cmd = new CreateNodeCommand("mesh", name, null, undefined, {
      primitive: defaultPrimitive(type),
    });
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
      sep: true,
      shortcut: "delete",
      enabled: () => {
        const mode = doc.selection.editMode;
        if (mode === "point" || mode === "edge" || mode === "polygon") {
          return componentTarget(mode) !== null;
        }
        return doc.selection.objectIds.length > 0;
      },
      run: () => {
        // component modes delete the touched faces; object mode deletes nodes
        const mode = doc.selection.editMode;
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
      id: "edit.convertToMesh",
      title: "Convert to Mesh",
      menu: "Edit",
      shortcut: "c",
      enabled: () => doc.selection.objectIds.some((id) => ConvertToMeshCommand.eligible(doc, id)),
      run: () => {
        // convert every selected primitive; already-converted/ineligible nodes are skipped
        const ids = doc.selection.objectIds.filter((id) => ConvertToMeshCommand.eligible(doc, id));
        if (ids.length === 0) return;
        doc.history.transact("Convert to Mesh", () => {
          for (const id of ids) doc.history.run(new ConvertToMeshCommand(doc, id));
        });
      },
    },
    {
      id: "edit.deselect",
      title: "Deselect All",
      menu: "Edit",
      shortcut: "mod+d",
      run: () => doc.selection.clearObjects(),
    },

    // ---- Create ----
    ...PRIMITIVES.map(
      (type): AppCommand => ({
        id: `create.${type}`,
        title: primitiveLabels[type],
        menu: "Create",
        icon: PRIMITIVE_ICONS[type],
        run: () => createPrimitive(type),
      }),
    ),
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
      id: "create.null",
      title: "Null",
      menu: "Create",
      icon: <IconNull size={16} />,
      sep: true,
      run: () => {
        const cmd = new CreateNodeCommand("null", uniqueSiblingName(doc, null, "Null"));
        doc.history.run(cmd);
        doc.selection.selectObjects([cmd.nodeId]);
      },
    },
    {
      id: "create.camera",
      title: "Camera",
      menu: "Create",
      icon: <IconCamera size={16} />,
      run: () => {
        const cmd = new CreateNodeCommand("camera", uniqueSiblingName(doc, null, "Camera"));
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
      id: "view.gallery",
      title: "UI Gallery",
      menu: "View",
      run: () => shell.openGallery(),
    },
    {
      id: "view.resetLayout",
      title: "Reset Layout",
      menu: "View",
      run: () => shell.resetLayout(),
    },
  ];
}
