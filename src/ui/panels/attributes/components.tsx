import { useRef } from "react";
import type { ComponentMode, Uuid, Vec3 } from "@/types/core";
import type { SplineData } from "@/types/geometry/spline";
import { splineStamp } from "@/geometry/splines/eval";
import { ComponentTransformSession } from "@/geometry/commands/meshEdit";
import { vertexCentroid, vertexExtents, vertsForSelection } from "@/geometry/kernel/components";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { SetNodeDataCommand } from "@/core/history/commands/scene";
import { useDocument } from "@/ui/hooks/doc/document";
import { Section, VecField } from "@/ui/widgets/inspector";

interface ComponentScrub {
  indices: number[];
  begin: Float32Array; // packed xyz at scrub start
  centroid: [number, number, number];
  extent: [number, number, number];
}

/**
 * Numeric editing for the current component selection (object-space coords).
 * The selection acts as ONE: XYZ shows a single point's exact position or
 * the selection centroid (edits translate rigidly); W/H/D shows the
 * selection's bounding box (edits scale about the centroid — typing 0
 * flattens the selection onto that axis). One undo step per edit/scrub;
 * all math runs off a scrub-start snapshot so repeated keystrokes and
 * degenerate extents stay exact.
 */
export function ComponentSection({
  id,
  meshId,
  mode,
}: {
  id: Uuid;
  meshId: Uuid;
  mode: ComponentMode;
}) {
  const doc = useDocument();
  const scrub = useRef<ComponentScrub | null>(null);
  const mesh = meshRegistry.get(meshId);
  const sel = mesh ? doc.selection.componentsFor(id, mode) : undefined;
  const valid = mesh && sel && sel.topologyVersion === mesh.topologyVersion ? sel : null;
  const count = valid?.bits.count ?? 0;
  if (!mesh) return null;
  const verts = valid ? vertsForSelection(mesh, mode, valid.bits) : [];
  const centroid = vertexCentroid(mesh, verts);
  const extent = vertexExtents(mesh, verts);

  const beginScrub = (label: string): ComponentScrub => {
    if (scrub.current) return scrub.current;
    const begin = new Float32Array(verts.length * 3);
    for (let i = 0; i < verts.length; i++) {
      for (let a = 0; a < 3; a++) begin[i * 3 + a] = mesh.vPos[verts[i]! * 3 + a]!;
    }
    scrub.current = { indices: verts, begin, centroid, extent };
    doc.sessions.start(new ComponentTransformSession(id, meshId, verts, label));
    return scrub.current;
  };

  const finish = (committed: boolean) => {
    if (committed) {
      doc.sessions.commit();
      scrub.current = null;
    }
  };

  /** Translate rigidly so the centroid's `axis` lands on the typed value. */
  const setAxis = (axis: number, v: number, committed: boolean) => {
    if (verts.length === 0) return;
    const s = beginScrub("Move Components");
    const delta = v - s.centroid[axis]!;
    const out = new Float32Array(s.begin.length);
    for (let i = 0; i < s.indices.length; i++) {
      for (let a = 0; a < 3; a++) {
        out[i * 3 + a] = s.begin[i * 3 + a]! + (a === axis ? delta : 0);
      }
    }
    doc.sessions.update(out);
    finish(committed);
  };

  /** Scale about the centroid so the bbox `axis` extent hits the typed value. */
  const setSize = (axis: number, v: number, committed: boolean) => {
    if (verts.length === 0) return;
    const s = beginScrub("Scale Components");
    const base = s.extent[axis]!;
    // a degenerate (flat) axis has no direction to expand along — no-op;
    // 0 / base flattens the selection onto the centroid plane exactly
    const ratio = base < 1e-9 ? 1 : Math.max(0, v) / base;
    const out = new Float32Array(s.begin.length);
    for (let i = 0; i < s.indices.length; i++) {
      for (let a = 0; a < 3; a++) {
        const p = s.begin[i * 3 + a]!;
        out[i * 3 + a] = a === axis ? s.centroid[a]! + (p - s.centroid[a]!) * ratio : p;
      }
    }
    doc.sessions.update(out);
    finish(committed);
  };

  return (
    <Section title={`${count} Selected`}>
      {count === 0 ? (
        <p className="opacity-50">Nothing selected — click components in the viewport.</p>
      ) : (
        <>
          <VecField
            label={verts.length > 1 ? "Centroid" : "Position"}
            values={centroid}
            onChange={setAxis}
          />
          {verts.length > 1 ? (
            <VecField
              label="Size"
              values={extent}
              axes={["W", "H", "D"]}
              min={0}
              onChange={setSize}
            />
          ) : null}
        </>
      )}
    </Section>
  );
}

const splineCentroid = (pts: Vec3[]): Vec3 => {
  if (pts.length === 0) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  return [x / pts.length, y / pts.length, z / pts.length];
};

const splineExtents = (pts: Vec3[]): Vec3 => {
  if (pts.length === 0) return [0, 0, 0];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    minZ = Math.min(minZ, p[2]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
    maxZ = Math.max(maxZ, p[2]);
  }
  return [maxX - minX, maxY - minY, maxZ - minZ];
};

/**
 * Numeric editing for the selected spline POINTS — the point-mode analogue of
 * {@link ComponentSection} for meshes. XYZ shows a single point's local position
 * or the selection centroid (edits translate rigidly, handles ride along); Size
 * shows the selection's bounding box (edits scale about the centroid). One undo
 * step per edit; editing detaches a parametric spline (goes off-recipe), same as
 * dragging a point in the viewport.
 */
export function SplineComponentSection({ id }: { id: Uuid }) {
  const doc = useDocument();
  const scrub = useRef<{ before: SplineData; centroid: Vec3; extent: Vec3 } | null>(null);
  const node = doc.scene.has(id) ? doc.scene.mustGet(id) : null;
  const data = node?.data?.spline as SplineData | undefined;
  const sel = data ? doc.selection.componentsFor(id, "point") : undefined;
  const valid = data && sel && sel.topologyVersion === splineStamp(data) ? sel : null;
  const indices = valid ? valid.bits.toArray() : [];
  if (!node || !data) return null;
  const positions = indices.map((i) => data.points[i]!.position);
  const centroid = splineCentroid(positions);
  const extent = splineExtents(positions);

  const begin = () => {
    scrub.current ??= { before: structuredClone(data), centroid, extent };
    return scrub.current;
  };

  const write = (after: SplineData, committed: boolean, label: string) => {
    if (!committed) {
      doc.setNodeData(id, { ...node.data, spline: after }, true);
      return;
    }
    // editing points detaches a parametric spline; undo restores the recipe
    const before = scrub.current?.before ?? data;
    scrub.current = null;
    const afterData: Record<string, unknown> = { ...node.data, spline: after };
    delete afterData.splinePrimitive;
    doc.history.run(
      new SetNodeDataCommand(id, afterData, { ...node.data, spline: before }, label, false),
    );
  };

  /** Translate the selection rigidly so the centroid's `axis` hits the typed value. */
  const setAxis = (axis: number, v: number, committed: boolean) => {
    if (indices.length === 0) return;
    const s = begin();
    const delta = v - s.centroid[axis]!;
    const after = structuredClone(s.before);
    for (const i of indices) {
      const p = after.points[i];
      if (p) p.position[axis] = p.position[axis]! + delta;
    }
    write(after, committed, "Move Points");
  };

  /** Scale the selection about its centroid so the bbox `axis` extent hits `v`. */
  const setSize = (axis: number, v: number, committed: boolean) => {
    if (indices.length === 0) return;
    const s = begin();
    const base = s.extent[axis]!;
    const ratio = base < 1e-9 ? 1 : Math.max(0, v) / base;
    const after = structuredClone(s.before);
    for (const i of indices) {
      const p = after.points[i];
      if (p) p.position[axis] = s.centroid[axis]! + (p.position[axis]! - s.centroid[axis]!) * ratio;
    }
    write(after, committed, "Scale Points");
  };

  return (
    <Section title={`${indices.length} Selected`}>
      {indices.length === 0 ? (
        <p className="opacity-50">Nothing selected — click points in the viewport.</p>
      ) : (
        <>
          <VecField
            label={indices.length > 1 ? "Centroid" : "Position"}
            values={centroid}
            onChange={setAxis}
          />
          {indices.length > 1 ? (
            <VecField
              label="Size"
              values={extent}
              axes={["W", "H", "D"]}
              min={0}
              onChange={setSize}
            />
          ) : null}
        </>
      )}
    </Section>
  );
}
