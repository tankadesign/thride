import { useRef } from "react";
import { uuidv7 } from "@/core";
import type { EnvironmentDTO } from "@/types/core";
import { textureAssets } from "@/io/storage/textureAssets";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { ColorPicker } from "@/ui/widgets/ColorPicker";

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
  const setNum = (key: keyof EnvironmentDTO, v: number, committed: boolean) =>
    doc.setEnvironment({ [key]: v }, !committed);

  const loadHdr = async (file: File | null) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset = { id: uuidv7(), name: file.name, mime: file.type || "image/vnd.radiance", bytes };
    textureAssets.register(asset);
    doc.setEnvironment({ source: "hdr", hdrAssetId: asset.id });
  };
  const hdrAsset = env.hdrAssetId ? textureAssets.get(env.hdrAssetId) : undefined;

  return (
    <div className="h-full overflow-auto bg-base-100 text-xs">
      <fieldset className="fieldset border-b border-base-200 px-2 py-1.5">
        <legend className="fieldset-legend py-1 text-[10px] uppercase opacity-60">
          Environment
        </legend>
        <Row label="Source">
          <select
            className="select select-md w-full"
            value={env.source}
            onChange={(e) =>
              doc.setEnvironment({ source: e.target.value as EnvironmentDTO["source"] })
            }
          >
            <option value="studio">Studio</option>
            <option value="hdr">HDR / EXR</option>
          </select>
        </Row>
        {env.source === "hdr" ? (
          <Row label="File">
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
          </Row>
        ) : null}
        <Row label="Intensity">
          <NumberDrag
            value={env.intensity}
            step={0.02}
            min={0}
            max={5}
            onChange={(v, c) => setNum("intensity", v, c)}
          />
        </Row>
        <Row label="Rotation">
          <NumberDrag
            value={env.rotation}
            step={1}
            min={-360}
            max={360}
            onChange={(v, c) => setNum("rotation", v, c)}
          />
        </Row>
      </fieldset>

      <fieldset className="fieldset px-2 py-1.5">
        <legend className="fieldset-legend py-1 text-[10px] uppercase opacity-60">
          Background
        </legend>
        <Row label="Mode">
          <select
            className="select select-md w-full"
            value={env.background}
            onChange={(e) =>
              doc.setEnvironment({ background: e.target.value as EnvironmentDTO["background"] })
            }
          >
            <option value="color">Color</option>
            <option value="environment">Environment</option>
            <option value="transparent">Transparent</option>
          </select>
        </Row>
        {env.background === "color" ? (
          <Row label="Color">
            <ColorPicker
              color={env.backgroundColor}
              onChange={(e) => doc.setEnvironment({ backgroundColor: e.target.value })}
            />
          </Row>
        ) : null}
        {env.background === "environment" ? (
          <>
            <Row label="Blur">
              <NumberDrag
                value={env.backgroundBlur}
                step={0.02}
                min={0}
                max={1}
                onChange={(v, c) => setNum("backgroundBlur", v, c)}
              />
            </Row>
            <Row label="Brightness">
              <NumberDrag
                value={env.backgroundIntensity}
                step={0.02}
                min={0}
                max={5}
                onChange={(v, c) => setNum("backgroundIntensity", v, c)}
              />
            </Row>
          </>
        ) : null}
      </fieldset>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-1">
      <span className="opacity-60">{label}</span>
      {children}
    </div>
  );
}
