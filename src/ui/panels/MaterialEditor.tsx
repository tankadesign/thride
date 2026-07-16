import { useRef } from "react";
import type { MaterialDTO, MaterialType, TextureChannel, Uuid } from "@/types/core";
import {
  HAS_COLOR,
  HAS_EMISSIVE,
  HAS_PBR,
  HAS_PHYSICAL,
  MATERIAL_TYPES,
  PHYSICAL_DEFAULTS as PD,
  TEXTURE_CHANNELS,
} from "@/types/core";
import { UpdateMaterialCommand } from "@/core";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { Row, Section } from "./materialEditor/controls";
import { MapSlot } from "./materialEditor/MapSlot";

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
 *
 * `title` overrides the name header (the Material Manager passes the comma
 * list of a multi-selection); `disabled` grays the sections out and blocks
 * input — a multi-selection has no single value set to edit.
 */
export function MaterialEditor({
  id,
  title,
  disabled = false,
}: {
  id: Uuid;
  title?: string;
  disabled?: boolean;
}) {
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

  // one map slot (image OR noise), rendered inline in the section its channel
  // belongs to (null when the channel doesn't apply to this material type)
  const texSlot = (channel: TextureChannel, label: string) => {
    const meta = TEXTURE_CHANNELS.find((c) => c.channel === channel);
    if (!meta?.applies.has(mat.type)) return null;
    return <MapSlot key={channel} label={label} channel={channel} mat={mat} setMat={setMat} />;
  };
  // Normal map applies to lit non-PBR types too (lambert/phong/toon), which have
  // no Surface section otherwise — show Surface whenever it has something to hold.
  const hasNormalMap = TEXTURE_CHANNELS.some(
    (c) => c.channel === "normalMap" && c.applies.has(mat.type),
  );

  return (
    <div className="flex max-h-[55%] flex-col overflow-auto bg-base-200/40 text-xs">
      <div className="flex-none truncate px-2 py-1.5 font-semibold opacity-80" title={title}>
        {title ?? mat.name}
      </div>
      <fieldset
        disabled={disabled}
        className={`flex min-w-0 flex-col ${disabled ? "pointer-events-none opacity-45" : ""}`}
      >
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
          {texSlot("map", "Color Map")}
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

        {HAS_PBR.has(mat.type) || hasNormalMap ? (
          <Section title="Surface" defaultOpen>
            {HAS_PBR.has(mat.type) ? slider("Roughness", "roughness", 0.01, 1) : null}
            {texSlot("roughnessMap", "Roughness Map")}
            {HAS_PBR.has(mat.type) ? slider("Metalness", "metalness", 0.01, 1) : null}
            {texSlot("metalnessMap", "Metalness Map")}
            {physical
              ? slider("Specular", "specularIntensity", 0.01, 1, PD.specularIntensity)
              : null}
            {physical ? color("Spec. Tint", "specularColor", PD.specularColor) : null}
            {texSlot("normalMap", "Normal Map")}
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
            {texSlot("emissiveMap", "Emissive Map")}
          </Section>
        ) : null}
      </fieldset>
    </div>
  );
}
