import type { EnvironmentDTO } from "@/types/core";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { NumberDrag } from "@/ui/widgets/NumberDrag";

/**
 * Environment / dome-light panel: edits the document's EnvironmentDTO — IBL
 * source, intensity, Y rotation, and how the viewport background renders.
 * Studio is the built-in painted equirect; HDR/EXR loading arrives next.
 */
export function EnvironmentPanel() {
  const doc = useDocument();
  useSliceVersion("settings"); // re-render on environment:changed
  const env = doc.environment;
  const setNum = (key: keyof EnvironmentDTO, v: number, committed: boolean) =>
    doc.setEnvironment({ [key]: v }, !committed);

  return (
    <div className="h-full overflow-auto bg-base-100 text-xs">
      <fieldset className="fieldset border-b border-base-200 px-2 py-1.5">
        <legend className="fieldset-legend py-1 text-[10px] uppercase opacity-60">
          Environment
        </legend>
        <Row label="Source">
          <select
            className="select select-xs w-full"
            value={env.source}
            onChange={(e) =>
              doc.setEnvironment({ source: e.target.value as EnvironmentDTO["source"] })
            }
          >
            <option value="studio">Studio</option>
          </select>
        </Row>
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
            className="select select-xs w-full"
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
            <input
              type="color"
              className="h-6 w-12 cursor-pointer rounded border border-base-300 bg-base-100"
              value={env.backgroundColor}
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
