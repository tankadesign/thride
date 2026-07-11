import type { Uuid } from "@/types/core";
import type { Document, SceneNode } from "@/core";
import type { SplineData } from "@/types/geometry/spline";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import {
  buildSplineExtrude,
  defaultSplineExtrudeParams,
  type SplineExtrudeParams,
} from "./splineExtrude";

/** Document payload of a generator node (`node.data.generator`). */
export interface GeneratorDescriptor {
  type: "splineExtrude";
  params: SplineExtrudeParams;
}

export const splineExtrudeDescriptor = (): GeneratorDescriptor => ({
  type: "splineExtrude",
  params: defaultSplineExtrudeParams(),
});

/**
 * Pull-based generator evaluation, memoized per node by an input-state key
 * (params + the first child spline's data). The evaluator is lazy — callers
 * (the render sync) pull when they need geometry, and the key comparison
 * makes repeated pulls free until an input actually changes. Returns null
 * (and callers show nothing) when inputs are missing or degenerate.
 */
const cache = new WeakMap<Document, Map<Uuid, { key: string; mesh: HEMesh | null }>>();

export function evaluateGenerator(
  doc: Document,
  node: SceneNode,
): { key: string; mesh: HEMesh } | null {
  const desc = node.data?.generator as GeneratorDescriptor | undefined;
  if (!desc) return null;
  const input = firstChildSpline(doc, node.id);
  const key = `${desc.type}:${JSON.stringify(desc.params)}:${input ? JSON.stringify(input) : "∅"}`;

  let perDoc = cache.get(doc);
  if (!perDoc) {
    perDoc = new Map();
    cache.set(doc, perDoc);
  }
  const hit = perDoc.get(node.id);
  if (hit && hit.key === key) return hit.mesh ? { key, mesh: hit.mesh } : null;

  let mesh: HEMesh | null = null;
  if (desc.type === "splineExtrude" && input) {
    mesh = buildSplineExtrude(input, desc.params);
  }
  perDoc.set(node.id, { key, mesh });
  return mesh ? { key, mesh } : null;
}

/** The generator's profile input: its first spline child's data (child-local). */
function firstChildSpline(doc: Document, id: Uuid): SplineData | null {
  for (const childId of doc.scene.childrenOf(id)) {
    const child = doc.scene.get(childId);
    const data = child?.data?.spline as SplineData | undefined;
    if (child?.kind === "spline" && data) return data;
  }
  return null;
}
