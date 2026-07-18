import { useEffect, useRef, useState } from "react";
import { useAtom } from "jotai";
import type { Document } from "@/core";
import {
  CreateMaterialCommand,
  DeleteMaterialCommand,
  UpdateMaterialCommand,
  uuidv7,
} from "@/core";
import type { MaterialDTO, Uuid } from "@/types/core";
import { defaultMaterialData, MATERIAL_TYPES } from "@/types/core";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import {
  MATERIAL_DND_MIME,
  selectedMaterialsAtom,
  useMaterialThumbnail,
} from "@/ui/hooks/editor/materials";
import { MaterialEditor } from "./MaterialEditor";

function uniqueMaterialName(doc: Document): string {
  const names = new Set(doc.materials.all().map((m) => m.name));
  if (!names.has("Material")) return "Material";
  let n = 1;
  while (names.has(`Material.${n}`)) n++;
  return `Material.${n}`;
}

/**
 * Material Manager (View → Material Manager): the project material library as a
 * grid of C4D-style sphere thumbnails. New defaults to Physical (double-click
 * the grid background also creates one, C4D-style). Click selects; ⌘-click
 * toggles, ⇧-click extends a range, clicking the background deselects, Delete
 * over the grid removes the selection. A single selection edits in the
 * attributes below; a multi selection lists its names there, attributes
 * disabled. Drag a thumbnail onto an object to assign. Names edit on
 * double-click.
 */
export function MaterialManagerPanel() {
  const doc = useDocument();
  useSliceVersion("materials"); // re-render on any library change
  const [selected, setSelected] = useAtom(selectedMaterialsAtom);
  const materials = doc.materials.all();
  /** Range anchor for ⇧-click (last plain/⌘ clicked card). */
  const anchor = useRef<Uuid | null>(null);
  /** Pointer over the thumbnail grid — gates the Delete key. */
  const hoverGrid = useRef(false);
  // live ref of the selection for the once-attached keydown handler below —
  // written in an effect, not during render (react-hooks/refs).
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  });

  // stale ids linger in the atom after undo of a create — resolve against the
  // live library everywhere below
  const live = selected.filter((id) => doc.materials.has(id));

  const create = () => {
    const dto: MaterialDTO = {
      id: uuidv7(),
      name: uniqueMaterialName(doc),
      ...defaultMaterialData("physical"),
    };
    doc.history.run(new CreateMaterialCommand(dto));
    setSelected([dto.id]);
    anchor.current = dto.id;
  };

  const removeSelected = () => {
    const ids = selectedRef.current.filter((id) => doc.materials.has(id));
    if (ids.length === 0) return;
    doc.history.transact(`Delete Material${ids.length > 1 ? "s" : ""}`, () => {
      for (const id of ids) {
        const m = doc.materials.get(id);
        if (m) doc.history.run(new DeleteMaterialCommand(m));
      }
    });
    setSelected([]);
  };

  // Delete/Backspace while the pointer is over the grid removes the selection.
  // Capture phase so the Shell's global shortcut handler (edit.delete — scene
  // objects) never sees the consumed key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hoverGrid.current || (e.key !== "Delete" && e.key !== "Backspace")) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (selectedRef.current.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      removeSelected();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- attach the global listener once; it reads the latest selection through refs
  }, []);

  const rename = (id: Uuid, name: string) => {
    const before = doc.materials.get(id);
    if (!before || !name.trim() || name === before.name) return;
    doc.history.run(
      new UpdateMaterialCommand(before, { ...before, name: name.trim() }, "Rename Material"),
    );
  };

  const onCardClick = (e: React.MouseEvent, id: Uuid) => {
    if (e.shiftKey && anchor.current) {
      const ids = materials.map((m) => m.id);
      const a = ids.indexOf(anchor.current);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        setSelected(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      setSelected(live.includes(id) ? live.filter((x) => x !== id) : [...live, id]);
    } else {
      setSelected([id]);
    }
    anchor.current = id;
  };

  const names = live.map((id) => doc.materials.get(id)?.name ?? "").filter(Boolean);

  return (
    <div className="flex h-full flex-col bg-base-100 text-xs">
      <div className="flex items-center gap-1 border-b border-base-200 px-2 py-1.5">
        <button type="button" className="btn btn-outline btn-primary btn-xs" onClick={create}>
          New
        </button>
        <button
          type="button"
          className="btn btn-soft btn-xs"
          disabled={live.length === 0}
          onClick={removeSelected}
        >
          Delete
        </button>
        <span className="ml-auto opacity-50">
          {materials.length} material{materials.length === 1 ? "" : "s"}
        </span>
      </div>
      <div
        className="dot-bg grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(88px,1fr))] content-start gap-2 overflow-auto p-2 max-h-80"
        onPointerEnter={() => {
          hoverGrid.current = true;
        }}
        onPointerLeave={() => {
          hoverGrid.current = false;
        }}
        onClick={(e) => {
          // background (not a card) click deselects
          if (e.target === e.currentTarget) setSelected([]);
        }}
        onDoubleClick={(e) => {
          // C4D: double-click the empty grid to add a material
          if (e.target === e.currentTarget) create();
        }}
      >
        {materials.map((m) => (
          <MaterialCard
            key={m.id}
            dto={m}
            selected={live.includes(m.id)}
            onSelect={(e) => onCardClick(e, m.id)}
            onRename={(name) => rename(m.id, name)}
          />
        ))}
        {materials.length === 0 ? (
          <div className="col-span-full p-8 text-center opacity-40 pointer-events-none select-none">
            No materials yet — click <span className="font-semibold">New</span> or double-click
            here.
          </div>
        ) : null}
      </div>
      {live.length === 1 ? (
        <>
          <div className="divider my-0 h-2 flex-none" />
          <MaterialEditor id={live[0]!} />
        </>
      ) : null}
      {live.length > 1 ? (
        <>
          <div className="divider my-0 h-2 flex-none" />
          <MaterialEditor id={live[0]!} title={names.join(", ")} disabled />
        </>
      ) : null}
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
  onSelect: (e: React.MouseEvent) => void;
  onRename: (name: string) => void;
}) {
  const url = useMaterialThumbnail(dto);
  const [editing, setEditing] = useState(false);
  const typeLabel = MATERIAL_TYPES.find((t) => t.type === dto.type)?.label ?? dto.type;

  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${typeLabel} — drag onto an object to assign`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MATERIAL_DND_MIME, dto.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`flex cursor-pointer flex-col items-stretch gap-1 rounded-md border p-1 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/10"
          : "border-transparent hover:border-base-content/25"
      }`}
    >
      <div className="aspect-square w-full overflow-hidden rounded from-base-300 to-base-100">
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
