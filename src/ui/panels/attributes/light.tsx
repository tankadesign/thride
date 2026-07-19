import { useRef } from "react";
import type { TransformDTO, Uuid } from "@/types/core";
import {
  LIGHT_LABELS,
  type LightDataDTO,
  SHADOW_CAPABLE,
  type ShadowResolution,
} from "@/types/core/light";
import { SetNodeDataCommand, SetTransformCommand } from "@/core/history/commands/scene";
import { appStore, useDocument } from "@/ui/hooks/doc/document";
import { targetRotationBakerAtom } from "@/ui/hooks/editor/viewport";
import { ColorPicker } from "@/ui/widgets/ColorPicker";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { Field, Section } from "@/ui/widgets/inspector";

/** Light payload editor: color, intensity, shadows, type-specific params. */
export function LightParams({ id, light }: { id: Uuid; light: LightDataDTO }) {
  const doc = useDocument();
  const scrub = useRef<{ before: Record<string, unknown> } | null>(null);

  const setLight = (patch: Partial<LightDataDTO>, committed: boolean) => {
    const node = doc.scene.mustGet(id);
    scrub.current ??= { before: structuredClone(node.data!) };
    const data = structuredClone(node.data!);
    data.light = { ...(data.light as LightDataDTO), ...patch };
    if (committed) {
      const before = scrub.current.before;
      scrub.current = null;
      doc.setNodeData(id, data, true);
      doc.history.pushWithoutExecute(new SetNodeDataCommand(id, data, before, "Edit Light"));
    } else {
      doc.setNodeData(id, data, true);
    }
  };

  const numeric = (label: string, key: keyof LightDataDTO, step = 0.02, max?: number) => (
    <Field label={label} key={key}>
      <NumberDrag
        value={(light[key] as number) ?? 0}
        step={step}
        min={0}
        max={max}
        onChange={(v, committed) => setLight({ [key]: v }, committed)}
      />
    </Field>
  );

  return (
    <Section title={`${LIGHT_LABELS[light.type]} Light`}>
      <Field label="Color">
        <span
          className="block w-10 h-10 rounded-full outline-transparent outline-offset-1 has-[input:focus]:outline-1 has-[input:focus]:outline-primary"
          style={{ backgroundColor: light.color }}
        >
          <ColorPicker
            color={light.color}
            onChange={(e) => setLight({ color: e.target.value }, true)}
          />
        </span>
      </Field>
      {numeric("Intensity", "intensity", 0.05)}
      {light.type === "spot" ? numeric("Angle", "angle", 0.005, Math.PI / 2) : null}
      {light.type === "spot" ? numeric("Penumbra", "penumbra", 0.005, 1) : null}
      {light.type === "area" ? numeric("Width", "width") : null}
      {light.type === "area" ? numeric("Height", "height") : null}
      {light.type === "hemisphere" ? (
        <Field label="Ground">
          <ColorPicker
            color={light.groundColor ?? "#443c30"}
            onChange={(e) => setLight({ groundColor: e.target.value }, true)}
          />
        </Field>
      ) : null}
      {SHADOW_CAPABLE.has(light.type) ? (
        <Field label="Shadows">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={light.castShadow ?? true}
            onChange={(e) => setLight({ castShadow: e.target.checked }, true)}
          />
        </Field>
      ) : null}
      {SHADOW_CAPABLE.has(light.type) && (light.castShadow ?? true) ? (
        <>
          <Field label="Quality">
            <select
              className="select select-sm w-full"
              value={light.shadowResolution ?? "normal"}
              onChange={(e) =>
                setLight({ shadowResolution: e.target.value as ShadowResolution }, true)
              }
            >
              <option value="low">Low (1k)</option>
              <option value="normal">Normal (2k)</option>
              <option value="high">High (4k)</option>
            </select>
          </Field>
          {numeric("Blur", "shadowBlur", 0.1, 20)}
          {numeric("Size", "shadowSize", 0.5, 400)}
        </>
      ) : null}
    </Section>
  );
}

/** Aim target: any other object controls this node's rotation. */
export function TargetSelector({ id }: { id: Uuid }) {
  const doc = useDocument();
  const node = doc.scene.mustGet(id);
  const target = (node.data?.target as Uuid | undefined) ?? "";
  const candidates = doc.scene.toDTO().filter((n) => n.id !== id);

  const setTarget = (value: string) => {
    const before = structuredClone(node.data ?? {});
    const data = structuredClone(node.data ?? {});
    if (value) {
      data.target = value;
      doc.history.run(new SetNodeDataCommand(id, data, before, "Set Target"));
      return;
    }
    // Clearing a target: bake the orientation the object is CURRENTLY showing
    // (from following the target) into its transform so it keeps its PSR
    // instead of snapping back to the pre-target rotation. Position/scale are
    // untouched — a look-at constraint only ever drove rotation.
    delete data.target;
    const baked = appStore.get(targetRotationBakerAtom)?.bake(id) ?? null;
    if (!baked) {
      doc.history.run(new SetNodeDataCommand(id, data, before, "Clear Target"));
      return;
    }
    const beforeT = structuredClone(node.transform);
    const afterT: TransformDTO = { ...structuredClone(node.transform), rotation: baked };
    doc.history.transact("Clear Target", () => {
      doc.history.run(new SetTransformCommand(id, afterT, beforeT));
      doc.history.run(new SetNodeDataCommand(id, data, before, "Clear Target"));
    });
  };

  return (
    <Section title="Target" bordered={false}>
      <select
        className="select select-sm w-full"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      >
        <option value="">None</option>
        {candidates.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>
    </Section>
  );
}
