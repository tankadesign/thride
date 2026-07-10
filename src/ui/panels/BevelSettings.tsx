import { useAtom } from "jotai";
import type { BevelToolMode } from "@/types/editor";
import { bevelParamsAtom } from "@/ui/hooks/editor/viewport";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";

const MODES: { value: BevelToolMode; label: string }[] = [
  { value: "chamfer", label: "Chamfer" },
  { value: "straight", label: "Straight" },
];

/**
 * Floating settings card for the live edge-bevel tool (C4D-style): shown while
 * the tool is active, edits the shared bevel params which the BevelTool
 * rebuilds from on every change. Apply bakes one undo step; Cancel restores.
 */
export function BevelSettings({ vs }: { vs: ViewportSystem }) {
  const [params, setParams] = useAtom(bevelParamsAtom);

  return (
    <div className="absolute top-2 left-2 z-10 w-52 rounded-box border border-base-300 bg-base-200/95 p-2 shadow-lg backdrop-blur">
      <div className="mb-1.5 px-0.5 font-semibold text-[11px] opacity-70">Bevel</div>
      <div className="join w-full">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            className={`btn btn-xs join-item flex-1 ${params.mode === m.value ? "btn-primary" : ""}`}
            onClick={() => setParams((p) => ({ ...p, mode: m.value }))}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        <Row label="Width">
          <NumberDrag
            value={params.width}
            min={0}
            step={0.005}
            onChange={(v) => setParams((p) => ({ ...p, width: v }))}
          />
        </Row>
        <Row label="Segments">
          <NumberDrag
            value={params.segments}
            min={1}
            max={32}
            step={0.1}
            integer
            onChange={(v) => setParams((p) => ({ ...p, segments: v }))}
          />
        </Row>
        <Row label="Angle°">
          <NumberDrag
            value={params.angleDeg}
            min={0}
            max={180}
            step={0.5}
            onChange={(v) => setParams((p) => ({ ...p, angleDeg: v }))}
          />
        </Row>
      </div>
      <div className="mt-2 flex gap-1">
        <button
          type="button"
          className="btn btn-primary btn-xs flex-1"
          onClick={() => vs.bevelTool.commit()}
        >
          Apply
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => vs.bevelTool.cancel()}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[10px] opacity-60">{label}</span>
      {children}
    </label>
  );
}
