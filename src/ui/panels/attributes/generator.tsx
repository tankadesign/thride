import { useRef } from "react";
import type { Uuid } from "@/types/core";
import { type ClonerParams, defaultClonerParams, normClonerParams } from "@/generators/cloner";
import type { GeneratorDescriptor } from "@/generators/graph";
import { SetFlagsCommand, SetNodeDataCommand } from "@/core/history/commands/scene";
import { useDocument } from "@/ui/hooks/doc/document";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { Field, Section, VecField } from "@/ui/widgets/inspector";

/** Generator parameter sliders (Instancer, Boolean, Sweep, Spline Extrude). */
export function GeneratorParams({ id, gen }: { id: Uuid; gen: GeneratorDescriptor }) {
  const doc = useDocument();
  const scrub = useRef<{ before: Record<string, unknown> } | null>(null);

  const setParam = (
    key: string,
    value: number | boolean | string | number[],
    committed: boolean,
  ) => {
    const node = doc.scene.mustGet(id);
    scrub.current ??= { before: structuredClone(node.data!) };
    const data = structuredClone(node.data!);
    (data.generator as { params: Record<string, unknown> }).params[key] = value;
    if (committed) {
      const before = scrub.current.before;
      scrub.current = null;
      doc.setNodeData(id, data, true);
      doc.history.pushWithoutExecute(new SetNodeDataCommand(id, data, before, "Edit Generator"));
    } else {
      doc.setNodeData(id, data, true);
    }
  };

  /** One undo step restoring a group of params to their defaults. */
  const resetParams = (keys: (keyof ClonerParams)[], label: string) => {
    const node = doc.scene.mustGet(id);
    const data = structuredClone(node.data!);
    const params = (data.generator as { params: Record<string, unknown> }).params;
    const d = defaultClonerParams();
    for (const key of keys) params[key] = d[key];
    doc.history.run(new SetNodeDataCommand(id, data, undefined, label, false));
  };

  if (gen.type === "cloner") {
    const cp = normClonerParams(gen.params);
    // classify child[0] (the target to scatter onto) so the Distribution select
    // offers the right options: mesh points/faces/edges vs spline points/count
    const kids = doc.scene.childrenOf(id);
    const targetNode = kids[0] ? doc.scene.get(kids[0]) : undefined;
    const targetKind: "mesh" | "spline" | "none" = !targetNode
      ? "none"
      : targetNode.kind === "spline" && targetNode.data?.spline
        ? "spline"
        : targetNode.data?.mesh !== undefined || targetNode.data?.primitive !== undefined
          ? "mesh"
          : "none";
    const hasTemplate = kids[1] !== undefined;
    type VecKey =
      | "instancePosition"
      | "instanceRotation"
      | "instanceScale"
      | "positionJitter"
      | "rotationJitter"
      | "stepPosition"
      | "stepRotation"
      | "stepScale";
    /** Label + 3 axis-labelled drags editing one Vec3 param (rotation in degrees). */
    const vecRow = (key: VecKey, label: string, opts: { deg?: boolean; step?: number } = {}) => {
      const arr = cp[key] ?? [0, 0, 0];
      return (
        <VecField
          label={label}
          values={arr}
          deg={opts.deg}
          step={opts.step}
          onChange={(i, v, committed) => {
            const next = [...arr];
            next[i] = v;
            setParam(key, next, committed);
          }}
        />
      );
    };
    return (
      <>
        <Section title="Instancer">
          {targetKind === "none" ? (
            <p className="text-[10px] opacity-50">
              Add two children: the target to clone onto (1st) and the object to instance (2nd).
            </p>
          ) : (
            <>
              <Field label="Distribution">
                <select
                  className="select select-sm w-full"
                  value={cp.distribution}
                  onChange={(e) => setParam("distribution", e.target.value, true)}
                >
                  {targetKind === "mesh" ? (
                    <>
                      <option value="points">Points</option>
                      <option value="faces">Polygon Centers</option>
                      <option value="edges">Edge Centers</option>
                    </>
                  ) : (
                    <>
                      <option value="points">Points</option>
                      <option value="count">Count</option>
                    </>
                  )}
                </select>
              </Field>
              {targetKind === "spline" && cp.distribution === "count" ? (
                <Field label="Count">
                  <NumberDrag
                    value={cp.count}
                    step={1}
                    integer
                    min={2}
                    max={200000}
                    onChange={(v, committed) => setParam("count", Math.max(2, v), committed)}
                  />
                </Field>
              ) : null}
              <Field label="Orientation">
                <select
                  className="select select-sm w-full"
                  value={cp.orientation}
                  onChange={(e) => setParam("orientation", e.target.value, true)}
                >
                  <option value="normal">Normal</option>
                  <option value="direction">Direction</option>
                </select>
              </Field>
              {cp.orientation === "direction" ? (
                <Field label="Up Vector">
                  <select
                    className="select select-sm w-full"
                    value={cp.upVector}
                    onChange={(e) => setParam("upVector", e.target.value, true)}
                  >
                    <option value="x+">X+</option>
                    <option value="x-">X−</option>
                    <option value="y+">Y+</option>
                    <option value="y-">Y−</option>
                    <option value="z+">Z+</option>
                    <option value="z-">Z−</option>
                  </select>
                </Field>
              ) : null}
              {/* a proxy for the target NODE's visibility — the same flag the
                  object manager's eye toggles, so the two always stay in sync */}
              <Field label="Hide Target">
                <input
                  type="checkbox"
                  className="toggle toggle-sm"
                  checked={!(targetNode?.visible ?? true)}
                  onChange={(e) =>
                    doc.history.run(new SetFlagsCommand(kids[0]!, { visible: !e.target.checked }))
                  }
                />
              </Field>
            </>
          )}
          {targetKind !== "none" && !hasTemplate ? (
            <p className="mt-1 text-[10px] text-warning opacity-70">
              Add a 2nd child — the object to instance.
            </p>
          ) : null}
        </Section>
        <Section
          title="Instance Transform"
          onReset={() =>
            resetParams(
              ["instancePosition", "instanceRotation", "instanceScale"],
              "Reset Instance Transform",
            )
          }
        >
          {vecRow("instancePosition", "Position", { step: 0.05 })}
          {vecRow("instanceRotation", "Rotation", { deg: true, step: 1 })}
          {vecRow("instanceScale", "Scale", { step: 0.05 })}
        </Section>
        <Section
          title="Step Transform"
          onReset={() =>
            resetParams(["stepPosition", "stepRotation", "stepScale"], "Reset Step Transform")
          }
        >
          {vecRow("stepPosition", "Position", { step: 0.05 })}
          {vecRow("stepRotation", "Rotation", { deg: true, step: 1 })}
          {vecRow("stepScale", "Scale", { step: 0.05 })}
        </Section>
        <Section
          title="Random Effector"
          bordered={false}
          onReset={() =>
            resetParams(
              ["seed", "positionJitter", "rotationJitter", "scaleJitter"],
              "Reset Random Effector",
            )
          }
        >
          <Field label="Seed">
            <NumberDrag
              value={cp.seed}
              step={1}
              integer
              onChange={(v, committed) => setParam("seed", v, committed)}
            />
          </Field>
          {vecRow("positionJitter", "Position", { step: 0.05 })}
          {vecRow("rotationJitter", "Rotation", { deg: true, step: 1 })}
          <Field label="Scale">
            <NumberDrag
              value={cp.scaleJitter}
              step={0.05}
              min={0}
              onChange={(v, committed) => setParam("scaleJitter", v, committed)}
            />
          </Field>
        </Section>
      </>
    );
  }

  if (gen.type === "boolean") {
    return (
      <Section title="Boolean" bordered={false}>
        <Field label="Operation">
          <select
            className="select select-sm w-full"
            value={gen.params.op}
            onChange={(e) => setParam("op", e.target.value, true)}
          >
            <option value="union">Union (A ∪ B)</option>
            <option value="subtract">Subtract (A − B)</option>
            <option value="intersect">Intersect (A ∩ B)</option>
          </select>
        </Field>
        <p className="mt-1 text-[10px] opacity-50">First two mesh children are A and B.</p>
      </Section>
    );
  }

  if (gen.type === "sweep") {
    const sp = gen.params;
    const usePathPoints = sp.usePathPoints ?? true;
    return (
      <Section title="Sweep" bordered={false}>
        <Field label="Rotation">
          <NumberDrag
            value={sp.rotation ?? 0}
            step={1}
            min={-360}
            max={360}
            onChange={(v, committed) => setParam("rotation", v, committed)}
          />
        </Field>
        <Field label="Profile Segs">
          <NumberDrag
            value={sp.profileSegments ?? 12}
            step={1}
            integer
            min={1}
            max={64}
            onChange={(v, committed) => setParam("profileSegments", v, committed)}
          />
        </Field>
        <Field label="Use path points">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={usePathPoints}
            onChange={(e) => setParam("usePathPoints", e.target.checked, true)}
          />
        </Field>
        {usePathPoints ? null : (
          <Field label="Path Segs">
            <NumberDrag
              value={sp.pathSegments ?? 48}
              step={1}
              integer
              min={2}
              max={512}
              onChange={(v, committed) => setParam("pathSegments", v, committed)}
            />
          </Field>
        )}
        <Field label="Invert Normals">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={sp.invertNormals ?? false}
            onChange={(e) => setParam("invertNormals", e.target.checked, true)}
          />
        </Field>
        <p className="mt-1 text-[10px] opacity-50">Children: 1st = profile, 2nd = path.</p>
      </Section>
    );
  }

  const p = gen.params as unknown as Record<string, number | boolean>;
  const rows: { key: string; label: string; int?: boolean; min?: number; max?: number }[] = [
    { key: "depth", label: "Depth", min: 0.001 },
    { key: "heightSegments", label: "Height Segs", int: true, min: 1, max: 64 },
    { key: "bevelSize", label: "Bevel Size", min: 0 },
    { key: "bevelSegments", label: "Bevel Segs", int: true, min: 1, max: 8 },
  ];
  return (
    <Section title="Spline Extrude" bordered={false}>
      {rows.map((row) => (
        <Field label={row.label} key={row.key}>
          <NumberDrag
            value={(p[row.key] as number) ?? 0}
            step={row.int ? 0.08 : 0.005}
            integer={row.int}
            min={row.min}
            max={row.max}
            onChange={(v, committed) => setParam(row.key, v, committed)}
          />
        </Field>
      ))}
      <Field label="Caps">
        <input
          type="checkbox"
          className="toggle toggle-sm"
          checked={(p.caps as boolean) ?? true}
          onChange={(e) => setParam("caps", e.target.checked, true)}
        />
      </Field>
    </Section>
  );
}
