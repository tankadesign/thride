import type { EditMode } from "@/types/core";
import type { CommandRegistry } from "@/ui/commands/CommandRegistry";
import { useDocument } from "@/ui/hooks/DocumentContext";
import { useDocSlice } from "@/ui/hooks/useDocSlice";
import { Button } from "@/ui/widgets/Button";

const MODES: { mode: EditMode; glyph: string; title: string; enabled: boolean }[] = [
  { mode: "object", glyph: "⬚", title: "Object mode", enabled: true },
  { mode: "point", glyph: "·", title: "Point mode (M1)", enabled: false },
  { mode: "edge", glyph: "╱", title: "Edge mode (M1)", enabled: false },
  { mode: "polygon", glyph: "▲", title: "Polygon mode (M1)", enabled: false },
  { mode: "texture", glyph: "🗺", title: "Texture mode (M2)", enabled: false },
];

const QUICK_CREATE: { cmd: string; glyph: string; title: string }[] = [
  { cmd: "create.cube", glyph: "⬛", title: "Cube" },
  { cmd: "create.sphere", glyph: "●", title: "Sphere" },
  { cmd: "create.cylinder", glyph: "⬮", title: "Cylinder" },
  { cmd: "create.torus", glyph: "◎", title: "Torus" },
  { cmd: "create.plane", glyph: "▭", title: "Plane" },
];

/** Left toolbar — context-sensitive by edit mode (object mode only in M0). */
export function ToolRail({ registry }: { registry: CommandRegistry }) {
  const doc = useDocument();
  useDocSlice("selection");
  return (
    <div className="t-rail">
      {MODES.map((m) => (
        <Button
          key={m.mode}
          variant="ghost"
          title={m.title}
          disabled={!m.enabled}
          active={doc.selection.editMode === m.mode}
          onClick={() => doc.selection.setEditMode(m.mode)}
        >
          {m.glyph}
        </Button>
      ))}
      <div className="t-rail-sep" />
      {QUICK_CREATE.map((q) => (
        <Button key={q.cmd} variant="ghost" title={q.title} onClick={() => registry.run(q.cmd)}>
          {q.glyph}
        </Button>
      ))}
    </div>
  );
}
