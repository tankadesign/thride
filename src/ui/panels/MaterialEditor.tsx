import { useRef, useState } from "react";
import type { MaterialDTO, MaterialType, Uuid } from "@/types/core";
import {
  HAS_COLOR,
  HAS_EMISSIVE,
  HAS_PBR,
  HAS_PHYSICAL,
  MATERIAL_TYPES,
  PHYSICAL_DEFAULTS as PD,
} from "@/types/core";
import { UpdateMaterialCommand } from "@/core";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { NumberDrag } from "@/ui/widgets/NumberDrag";

type NumKey =
  | "roughness"
  | "metalness"
  | "emissiveIntensity"
  | "opacity"
  | "clearcoat"
  | "clearcoatRoughness"
  | "transmission"
  | "ior"
  | "thickness"
  | "sheen"
  | "sheenRoughness"
  | "iridescence"
  | "iridescenceIOR"
  | "specularIntensity";
type ColorKey = "color" | "emissive" | "sheenColor" | "specularColor";

/**
 * Collapsible material attribute editor: every param a three material family
 * exposes, grouped into sections (Base, Surface, Clearcoat, Transmission,
 * Sheen, Iridescence, Emission) gated by type. Slider scrubs are one undo step
 * (preview during drag, UpdateMaterialCommand on release). Optional physical
 * fields fall back to three's defaults until edited.
 */
export function MaterialEditor({ id }: { id: Uuid }) {
  const doc = useDocument();
  useSliceVersion("materials");
  const scrub = useRef<{ before: MaterialDTO } | null>(null);
  const mat = doc.materials.get(id);
  if (!mat) return null;
  const physical = HAS_PHYSICAL.has(mat.type);

  const setMat = (patch: Partial<MaterialDTO>, committed: boolean) => {
    const cur = doc.materials.get(id);
    if (!cur) return;
    scrub.current ??= { before: structuredClone(cur) };
    const after = { ...cur, ...patch };
    doc.updateMaterial(after, !committed);
    if (committed) {
      const before = scrub.current.before;
      scrub.current = null;
      doc.history.pushWithoutExecute(new UpdateMaterialCommand(before, after, "Edit Material"));
    }
  };

  const slider = (label: string, key: NumKey, step: number, max: number, fallback = 0) => (
    <Row label={label} key={key}>
      <NumberDrag
        value={mat[key] ?? fallback}
        step={step}
        min={0}
        max={max}
        onChange={(v, committed) => setMat({ [key]: v }, committed)}
      />
    </Row>
  );

  const color = (label: string, key: ColorKey, fallback = "#ffffff") => (
    <Row label={label} key={key}>
      <input
        type="color"
        className="h-6 w-12 cursor-pointer rounded border border-base-300 bg-base-100"
        value={mat[key] ?? fallback}
        onChange={(e) => setMat({ [key]: e.target.value }, true)}
      />
    </Row>
  );

  return (
    <div className="flex max-h-[55%] flex-col overflow-auto border-t border-base-300 bg-base-200/40 text-xs">
      <div className="truncate px-2 py-1.5 font-semibold opacity-80">{mat.name}</div>

      <Section title="Base" defaultOpen>
        <Row label="Type">
          <select
            className="select select-xs w-full"
            value={mat.type}
            onChange={(e) => setMat({ type: e.target.value as MaterialType }, true)}
          >
            {MATERIAL_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        </Row>
        {HAS_COLOR.has(mat.type) ? color("Color", "color") : null}
        {slider("Opacity", "opacity", 0.01, 1, 1)}
        <Row label="Transparent">
          <input
            type="checkbox"
            className="toggle toggle-xs"
            checked={mat.transparent}
            onChange={(e) => setMat({ transparent: e.target.checked }, true)}
          />
        </Row>
      </Section>

      {HAS_PBR.has(mat.type) ? (
        <Section title="Surface" defaultOpen>
          {slider("Roughness", "roughness", 0.01, 1)}
          {slider("Metalness", "metalness", 0.01, 1)}
          {physical ? slider("Specular", "specularIntensity", 0.01, 1, PD.specularIntensity) : null}
          {physical ? color("Spec. Tint", "specularColor", PD.specularColor) : null}
        </Section>
      ) : null}

      {physical ? (
        <Section title="Clearcoat">
          {slider("Clearcoat", "clearcoat", 0.01, 1)}
          {slider("Roughness", "clearcoatRoughness", 0.01, 1)}
        </Section>
      ) : null}

      {physical ? (
        <Section title="Transmission">
          {slider("Transmission", "transmission", 0.01, 1)}
          {slider("IOR", "ior", 0.01, 2.5, PD.ior)}
          {slider("Thickness", "thickness", 0.02, 5)}
        </Section>
      ) : null}

      {physical ? (
        <Section title="Sheen">
          {slider("Sheen", "sheen", 0.01, 1)}
          {slider("Roughness", "sheenRoughness", 0.01, 1, PD.sheenRoughness)}
          {color("Color", "sheenColor", PD.sheenColor)}
        </Section>
      ) : null}

      {physical ? (
        <Section title="Iridescence">
          {slider("Iridescence", "iridescence", 0.01, 1)}
          {slider("IOR", "iridescenceIOR", 0.01, 2.5, PD.iridescenceIOR)}
        </Section>
      ) : null}

      {HAS_EMISSIVE.has(mat.type) ? (
        <Section title="Emission">
          {color("Emissive", "emissive", "#000000")}
          {slider("Strength", "emissiveIntensity", 0.05, 10, 1)}
        </Section>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[74px_1fr] items-center gap-1">
      <span className="opacity-60">{label}</span>
      {children}
    </div>
  );
}

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-base-300/60 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-base-300/40"
      >
        <span className={`text-[8px] opacity-60 transition-transform ${open ? "rotate-90" : ""}`}>
          ▶
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {title}
        </span>
      </button>
      {open ? <div className="flex flex-col gap-1.5 px-2 pb-2">{children}</div> : null}
    </div>
  );
}
