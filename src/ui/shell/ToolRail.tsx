import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";
import type { EditMode } from "@/types/core";
import type { CommandRegistry } from "@/ui/commands/CommandRegistry";
import { useSelectionInfo } from "@/ui/hooks/doc/selection";
import { snapEnabledAtom } from "@/ui/hooks/editor/settings";
import { penActiveAtom, projectionEditTargetAtom, weldArmedAtom } from "@/ui/hooks/editor/viewport";
import {
  IconBevel,
  IconCube,
  IconCursor,
  IconCylinder,
  IconEdge,
  IconExtrude,
  IconInset,
  IconMagnet,
  IconPen,
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
  // enabled only while a map's projection is being edited (see MapSlot's
  // "Enable Editor" button); the enablement is overridden per-render below.
  { mode: "texture", icon: <IconTexture />, title: "Texture mode", enabled: false },
];

const QUICK_CREATE: { cmd: string; icon: React.ReactNode; title: string }[] = [
  { cmd: "create.cube", icon: <IconCube />, title: "Cube" },
  { cmd: "create.sphere", icon: <IconSphere />, title: "Sphere" },
  { cmd: "create.cylinder", icon: <IconCylinder />, title: "Cylinder" },
  { cmd: "create.torus", icon: <IconTorus />, title: "Torus" },
  { cmd: "create.plane", icon: <IconPlane />, title: "Plane" },
];

/** Context TOOLS per edit mode — the rail is reserved for tools, not actions.
 * `toggle` marks stateful tools that stay armed (highlighted) until toggled. */
const MODE_TOOLS: Partial<
  Record<EditMode, { cmd: string; icon: React.ReactNode; title: string; toggle?: boolean }[]>
> = {
  object: [{ cmd: "spline.pen", icon: <IconPen />, title: "Pen (P)", toggle: true }],
  point: [
    { cmd: "mesh.bevel", icon: <IconBevel />, title: "Bevel (B)" },
    { cmd: "mesh.weldTool", icon: <IconWeld />, title: "Weld Tool", toggle: true },
  ],
  edge: [{ cmd: "mesh.bevel", icon: <IconBevel />, title: "Bevel (B)" }],
  polygon: [
    { cmd: "mesh.extrude", icon: <IconExtrude />, title: "Extrude (D)" },
    { cmd: "mesh.inset", icon: <IconInset />, title: "Inset (I)" },
  ],
};

/** Left toolbar — context-sensitive by edit mode (per-mode tools land with D4b). */
export function ToolRail({ registry }: { registry: CommandRegistry }) {
  const { editMode } = useSelectionInfo();
  const weldArmed = useAtomValue(weldArmedAtom);
  const penActive = useAtomValue(penActiveAtom);
  const projectionTarget = useAtomValue(projectionEditTargetAtom);
  const setProjectionTarget = useSetAtom(projectionEditTargetAtom);
  const [snapEnabled, setSnapEnabled] = useAtom(snapEnabledAtom);

  // Leaving Texture mode (any other tool) ends projection editing.
  useEffect(() => {
    if (editMode !== "texture" && projectionTarget) setProjectionTarget(null);
  }, [editMode, projectionTarget, setProjectionTarget]);
  /** Armed state per toggle-style rail tool. */
  const toggleActive: Record<string, boolean> = {
    "mesh.weldTool": weldArmed,
    "spline.pen": penActive,
  };

  /** Mode buttons run the mode.* commands (shared with the keymap: converting a
   * primitive to an editable mesh first happens in enterEditMode). */
  const enterMode = (mode: EditMode) => registry.run(`mode.${mode}`);

  return (
    <ul className="menu menu-xs w-13 flex-none gap-0.5 border-r border-base-100 bg-base-300 p-1">
      {MODES.map((m) => {
        // Texture mode is enabled only while a projection edit is armed.
        const enabled = m.mode === "texture" ? !!projectionTarget : m.enabled;
        return (
          <li key={m.mode} className={enabled ? "" : "menu-disabled"}>
            <button
              type="button"
              className={`btn btn-square btn-sm border border-base-100 tooltip tooltip-right p-0 ${enabled ? "" : "btn-disabled"} ${editMode === m.mode ? "menu-active text-primary" : ""}`}
              data-tip={m.title}
              onClick={() => enabled && enterMode(m.mode)}
            >
              {m.icon}
            </button>
          </li>
        );
      })}
      {(MODE_TOOLS[editMode] ?? []).length > 0 ? (
        <>
          <li className="pointer-events-none my-1 h-px bg-base-100 p-0" />
          {MODE_TOOLS[editMode]!.map((t) => (
            <li key={t.cmd}>
              <button
                type="button"
                className={`btn btn-square btn-sm border border-base-100 tooltip tooltip-right p-0 ${
                  t.toggle && toggleActive[t.cmd] ? "menu-active text-primary" : ""
                }`}
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
            className="btn btn-square btn-sm border border-base-100 tooltip tooltip-right p-0"
            data-tip={q.title}
            onClick={() => registry.run(q.cmd)}
          >
            {q.icon}
          </button>
        </li>
      ))}
      <li className="pointer-events-none my-1 h-px bg-base-100 p-0" />
      <li>
        <button
          type="button"
          className={`btn btn-square btn-sm border border-base-100 tooltip tooltip-right p-0 ${snapEnabled ? "menu-active text-primary" : ""}`}
          data-tip="Snap to vertex/edge"
          onClick={() => setSnapEnabled((s) => !s)}
        >
          <IconMagnet />
        </button>
      </li>
    </ul>
  );
}
