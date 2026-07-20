import type { PaneDisplay } from "@/types/editor";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { Row, Select, Toggle } from "./controls";
import { ViewSettingsSection } from "./ViewSettingsSection";

/**
 * The Post Processing tab of the View Settings modal (chunk C6).
 *
 * Everything that runs in the output graph after the scene render lives here —
 * Ambient Shadows and Reflections moved in from the Shading tab, joining bloom,
 * chromatic aberration and vignette. Tone mapping deliberately stays on the
 * Shading tab: it's the pane's output transform / color management, not an
 * effect you stack.
 *
 * Section order mirrors the actual pipeline order in `DitherOutput`: AO and
 * reflections composite into the lit image, bloom is applied in HDR, then tone
 * mapping (elsewhere), then the display-space lens effects.
 */

const SSR_MODE: { value: "fast" | "high"; label: string }[] = [
  { value: "fast", label: "Fast (mirror)" },
  { value: "high", label: "High (temporal)" },
];

/** AO "Strength" ↔ neutral tint darkness: 0 = none (#ffffff), 1 = full (#000000). */
const aoStrength = (hex: string): number => {
  const v = Number.parseInt(hex.slice(1, 3), 16);
  return Number.isFinite(v) ? 1 - v / 255 : 1;
};
const aoTint = (s: number): string => {
  const h = Math.round((1 - Math.min(1, Math.max(0, s))) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${h}${h}${h}`;
};

export function PostProcessingTab({
  disp,
  set,
}: {
  disp: PaneDisplay;
  set: (patch: Partial<PaneDisplay>) => void;
}) {
  const isPbr = disp.shading === "pbr";
  const isWire = disp.shading === "wireframe";

  return (
    <>
      <ViewSettingsSection title="Ambient Shadows" defaultOpen>
        <Toggle
          label="Enabled"
          checked={disp.ssao}
          disabled={isWire}
          onChange={(v) => set({ ssao: v })}
        />
        <Row label="Radius">
          <NumberDrag
            value={disp.aoRadius}
            step={0.02}
            min={0.01}
            max={10}
            onChange={(v) => set({ aoRadius: v })}
          />
        </Row>
        <Row label="Thickness">
          <NumberDrag
            value={disp.aoBias}
            step={0.02}
            min={0.01}
            max={5}
            onChange={(v) => set({ aoBias: v })}
          />
        </Row>
        <Row label="Quality">
          <NumberDrag
            value={disp.aoSamples}
            step={1}
            integer
            min={4}
            max={32}
            onChange={(v) => set({ aoSamples: v })}
          />
        </Row>
        <Row label="Falloff">
          <NumberDrag
            value={disp.aoFalloff}
            step={0.02}
            min={0}
            max={1}
            onChange={(v) => set({ aoFalloff: v })}
          />
        </Row>
        <Row label="Distance Exp">
          <NumberDrag
            value={disp.aoDistanceExp}
            step={0.05}
            min={0.1}
            max={4}
            onChange={(v) => set({ aoDistanceExp: v })}
          />
        </Row>
        <Row label="Contrast">
          <NumberDrag
            value={disp.aoScale}
            step={0.05}
            min={0.1}
            max={4}
            onChange={(v) => set({ aoScale: v })}
          />
        </Row>
        <Row label="Resolution">
          <NumberDrag
            value={disp.aoResolution}
            step={0.05}
            min={0.25}
            max={1}
            onChange={(v) => set({ aoResolution: v })}
          />
        </Row>
        <Row label="Strength">
          <NumberDrag
            value={aoStrength(disp.aoTint)}
            step={0.02}
            min={0}
            max={1}
            onChange={(v) => set({ aoTint: aoTint(v) })}
          />
        </Row>
      </ViewSettingsSection>

      <ViewSettingsSection title="Reflections">
        <Toggle
          label="Enabled"
          checked={disp.ssr}
          disabled={!isPbr}
          onChange={(v) => set({ ssr: v })}
        />
        <Row label="Mode">
          <Select
            value={disp.ssrMode}
            options={SSR_MODE}
            disabled={!isPbr}
            onChange={(v) => set({ ssrMode: v as "fast" | "high" })}
          />
        </Row>
        <Row label="Max Distance">
          <NumberDrag
            value={disp.ssrMaxDistance}
            step={0.1}
            min={0.1}
            max={100}
            onChange={(v) => set({ ssrMaxDistance: v })}
          />
        </Row>
        <Row label="Thickness">
          <NumberDrag
            value={disp.ssrThickness}
            step={0.01}
            min={0.001}
            max={5}
            onChange={(v) => set({ ssrThickness: v })}
          />
        </Row>
        <Row label="Intensity">
          <NumberDrag
            value={disp.ssrIntensity}
            step={0.05}
            min={0}
            max={5}
            onChange={(v) => set({ ssrIntensity: v })}
          />
        </Row>
        <Row label={disp.ssrMode === "high" ? "Rays" : "Quality"}>
          <NumberDrag
            value={disp.ssrQuality}
            step={0.02}
            min={0}
            max={1}
            onChange={(v) => set({ ssrQuality: v })}
          />
        </Row>
        <Row label="Edge Fade">
          <NumberDrag
            value={disp.ssrEdgeFade}
            step={0.02}
            min={0}
            max={1}
            onChange={(v) => set({ ssrEdgeFade: v })}
          />
        </Row>
        <Row label="Max Luminance">
          <NumberDrag
            value={disp.ssrMaxLuminance}
            step={0.5}
            min={0.5}
            max={100}
            onChange={(v) => set({ ssrMaxLuminance: v })}
          />
        </Row>
        <Row label="Resolution">
          <NumberDrag
            value={disp.ssrResolution}
            step={0.05}
            min={0.25}
            max={1}
            onChange={(v) => set({ ssrResolution: v })}
          />
        </Row>
        {disp.ssrMode === "high" ? (
          <>
            <Row label="Denoise">
              <NumberDrag
                value={disp.ssrDenoise}
                step={0.02}
                min={0}
                max={1}
                onChange={(v) => set({ ssrDenoise: v })}
              />
            </Row>
            <Row label="Max Frames">
              <NumberDrag
                value={disp.ssrMaxFrames}
                step={1}
                integer
                min={1}
                max={128}
                onChange={(v) => set({ ssrMaxFrames: v })}
              />
            </Row>
          </>
        ) : (
          <>
            <Toggle
              label="Reflect Non-Metals"
              checked={disp.ssrReflectNonMetals}
              disabled={!isPbr}
              onChange={(v) => set({ ssrReflectNonMetals: v })}
            />
            <Row label="Blur Quality">
              <NumberDrag
                value={disp.ssrBlurQuality}
                step={1}
                integer
                min={1}
                max={3}
                onChange={(v) => set({ ssrBlurQuality: v })}
              />
            </Row>
            <Row label="Roughness Fade">
              <NumberDrag
                value={disp.ssrRoughnessFade}
                step={0.02}
                min={0}
                max={1}
                onChange={(v) => set({ ssrRoughnessFade: v })}
              />
            </Row>
          </>
        )}
      </ViewSettingsSection>

      <ViewSettingsSection title="Bloom">
        <Toggle
          label="Enabled"
          checked={disp.bloom}
          disabled={isWire}
          onChange={(v) => set({ bloom: v })}
        />
        <Row label="Threshold">
          <NumberDrag
            value={disp.bloomThreshold}
            step={0.02}
            min={0}
            max={4}
            onChange={(v) => set({ bloomThreshold: v })}
          />
        </Row>
        <Row label="Strength">
          <NumberDrag
            value={disp.bloomStrength}
            step={0.02}
            min={0}
            max={3}
            onChange={(v) => set({ bloomStrength: v })}
          />
        </Row>
        <Row label="Radius">
          <NumberDrag
            value={disp.bloomRadius}
            step={0.02}
            min={0}
            max={1}
            onChange={(v) => set({ bloomRadius: v })}
          />
        </Row>
      </ViewSettingsSection>

      <ViewSettingsSection title="Depth of Field">
        <Toggle
          label="Enabled"
          checked={disp.dof}
          disabled={!isPbr}
          onChange={(v) => set({ dof: v })}
        />
        <Row label="Focal Range">
          <NumberDrag
            value={disp.dofFocalLength}
            step={0.05}
            min={0.01}
            max={50}
            onChange={(v) => set({ dofFocalLength: v })}
          />
        </Row>
        <Row label="Bokeh">
          <NumberDrag
            value={disp.dofBokeh}
            step={0.1}
            min={0}
            max={20}
            onChange={(v) => set({ dofBokeh: v })}
          />
        </Row>
      </ViewSettingsSection>

      <ViewSettingsSection title="Chromatic Aberration">
        <Toggle
          label="Enabled"
          checked={disp.chromatic}
          disabled={isWire}
          onChange={(v) => set({ chromatic: v })}
        />
        <Row label="Amount">
          <NumberDrag
            value={disp.chromaticAmount}
            step={0.05}
            min={0}
            max={10}
            onChange={(v) => set({ chromaticAmount: v })}
          />
        </Row>
      </ViewSettingsSection>

      <ViewSettingsSection title="Vignette">
        <Toggle
          label="Enabled"
          checked={disp.vignette}
          disabled={isWire}
          onChange={(v) => set({ vignette: v })}
        />
        <Row label="Amount">
          <NumberDrag
            value={disp.vignetteAmount}
            step={0.02}
            min={0}
            max={1}
            onChange={(v) => set({ vignetteAmount: v })}
          />
        </Row>
        <Row label="Radius">
          <NumberDrag
            value={disp.vignetteRadius}
            step={0.02}
            min={0}
            max={0.99}
            onChange={(v) => set({ vignetteRadius: v })}
          />
        </Row>
      </ViewSettingsSection>
    </>
  );
}
