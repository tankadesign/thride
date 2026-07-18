import { useAtomValue } from "jotai";
import type { PaneDisplay, ShadingMode, ToneMappingMode } from "@/types/editor";
import { appStore } from "@/ui/hooks/doc/document";
import { splineThicknessAtom } from "@/ui/hooks/editor/settings";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";
import { Row, Select, Toggle } from "./controls";
import { CollapsingSection } from "@/ui/panels/CollapsingSection";

/**
 * The View tab of the View Settings modal — how the pane draws the scene, as
 * opposed to what the output graph does to the result afterward (that's the
 * Post Processing tab).
 *
 * Tone Map stays HERE rather than moving to Post Processing: it's the pane's
 * output transform / colour management, a property of how the image is
 * developed, not an effect stacked on top of it.
 */

const SHADING: { value: ShadingMode; label: string }[] = [
  { value: "pbr", label: "PBR" },
  { value: "flat", label: "Flat" },
  { value: "wireframe", label: "Wireframe" },
];
const TONE: { value: ToneMappingMode; label: string }[] = [
  { value: "agx", label: "AgX" },
  { value: "aces", label: "ACES Filmic" },
  { value: "neutral", label: "Neutral" },
];

export function ViewTab({
  pane,
  vs,
  disp,
  set,
}: {
  pane: number;
  vs: ViewportSystem;
  disp: PaneDisplay;
  set: (patch: Partial<PaneDisplay>) => void;
}) {
  const thickness = useAtomValue(splineThicknessAtom);
  const isPbr = disp.shading === "pbr";

  return (
    <>
      <CollapsingSection title="Shading" defaultOpen>
        <Row label="Mode">
          <Select
            value={disp.shading}
            options={SHADING}
            onChange={(v) => set({ shading: v as ShadingMode })}
          />
        </Row>
        <Row label="Tone Map">
          <Select
            value={disp.toneMapping}
            options={TONE}
            disabled={!isPbr}
            onChange={(v) => set({ toneMapping: v as ToneMappingMode })}
          />
        </Row>
        <Toggle
          label="Shadows"
          checked={disp.shadows}
          disabled={!isPbr}
          onChange={(v) => set({ shadows: v })}
        />
        <Toggle
          label="Backfaces"
          checked={disp.backfaces}
          onChange={(v) => set({ backfaces: v })}
        />
      </CollapsingSection>

      <CollapsingSection title="Overlays" defaultOpen>
        <Toggle label="Grid" checked={disp.grid} onChange={(v) => set({ grid: v })} />
        <Toggle label="Main Axis" checked={disp.mainAxis} onChange={(v) => set({ mainAxis: v })} />
        <Toggle
          label="Lines"
          checked={disp.lines}
          disabled={disp.shading === "wireframe"}
          onChange={(v) => set({ lines: v })}
        />
        <Toggle
          label="Hidden Lines"
          checked={disp.hiddenLines}
          disabled={disp.shading === "wireframe" || !disp.lines}
          onChange={(v) => set({ hiddenLines: v })}
        />
        <Row label="Spline px">
          <NumberDrag
            value={thickness}
            step={0.1}
            min={1}
            max={8}
            onChange={(v) => {
              appStore.set(splineThicknessAtom, v);
              vs.setSplineThickness(v);
            }}
          />
        </Row>
      </CollapsingSection>

      <CollapsingSection title="Camera">
        <button
          type="button"
          className="btn btn-xs btn-block"
          onClick={() => vs.resetPaneCamera(pane)}
        >
          Reset Camera PSR
        </button>
      </CollapsingSection>
    </>
  );
}
