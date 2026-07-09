import type { EditMode } from "@/types/core";
import type { CommandRegistry } from "@/ui/commands/CommandRegistry";
import { useDocument } from "@/ui/hooks/doc/document";
import { useSelectionInfo } from "@/ui/hooks/doc/selection";
import {
  IconCube,
  IconCursor,
  IconCylinder,
  IconEdge,
  IconPlane,
  IconPoint,
  IconPolygon,
  IconSphere,
  IconTexture,
  IconTorus,
} from "@/icons";

const MODES: { mode: EditMode; icon: React.ReactNode; title: string; enabled: boolean }[] = [
  { mode: "object", icon: <IconCursor />, title: "Object mode", enabled: true },
  { mode: "point", icon: <IconPoint />, title: "Point mode (M1)", enabled: false },
  { mode: "edge", icon: <IconEdge />, title: "Edge mode (M1)", enabled: false },
  { mode: "polygon", icon: <IconPolygon />, title: "Polygon mode (M1)", enabled: false },
  { mode: "texture", icon: <IconTexture />, title: "Texture mode (M2)", enabled: false },
];

const QUICK_CREATE: { cmd: string; icon: React.ReactNode; title: string }[] = [
  { cmd: "create.cube", icon: <IconCube />, title: "Cube" },
  { cmd: "create.sphere", icon: <IconSphere />, title: "Sphere" },
  { cmd: "create.cylinder", icon: <IconCylinder />, title: "Cylinder" },
  { cmd: "create.torus", icon: <IconTorus />, title: "Torus" },
  { cmd: "create.plane", icon: <IconPlane />, title: "Plane" },
];

/** Left toolbar — context-sensitive by edit mode (object mode only until M1). */
export function ToolRail({ registry }: { registry: CommandRegistry }) {
  const doc = useDocument();
  const { editMode } = useSelectionInfo();
  return (
    <ul className="menu menu-xs w-11 flex-none gap-0.5 border-r border-base-100 bg-base-300 p-1">
      {MODES.map((m) => (
        <li key={m.mode} className={m.enabled ? "" : "menu-disabled"}>
          <button
            type="button"
            className={`tooltip tooltip-right px-1.5 ${editMode === m.mode ? "menu-active" : ""}`}
            data-tip={m.title}
            onClick={() => m.enabled && doc.selection.setEditMode(m.mode)}
          >
            {m.icon}
          </button>
        </li>
      ))}
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
