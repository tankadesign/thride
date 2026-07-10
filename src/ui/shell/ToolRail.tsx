import type { EditMode } from "@/types/core";
import { ConvertToMeshCommand } from "@/geometry/commands/convert";
import type { CommandRegistry } from "@/ui/commands/CommandRegistry";
import { useDocument } from "@/ui/hooks/doc/document";
import { useSelectionInfo } from "@/ui/hooks/doc/selection";
import {
  IconCube,
  IconCursor,
  IconCylinder,
  IconDelete,
  IconEdge,
  IconExtrude,
  IconInset,
  IconPlane,
  IconPoint,
  IconPolygon,
  IconSphere,
  IconTexture,
  IconTorus,
  IconWeld,
} from "@/icons";

const MODES: { mode: EditMode; icon: React.ReactNode; title: string; enabled: boolean }[] = [
  { mode: "object", icon: <IconCursor />, title: "Object mode", enabled: true },
  { mode: "point", icon: <IconPoint />, title: "Point mode", enabled: true },
  { mode: "edge", icon: <IconEdge />, title: "Edge mode", enabled: true },
  { mode: "polygon", icon: <IconPolygon />, title: "Polygon mode", enabled: true },
  { mode: "texture", icon: <IconTexture />, title: "Texture mode (M2)", enabled: false },
];

const QUICK_CREATE: { cmd: string; icon: React.ReactNode; title: string }[] = [
  { cmd: "create.cube", icon: <IconCube />, title: "Cube" },
  { cmd: "create.sphere", icon: <IconSphere />, title: "Sphere" },
  { cmd: "create.cylinder", icon: <IconCylinder />, title: "Cylinder" },
  { cmd: "create.torus", icon: <IconTorus />, title: "Torus" },
  { cmd: "create.plane", icon: <IconPlane />, title: "Plane" },
];

/** Context tools per edit mode (the M1 context-sensitive toolbar). */
const MODE_TOOLS: Partial<Record<EditMode, { cmd: string; icon: React.ReactNode; title: string }[]>> =
  {
    point: [
      { cmd: "mesh.weld", icon: <IconWeld />, title: "Weld Points" },
      { cmd: "edit.delete", icon: <IconDelete />, title: "Delete" },
    ],
    edge: [{ cmd: "edit.delete", icon: <IconDelete />, title: "Delete" }],
    polygon: [
      { cmd: "mesh.extrude", icon: <IconExtrude />, title: "Extrude (D)" },
      { cmd: "mesh.inset", icon: <IconInset />, title: "Inset (I)" },
      { cmd: "edit.delete", icon: <IconDelete />, title: "Delete" },
    ],
  };

/** Left toolbar — context-sensitive by edit mode (per-mode tools land with D4b). */
export function ToolRail({ registry }: { registry: CommandRegistry }) {
  const doc = useDocument();
  const { editMode } = useSelectionInfo();

  /** Entering a component mode on a primitive converts it first (Spline-style,
   * one undoable "Convert to Mesh" step) so components are editable at once. */
  const enterMode = (mode: EditMode) => {
    if (mode === "point" || mode === "edge" || mode === "polygon") {
      const active = doc.selection.active;
      if (active && ConvertToMeshCommand.eligible(doc, active)) {
        doc.history.run(new ConvertToMeshCommand(doc, active));
      }
    }
    doc.selection.setEditMode(mode);
  };

  return (
    <ul className="menu menu-xs w-13 flex-none gap-0.5 border-r border-base-100 bg-base-300 p-1">
      {MODES.map((m) => (
        <li key={m.mode} className={m.enabled ? "" : "menu-disabled"}>
          <button
            type="button"
            className={`tooltip tooltip-right px-1.5 ${editMode === m.mode ? "menu-active text-primary" : ""}`}
            data-tip={m.title}
            onClick={() => m.enabled && enterMode(m.mode)}
          >
            {m.icon}
          </button>
        </li>
      ))}
      {(MODE_TOOLS[editMode] ?? []).length > 0 ? (
        <>
          <li className="pointer-events-none my-1 h-px bg-base-100 p-0" />
          {MODE_TOOLS[editMode]!.map((t) => (
            <li key={t.cmd}>
              <button
                type="button"
                className="tooltip tooltip-right px-1.5"
                data-tip={t.title}
                onClick={() => registry.run(t.cmd)}
              >
                {t.icon}
              </button>
            </li>
          ))}
        </>
      ) : null}
      <li className="pointer-events-none my-1 h-px bg-base-100 p-0" />
      {QUICK_CREATE.map((q) => (
        <li key={q.cmd}>
          <button
            type="button"
            className="tooltip tooltip-right px-1.5"
            data-tip={q.title}
            onClick={() => registry.run(q.cmd)}
          >
            {q.icon}
          </button>
        </li>
      ))}
    </ul>
  );
}
