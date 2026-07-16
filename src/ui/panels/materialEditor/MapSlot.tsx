import { useEffect, useRef, useState } from "react";
import type { MaterialDTO, Projection, TextureChannel, Uuid } from "@/types/core";
import {
  PROJECTIONS,
  TEXTURE_TO_PROCEDURAL,
  channelLayer,
  defaultLayer,
  defaultRamp,
  withChannelLayer,
} from "@/types/core";
import { uuidv7 } from "@/core";
import { IconClose } from "@/icons";
import { noiseDef } from "@/materials/noises";
import { textureAssets } from "@/io/storage/textureAssets";
import { useLayerPreview } from "./noisePreview";
import { NoiseEditor } from "./NoiseEditor";
import { Row } from "./controls";

/**
 * One map channel's slot — the place an image OR a noise plugs into a material
 * channel (never both; assigning one clears the other).
 *
 * Empty: two buttons, `Image` (file dialog, as before) and `Noise` (creates a
 * default fractal layer and opens its editor). Filled: a live thumbnail chip +
 * source name + ✕. An image chip re-opens the file picker; a noise chip (or its
 * name) toggles the inline {@link NoiseEditor} under the row.
 */
export function MapSlot({
  label,
  channel,
  mat,
  setMat,
}: {
  label: string;
  channel: TextureChannel;
  mat: MaterialDTO;
  setMat: (patch: Partial<MaterialDTO>, committed: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const procChannel = TEXTURE_TO_PROCEDURAL[channel];
  const assetId = mat.textures?.[channel];
  const noise = channelLayer(mat.procedural, procChannel);
  const [open, setOpen] = useState(false);

  const imageUrl = useAssetUrl(assetId);
  const noiseUrl = useLayerPreview(noise);

  const addImage = async (file: File | null) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset = { id: uuidv7(), name: file.name, mime: file.type || "image/png", bytes };
    textureAssets.register(asset);
    setMat(
      {
        textures: { ...mat.textures, [channel]: asset.id },
        procedural: withChannelLayer(mat.procedural, procChannel, null),
      },
      true,
    );
  };

  const addNoise = () => {
    const layer = defaultLayer(uuidv7(), "fractal");
    layer.color = "#ffffff"; // full-strength value; the ramp/channel does the coloring
    if (procChannel === "color" || procChannel === "emissive") layer.ramp = defaultRamp();
    const textures = { ...mat.textures };
    delete textures[channel];
    setMat({ textures, procedural: withChannelLayer(mat.procedural, procChannel, layer) }, true);
    setOpen(true);
  };

  const removeNoise = () =>
    setMat({ procedural: withChannelLayer(mat.procedural, procChannel, null) }, true);

  const clearImage = () => {
    const textures = { ...mat.textures };
    delete textures[channel];
    const textureProjections = { ...mat.textureProjections };
    delete textureProjections[channel];
    setMat({ textures, textureProjections }, true);
  };

  const setImageProjection = (projection: Projection) => {
    const textureProjections = { ...mat.textureProjections };
    if (projection === "uv")
      delete textureProjections[channel]; // uv is the default
    else textureProjections[channel] = projection;
    setMat({ textureProjections }, true);
  };

  const filePicker = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        void addImage(e.target.files?.[0] ?? null);
        e.target.value = ""; // allow re-picking the same file
      }}
    />
  );

  if (noise) {
    return (
      <>
        <Row label={label}>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="h-7 w-7 flex-none overflow-hidden rounded border border-base-300 bg-base-100"
              onClick={() => setOpen((o) => !o)}
              title={open ? "Collapse noise settings" : "Edit noise"}
            >
              {noiseUrl ? (
                <img src={noiseUrl} alt="" className="h-full w-full object-cover" />
              ) : null}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs min-w-0 flex-1 justify-start truncate px-1 font-normal"
              onClick={() => setOpen((o) => !o)}
            >
              {noiseDef(noise.source)?.label ?? noise.source}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs px-1 opacity-60"
              onClick={removeNoise}
              title="Remove noise"
            >
              <IconClose size={11} />
            </button>
          </div>
        </Row>
        {open ? (
          <NoiseEditor
            layer={noise}
            channel={procChannel}
            onChange={(next, committed) =>
              setMat({ procedural: withChannelLayer(mat.procedural, procChannel, next) }, committed)
            }
          />
        ) : null}
      </>
    );
  }

  if (assetId) {
    // tangent-space normal maps only make sense in a UV frame — no projection row
    const projectable = channel !== "normalMap";
    const projection = mat.textureProjections?.[channel] ?? "uv";
    return (
      <>
        <Row label={label}>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="flex h-7 w-7 flex-none items-center justify-center overflow-hidden rounded border border-base-300 bg-base-100"
              onClick={() => inputRef.current?.click()}
              title="Replace image"
            >
              {imageUrl ? (
                <img src={imageUrl} alt="" className="h-full w-full object-cover" />
              ) : null}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs min-w-0 flex-1 justify-start truncate px-1 font-normal"
              onClick={() => projectable && setOpen((o) => !o)}
              title={projectable ? "Image settings" : undefined}
            >
              {textureAssets.get(assetId)?.name ?? "Image"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs px-1 opacity-60"
              onClick={clearImage}
              title="Clear"
            >
              <IconClose size={11} />
            </button>
            {filePicker}
          </div>
        </Row>
        {open && projectable ? (
          <div className="flex flex-col gap-1.5 border-l border-base-300/60 pl-2">
            <Row label="Projection">
              <select
                className="select select-xs w-full"
                value={projection}
                onChange={(e) => setImageProjection(e.target.value as Projection)}
              >
                {PROJECTIONS.map((p) => (
                  <option key={p.projection} value={p.projection}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Row>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <Row label={label}>
      <div className="flex gap-1">
        <button
          type="button"
          className="btn btn-outline btn-xs flex-1"
          onClick={() => inputRef.current?.click()}
        >
          Image
        </button>
        <button type="button" className="btn btn-outline btn-xs flex-1" onClick={addNoise}>
          Noise
        </button>
        {filePicker}
      </div>
    </Row>
  );
}

/** Object URL for a registered texture asset's preview (revoked on change/unmount). */
function useAssetUrl(assetId: Uuid | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const asset = assetId ? textureAssets.get(assetId) : undefined;
    if (!asset) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [assetId]);
  return url;
}
