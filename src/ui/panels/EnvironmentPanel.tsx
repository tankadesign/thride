import { useRef } from "react";
import { uuidv7 } from "@/core";
import type { EnvironmentDTO } from "@/types/core";
import { SetEnvironmentCommand } from "@/core/history/commands/settings";
import { textureAssets } from "@/io/storage/textureAssets";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { ColorPicker } from "@/ui/widgets/ColorPicker";
import { Field, Section } from "../widgets/inspector";

/**
 * Environment / dome-light panel: edits the document's EnvironmentDTO — IBL
 * source, intensity, Y rotation, and how the viewport background renders.
 * Studio is the built-in painted equirect; HDR/EXR loads a `.hdr`/`.exr`
 * equirect into the texture-asset store (the render layer decodes it).
 */
export function EnvironmentPanel() {
  const doc = useDocument();
  useSliceVersion("settings"); // re-render on environment:changed
  const env = doc.environment;
  const fileRef = useRef<HTMLInputElement>(null);
  // NumberDrag scrub: previews apply live (no history); the commit records ONE
  // undo step, capturing the pre-drag environment at the first preview.
  const scrub = useRef<EnvironmentDTO | null>(null);
  const setNum = (key: keyof EnvironmentDTO, v: number, committed: boolean) => {
    scrub.current ??= { ...doc.environment };
    if (!committed) {
      doc.setEnvironment({ [key]: v }, true); // preview
      return;
    }
    const before = scrub.current;
    scrub.current = null;
    doc.setEnvironment({ [key]: v });
    doc.history.pushWithoutExecute(new SetEnvironmentCommand({ ...doc.environment }, before));
  };
  /** Discrete/immediate env edit as one undo step (mergeable = coalesce a rapid
   *  run, e.g. dragging the color picker; false = a distinct step per change). */
  const setEnv = (patch: Partial<EnvironmentDTO>, mergeable = false) => {
    const before = { ...doc.environment };
    doc.history.run(
      new SetEnvironmentCommand({ ...before, ...patch }, before, "Edit Environment", mergeable),
    );
  };

  const loadHdr = async (file: File | null) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset = { id: uuidv7(), name: file.name, mime: file.type || "image/vnd.radiance", bytes };
    textureAssets.register(asset);
    setEnv({ source: "hdr", hdrAssetId: asset.id });
  };
  const hdrAsset = env.hdrAssetId ? textureAssets.get(env.hdrAssetId) : undefined;

  return (
    <div className="h-full overflow-auto bg-base-100 text-xs py-2">
      <Section title="HDR">
        <Field label="Source">
          <select
            className="select select-sm w-full"
            value={env.source}
            onChange={(e) => setEnv({ source: e.target.value as EnvironmentDTO["source"] })}
          >
            <option value="studio">Default HDR</option>
            <option value="hdr">User HDR / EXR</option>
          </select>
        </Field>
        {env.source === "hdr" ? (
          <Field label="File">
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                className="btn btn-xs shrink-0"
                onClick={() => fileRef.current?.click()}
              >
                Load…
              </button>
              <span className="truncate opacity-60" title={hdrAsset?.name}>
                {hdrAsset?.name ?? "No file"}
              </span>
              <input
                ref={fileRef}
                type="file"
                accept=".hdr,.exr,image/vnd.radiance,image/x-exr"
                className="hidden"
                onChange={(e) => {
                  void loadHdr(e.target.files?.[0] ?? null);
                  e.target.value = ""; // allow re-picking the same file
                }}
              />
            </div>
          </Field>
        ) : null}
        <Field label="Intensity">
          <NumberDrag
            value={env.intensity}
            step={0.02}
            min={0}
            max={5}
            onChange={(v, c) => setNum("intensity", v, c)}
          />
        </Field>
        <Field label="Rotation">
          <NumberDrag
            value={env.rotation}
            step={1}
            min={-360}
            max={360}
            onChange={(v, c) => setNum("rotation", v, c)}
          />
        </Field>
      </Section>

      <Section title="Background">
        <Field label="Mode">
          <select
            className="select select-sm w-full"
            value={env.background}
            onChange={(e) => setEnv({ background: e.target.value as EnvironmentDTO["background"] })}
          >
            <option value="color">Color</option>
            <option value="environment">Environment</option>
            <option value="transparent">Transparent</option>
          </select>
        </Field>
        {env.background === "color" ? (
          <Field label="Color">
            <ColorPicker
              color={env.backgroundColor}
              onChange={(e) => setEnv({ backgroundColor: e.target.value }, true)}
            />
          </Field>
        ) : null}
        {env.background === "environment" ? (
          <>
            <Field label="Blur">
              <NumberDrag
                value={env.backgroundBlur}
                step={0.02}
                min={0}
                max={1}
                onChange={(v, c) => setNum("backgroundBlur", v, c)}
              />
            </Field>
            <Field label="Brightness">
              <NumberDrag
                value={env.backgroundIntensity}
                step={0.02}
                min={0}
                max={5}
                onChange={(v, c) => setNum("backgroundIntensity", v, c)}
              />
            </Field>
          </>
        ) : null}
      </Section>
    </div>
  );
}
