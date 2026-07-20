import { useRef } from "react";
import type { Uuid } from "@/types/core";
import { type CameraDataDTO, defaultCameraData } from "@/types/core/camera";
import { SetNodeDataCommand } from "@/core/history/commands/scene";
import { useDocument } from "@/ui/hooks/doc/document";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { Field, Section } from "@/ui/widgets/inspector";

/**
 * Camera lens editor: field of view, clip range, film back (gauge/offset),
 * zoom, and focus. Perspective only for now (see CameraDataDTO). A pane "looks
 * through" this node, applying these values to its rig; editing fov also
 * reshapes the viewport frustum helper. Focus feeds depth of field: a focus
 * target object (its distance) supersedes the manual focus distance.
 */
export function CameraParams({ id, camera }: { id: Uuid; camera: CameraDataDTO }) {
  const doc = useDocument();
  const scrub = useRef<{ before: Record<string, unknown> } | null>(null);
  // legacy cameras stored only fov/near/far — fill the rest from defaults
  const c = { ...defaultCameraData(), ...camera };

  const setCamera = (patch: Partial<CameraDataDTO>, committed: boolean) => {
    const node = doc.scene.mustGet(id);
    scrub.current ??= { before: structuredClone(node.data!) };
    const data = structuredClone(node.data!);
    data.camera = { ...defaultCameraData(), ...(data.camera as CameraDataDTO), ...patch };
    if (committed) {
      const before = scrub.current.before;
      scrub.current = null;
      doc.setNodeData(id, data, true);
      doc.history.pushWithoutExecute(new SetNodeDataCommand(id, data, before, "Edit Camera"));
    } else {
      doc.setNodeData(id, data, true);
    }
  };

  const num = (
    label: string,
    key: "fov" | "near" | "far" | "filmGauge" | "filmOffset" | "zoom" | "focus",
    step: number,
    min?: number,
    max?: number,
    postfix?: string,
  ) => (
    <Field label={label} key={key}>
      <NumberDrag
        value={c[key]}
        step={step}
        min={min}
        max={max}
        postfix={postfix}
        onChange={(v, committed) => setCamera({ [key]: v }, committed)}
      />
    </Field>
  );

  // focus-target candidates: any other object (its distance drives DOF focus)
  const candidates = doc.scene.toDTO().filter((n) => n.id !== id);
  const focusTarget = c.focusTarget ?? "";

  return (
    <Section title="Camera">
      {num("FOV", "fov", 0.2, 1, 179, "deg")}
      {num("Near", "near", 0.01, 0.001)}
      {num("Far", "far", 1, c.near + 0.001)}
      {num("Film Gauge", "filmGauge", 0.5, 1)}
      {num("Film Offset", "filmOffset", 0.1)}
      {num("Zoom", "zoom", 0.01, 0.01)}
      <Field label="Focus Obj">
        <select
          className="select select-sm w-full"
          value={focusTarget}
          onChange={(e) => setCamera({ focusTarget: e.target.value || undefined }, true)}
        >
          <option value="">None</option>
          {candidates.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </Field>
      {/* manual focus distance — shown only when no focus object drives it */}
      {c.focusTarget ? null : num("Focus Dist", "focus", 0.05, 0.001)}
    </Section>
  );
}
