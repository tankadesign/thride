import { useRef, useState } from "react";
import { useAtom } from "jotai";
import type { Document } from "@/core";
import {
  CreateMaterialCommand,
  DeleteMaterialCommand,
  UpdateMaterialCommand,
  uuidv7,
} from "@/core";
import type { MaterialDTO, MaterialType, Uuid } from "@/types/core";
import {
  defaultMaterialData,
  HAS_COLOR,
  HAS_EMISSIVE,
  HAS_PBR,
  MATERIAL_TYPES,
} from "@/types/core";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { selectedMaterialAtom, useMaterialThumbnail } from "@/ui/hooks/editor/materials";
import { NumberDrag } from "@/ui/widgets/NumberDrag";

function uniqueMaterialName(doc: Document): string {
  const names = new Set(doc.materials.all().map((m) => m.name));
  if (!names.has("Material")) return "Material";
  let n = 1;
  while (names.has(`Material.${n}`)) n++;
  return `Material.${n}`;
}

/**
 * Material Manager (View → Material Manager): the project material library as a
 * grid of C4D-style sphere thumbnails. New defaults to Physical. Select a
 * material to edit it in the Attributes panel; drag onto an object to assign
 * (E1c). Names edit on double-click.
 */
export function MaterialManagerPanel() {
  const doc = useDocument();
  useSliceVersion("materials"); // re-render on any library change
  const [selected, setSelected] = useAtom(selectedMaterialAtom);
  const materials = doc.materials.all();

  const create = () => {
    const dto: MaterialDTO = {
      id: uuidv7(),
      name: uniqueMaterialName(doc),
      ...defaultMaterialData("physical"),
    };
    doc.history.run(new CreateMaterialCommand(dto));
    setSelected(dto.id);
  };

  const remove = (id: Uuid) => {
    const m = doc.materials.get(id);
    if (!m) return;
    doc.history.run(new DeleteMaterialCommand(m));
    if (selected === id) setSelected(null);
  };

  const rename = (id: Uuid, name: string) => {
    const before = doc.materials.get(id);
    if (!before || !name.trim() || name === before.name) return;
    doc.history.run(
      new UpdateMaterialCommand(before, { ...before, name: name.trim() }, "Rename Material"),
    );
  };

  return (
    <div className="flex h-full flex-col bg-base-100 text-xs">
      <div className="flex items-center gap-1 border-b border-base-200 px-2 py-1.5">
        <button type="button" className="btn btn-primary btn-xs" onClick={create}>
          New
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          disabled={!selected}
          onClick={() => selected && remove(selected)}
        >
          Delete
        </button>
        <span className="ml-auto opacity-50">
          {materials.length} material{materials.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(88px,1fr))] content-start gap-2 overflow-auto p-2">
        {materials.map((m) => (
          <MaterialCard
            key={m.id}
            dto={m}
            selected={selected === m.id}
            onSelect={() => setSelected(m.id)}
            onRename={(name) => rename(m.id, name)}
          />
        ))}
        {materials.length === 0 ? (
          <div className="col-span-full p-8 text-center opacity-40">
            No materials yet — click <span className="font-semibold">New</span>.
          </div>
        ) : null}
      </div>
      {selected && doc.materials.has(selected) ? <MaterialEditor id={selected} /> : null}
    </div>
  );
}

/** Live param editor for the selected material (drag = preview, release = undo step). */
function MaterialEditor({ id }: { id: Uuid }) {
  const doc = useDocument();
  useSliceVersion("materials");
  const scrub = useRef<{ before: MaterialDTO } | null>(null);
  const mat = doc.materials.get(id);
  if (!mat) return null;

  const setMat = (patch: Partial<MaterialDTO>, committed: boolean) => {
    const cur = doc.materials.get(id);
    if (!cur) return;
    scrub.current ??= { before: structuredClone(cur) };
    const after = { ...cur, ...patch };
    doc.updateMaterial(after, !committed); // preview during scrub
    if (committed) {
      const before = scrub.current.before;
      scrub.current = null;
      doc.history.pushWithoutExecute(new UpdateMaterialCommand(before, after, "Edit Material"));
    }
  };

  const slider = (
    label: string,
    key: "roughness" | "metalness" | "emissiveIntensity" | "opacity",
    step: number,
    max: number,
  ) => (
    <div className="grid grid-cols-[68px_1fr] items-center gap-1" key={key}>
      <span className="opacity-60">{label}</span>
      <NumberDrag
        value={mat[key]}
        step={step}
        min={0}
        max={max}
        onChange={(v, committed) => setMat({ [key]: v }, committed)}
      />
    </div>
  );

  const color = (label: string, key: "color" | "emissive") => (
    <div className="grid grid-cols-[68px_1fr] items-center gap-1">
      <span className="opacity-60">{label}</span>
      <input
        type="color"
        className="h-6 w-12 cursor-pointer rounded border border-base-300 bg-base-100"
        value={mat[key]}
        onChange={(e) => setMat({ [key]: e.target.value }, true)}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5 border-t border-base-200 bg-base-200/40 p-2 text-xs">
      <div className="truncate font-semibold opacity-80">{mat.name}</div>
      <div className="grid grid-cols-[68px_1fr] items-center gap-1">
        <span className="opacity-60">Type</span>
        <select
          className="select select-xs"
          value={mat.type}
          onChange={(e) => setMat({ type: e.target.value as MaterialType }, true)}
        >
          {MATERIAL_TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {HAS_COLOR.has(mat.type) ? color("Color", "color") : null}
      {HAS_PBR.has(mat.type) ? slider("Roughness", "roughness", 0.01, 1) : null}
      {HAS_PBR.has(mat.type) ? slider("Metalness", "metalness", 0.01, 1) : null}
      {HAS_EMISSIVE.has(mat.type) ? color("Emissive", "emissive") : null}
      {HAS_EMISSIVE.has(mat.type) ? slider("Emis. Str", "emissiveIntensity", 0.05, 10) : null}
      {slider("Opacity", "opacity", 0.01, 1)}
      <div className="grid grid-cols-[68px_1fr] items-center gap-1">
        <span className="opacity-60">Transparent</span>
        <input
          type="checkbox"
          className="toggle toggle-xs"
          checked={mat.transparent}
          onChange={(e) => setMat({ transparent: e.target.checked }, true)}
        />
      </div>
    </div>
  );
}

function MaterialCard({
  dto,
  selected,
  onSelect,
  onRename,
}: {
  dto: MaterialDTO;
  selected: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
}) {
  const url = useMaterialThumbnail(dto);
  const [editing, setEditing] = useState(false);
  const typeLabel = MATERIAL_TYPES.find((t) => t.type === dto.type)?.label ?? dto.type;

  return (
    <button
      type="button"
      onClick={onSelect}
      title={typeLabel}
      className={`flex cursor-pointer flex-col items-stretch gap-1 rounded-md border p-1 text-left transition-colors ${
        selected ? "border-primary bg-primary/10" : "border-base-200 hover:border-base-content/25"
      }`}
    >
      <div className="aspect-square w-full overflow-hidden rounded bg-gradient-to-b from-base-300 to-base-100">
        {url ? (
          <img
            src={url}
            alt={dto.name}
            className="h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="h-full w-full animate-pulse bg-base-200" />
        )}
      </div>
      {editing ? (
        <input
          className="input input-xs w-full px-1"
          defaultValue={dto.name}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            onRename(e.target.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span
          className="truncate px-0.5 text-center"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {dto.name}
        </span>
      )}
    </button>
  );
}
