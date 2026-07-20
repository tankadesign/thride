import { useRef } from "react";
import type { Uuid } from "@/types/core";
import type { CameraDataDTO } from "@/types/core/camera";
import { SetNodeDataCommand } from "@/core/history/commands/scene";
import { useDocument } from "@/ui/hooks/doc/document";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { Field, Section } from "@/ui/widgets/inspector";

/**
 * Camera lens editor: field of view + clip range. Perspective only for now
 * (see CameraDataDTO). A pane "looks through" this node, applying these values
 * to its rig; editing fov also reshapes the viewport frustum helper.
 */
export function CameraParams({ id, camera }: { id: Uuid; camera: CameraDataDTO }) {
  const doc = useDocument();
  const scrub = useRef<{ before: Record<string, unknown> } | null>(null);

  const setCamera = (patch: Partial<CameraDataDTO>, committed: boolean) => {
    const node = doc.scene.mustGet(id);
    scrub.current ??= { before: structuredClone(node.data!) };
    const data = structuredClone(node.data!);
    data.camera = { ...(data.camera as CameraDataDTO), ...patch };
    if (committed) {
      const before = scrub.current.before;
      scrub.current = null;
      doc.setNodeData(id, data, true);
      doc.history.pushWithoutExecute(new SetNodeDataCommand(id, data, before, "Edit Camera"));
    } else {
      doc.setNodeData(id, data, true);
    }
  };

  return (
    <Section title="Camera">
      <Field label="FOV">
        <NumberDrag
          value={camera.fov}
          step={0.2}
          min={1}
          max={179}
          onChange={(v, committed) => setCamera({ fov: v }, committed)}
        />
      </Field>
      <Field label="Near">
        <NumberDrag
          value={camera.near}
          step={0.01}
          min={0.001}
          onChange={(v, committed) => setCamera({ near: v }, committed)}
        />
      </Field>
      <Field label="Far">
        <NumberDrag
          value={camera.far}
          step={1}
          min={camera.near + 0.001}
          onChange={(v, committed) => setCamera({ far: v }, committed)}
        />
      </Field>
    </Section>
  );
}
