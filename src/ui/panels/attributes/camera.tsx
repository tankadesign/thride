import { useRef, useState } from "react";
import type { Uuid } from "@/types/core";
import {
  type CameraDataDTO,
  defaultCameraData,
  focalLengthFromHFov,
  hFovFromFocalLength,
} from "@/types/core/camera";
import { SetNodeDataCommand } from "@/core/history/commands/scene";
import { useDocument } from "@/ui/hooks/doc/document";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { Field, Section } from "@/ui/widgets/inspector";

/**
 * Camera lens editor (C4D/Blender-style): a focal length against a fixed
 * full-frame sensor, plus X/Y film offset, clip range, zoom, and focus. A pane
 * "looks through" this node, applying the lens to its rig (three's
 * PerspectiveCamera does the focal-length↔fov math); editing it reshapes the
 * viewport frustum helper. Focus feeds depth of field — a focus target object
 * (its distance) supersedes the manual focus distance.
 */
export function CameraParams({ id, camera }: { id: Uuid; camera: CameraDataDTO }) {
  const doc = useDocument();
  const scrub = useRef<{ before: Record<string, unknown> } | null>(null);
  // fields added after a camera was created fall back to defaults
  const c = { ...defaultCameraData(), ...camera };
  // the lens field shows Focal Length by default; clicking its label toggles to
  // FOV (horizontal, aspect-independent for the fixed sensor). Same DTO either way.
  const [lensMode, setLensMode] = useState<"focal" | "fov">("focal");

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
    key: "near" | "far" | "zoom" | "focus" | "filmOffsetX" | "filmOffsetY",
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
      {/* Lens: Focal Length ↔ FOV. The label is a plain button (same look) that
          toggles which representation you edit; both write back focalLength. */}
      <div className="grid min-h-8 grid-cols-[96px_1fr] items-center gap-1">
        <button
          type="button"
          onClick={() => setLensMode((m) => (m === "focal" ? "fov" : "focal"))}
          className="cursor-pointer truncate text-left opacity-60"
          title={
            lensMode === "focal"
              ? "Focal length — click for FOV"
              : "Field of view — click for focal length"
          }
        >
          {lensMode === "focal" ? "Focal Length" : "FOV"}
        </button>
        {lensMode === "focal" ? (
          <NumberDrag
            value={c.focalLength}
            step={0.5}
            min={1}
            max={800}
            postfix="mm"
            onChange={(v, committed) => setCamera({ focalLength: v }, committed)}
          />
        ) : (
          <NumberDrag
            value={hFovFromFocalLength(c.focalLength)}
            step={0.2}
            min={1}
            max={179}
            postfix="deg"
            onChange={(v, committed) =>
              setCamera({ focalLength: focalLengthFromHFov(v) }, committed)
            }
          />
        )}
      </div>
      {num("Film Offset X", "filmOffsetX", 0.5, undefined, undefined, "%")}
      {num("Film Offset Y", "filmOffsetY", 0.5, undefined, undefined, "%")}
      {num("Zoom", "zoom", 0.01, 0.01)}
      {num("Near", "near", 0.01, 0.001)}
      {num("Far", "far", 1, c.near + 0.001)}
      <Field label="Focus Obj">
        <select
          className="select select-sm w-full"
          value={focusTarget}
          onChange={(e) =>
            setCamera({ focusTarget: e.target.value ? (e.target.value as Uuid) : undefined }, true)
          }
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
