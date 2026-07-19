import { useRef } from "react";
import type { PlanarReflectionDTO, Uuid } from "@/types/core";
import { defaultPlanarReflection } from "@/types/core";
import { SetNodeDataCommand } from "@/core/history/commands/scene";
import { IconCaretDown } from "@/icons";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { Field, Section } from "@/ui/widgets/inspector";

/**
 * Planar (mirrored-camera) reflection on a flat surface — exact mirror that
 * shows occluded geometry (unlike SSR). Per-object; the mirror plane passes
 * through the object origin along the chosen local axis.
 */
export function PlanarReflectionSection({
  id,
  planar,
}: {
  id: Uuid;
  planar?: PlanarReflectionDTO;
}) {
  const doc = useDocument();
  const scrub = useRef<{ before: Record<string, unknown> } | null>(null);

  const setPlanar = (patch: Partial<PlanarReflectionDTO> | null, committed: boolean) => {
    const node = doc.scene.mustGet(id);
    scrub.current ??= { before: structuredClone(node.data ?? {}) };
    const data = structuredClone(node.data ?? {});
    if (patch === null) delete data.planar;
    else data.planar = { ...defaultPlanarReflection(), ...(data.planar ?? {}), ...patch };
    if (committed) {
      const before = scrub.current.before;
      scrub.current = null;
      doc.setNodeData(id, data, true);
      doc.history.pushWithoutExecute(new SetNodeDataCommand(id, data, before, "Planar Reflection"));
    } else {
      doc.setNodeData(id, data, true);
    }
  };

  return (
    <Section title="Planar Reflection">
      <Field label="Enabled">
        <input
          type="checkbox"
          className="toggle toggle-sm"
          checked={!!planar}
          onChange={(e) => setPlanar(e.target.checked ? {} : null, true)}
        />
      </Field>
      {planar ? (
        <>
          <Field label="Axis">
            <select
              className="select select-sm w-full"
              value={planar.axis}
              onChange={(e) =>
                setPlanar({ axis: e.target.value as PlanarReflectionDTO["axis"] }, true)
              }
            >
              <option value="y">Y (floor)</option>
              <option value="x">X (wall)</option>
              <option value="z">Z (wall)</option>
            </select>
          </Field>
          <Field label="Strength">
            <NumberDrag
              value={planar.strength}
              step={0.02}
              min={0}
              max={1}
              onChange={(v, committed) => setPlanar({ strength: v }, committed)}
            />
          </Field>
          <Field label="Resolution">
            <NumberDrag
              value={planar.resolution}
              step={0.05}
              min={0.25}
              max={1}
              onChange={(v, committed) => setPlanar({ resolution: v }, committed)}
            />
          </Field>
        </>
      ) : null}
    </Section>
  );
}

/** Color chip for a material: base color fill with a subtle white ring (12px radius). */
export function Swatch({ color }: { color: string }) {
  return (
    <span className="relative overflow-hidden rounded-full inline-block">
      <span
        className="block shrink-0 border border-white/30"
        style={{ width: "14px", height: "14px", backgroundColor: color }}
      />
      <span className="absolute block w-4 h-4 left-1 -top-0.5 inset-0 rounded-full bg-radial from-white/60 to-white/0" />
    </span>
  );
}

/**
 * Assign a library material to a triangle-mesh object (or None to unset).
 * Custom dropdown (not a native select) so each entry can show the material's
 * base-color swatch. One undo step per change; a dangling id reads as None.
 */
export function MaterialSelector({ id }: { id: Uuid }) {
  const doc = useDocument();
  useSliceVersion("materials"); // re-render on library add/rename/recolor
  const node = doc.scene.mustGet(id);
  const materials = doc.materials.all();
  const currentId = node.data?.material as Uuid | undefined;
  const current = currentId ? doc.materials.get(currentId) : undefined;

  const assign = (matId: Uuid | null) => {
    const before = structuredClone(node.data ?? {});
    const data = structuredClone(node.data ?? {});
    if (matId) data.material = matId;
    else delete data.material;
    doc.history.run(
      new SetNodeDataCommand(id, data, before, matId ? "Assign Material" : "Clear Material"),
    );
    (document.activeElement as HTMLElement | null)?.blur(); // close the dropdown
  };

  return (
    <Section title="Material">
      {/* opens upward: the Material section sits at the panel bottom, and the
          panel's overflow would otherwise clip a downward menu off-screen */}
      <div className="dropdown dropdown-top w-full">
        <div
          tabIndex={0}
          role="button"
          className="btn btn-sm btn-block justify-between font-normal border-base-content/20 bg-transparent"
        >
          <span className="flex min-w-0 items-center gap-2">
            {current ? <Swatch color={current.color} /> : null}
            <span className="truncate">{current ? current.name : "None"}</span>
          </span>
          <IconCaretDown size={12} className="opacity-50" />
        </div>
        <ul
          tabIndex={0}
          className="dropdown-content menu menu-xs z-10 mt-1 max-h-60 w-full flex-nowrap overflow-auto rounded-box border border-base-300 bg-base-200 shadow-lg"
        >
          <li>
            <button type="button" className={current ? "" : "active"} onClick={() => assign(null)}>
              None
            </button>
          </li>
          {materials.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className={m.id === currentId ? "active" : ""}
                onClick={() => assign(m.id)}
              >
                <Swatch color={m.color} />
                <span className="truncate">{m.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
