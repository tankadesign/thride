import type { Document } from "@/core";
import { CreateNodeCommand, RemoveNodeCommand } from "@/core/history/commands/scene";
import type { PrimitiveType } from "@/types/geometry/primitives";
import { defaultPrimitive, primitiveLabels } from "@/types/geometry/primitives";
import type { AppCommand } from "@/ui/commands/CommandRegistry";
import type { EditorState } from "@/ui/state/EditorState";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";
import { FORMAT_VERSION } from "@/types/core";

export interface ShellApi {
  getViewport: () => ViewportSystem | null;
  openGallery: () => void;
  resetLayout: () => void;
}

const PRIMITIVES: PrimitiveType[] = [
  "cube",
  "sphere",
  "icosphere",
  "cylinder",
  "cone",
  "capsule",
  "torus",
  "plane",
  "disc",
  "pyramid",
];

export function buildCommands(doc: Document, editor: EditorState, shell: ShellApi): AppCommand[] {
  const createPrimitive = (type: PrimitiveType) => {
    const cmd = new CreateNodeCommand("mesh", primitiveLabels[type], null, undefined, {
      primitive: defaultPrimitive(type),
    });
    doc.history.run(cmd);
    doc.selection.selectObjects([cmd.nodeId]);
  };

  /** top-most selected nodes only (skip ones whose ancestor is also selected) */
  const deletableSelection = () =>
    doc.selection.objectIds.filter(
      (id) =>
        doc.scene.has(id) &&
        !doc.selection.objectIds.some(
          (other) => other !== id && doc.scene.isAncestorOrSelf(other, id),
        ),
    );

  return [
    // ---- File ----
    {
      id: "file.new",
      title: "New Project",
      menu: "File",
      run: () => {
        doc.loadDTO({ formatVersion: FORMAT_VERSION, nodes: [] });
        doc.selection.clearObjects();
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
      enabled: () => doc.selection.objectIds.length > 0,
      run: () => {
        const ids = deletableSelection();
        if (ids.length === 0) return;
        doc.history.transact("Delete", () => {
          for (const id of ids) doc.history.run(new RemoveNodeCommand(id));
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
        run: () => createPrimitive(type),
      }),
    ),
    {
      id: "create.null",
      title: "Null",
      menu: "Create",
      sep: true,
      run: () => {
        const cmd = new CreateNodeCommand("null", "Null");
        doc.history.run(cmd);
        doc.selection.selectObjects([cmd.nodeId]);
      },
    },
    {
      id: "create.camera",
      title: "Camera",
      menu: "Create",
      run: () => {
        const cmd = new CreateNodeCommand("camera", "Camera");
        doc.history.run(cmd);
        doc.selection.selectObjects([cmd.nodeId]);
      },
    },

    // ---- View ----
    {
      id: "view.toggleLayout",
      title: "Toggle 1-up / 4-up",
      menu: "View",
      shortcut: "mod+4",
      run: () => editor.toggleLayout(),
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
      run: () => editor.setPaletteOpen(true),
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
