import type { Uuid } from "@/types/core";
import type { Document, SceneNode } from "@/core";
import type { SplineData } from "@/types/geometry/spline";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import {
  type BooleanOp,
  booleanEngine,
  hemeshToTris,
  trisToHEMesh,
} from "@/geometry/boolean/booleanEngine";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { buildPrimitive } from "@/geometry/primitives";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import {
  buildSplineExtrude,
  defaultSplineExtrudeParams,
  type SplineExtrudeParams,
} from "./splineExtrude";

/** Document payload of a generator node (`node.data.generator`). */
export type GeneratorDescriptor =
  | { type: "splineExtrude"; params: SplineExtrudeParams }
  | { type: "boolean"; params: { op: BooleanOp } };

export const splineExtrudeDescriptor = (): GeneratorDescriptor => ({
  type: "splineExtrude",
  params: defaultSplineExtrudeParams(),
});

export const booleanDescriptor = (): GeneratorDescriptor => ({
  type: "boolean",
  params: { op: "subtract" },
});

interface CacheEntry {
  key: string;
  mesh: HEMesh | null;
  /** Async (boolean): the input key a worker job is currently computing. */
  pendingKey?: string;
}

/**
 * Pull-based generator evaluation, memoized per node by an input-state key.
 * Synchronous generators (spline extrude) evaluate inline; the boolean runs
 * in the Manifold worker — pulls return the last good result immediately and
 * a fresh job re-touches the node when it lands, so the UI never hitches.
 */
const cache = new WeakMap<Document, Map<Uuid, CacheEntry>>();

export function evaluateGenerator(
  doc: Document,
  node: SceneNode,
): { key: string; mesh: HEMesh } | null {
  const desc = node.data?.generator as GeneratorDescriptor | undefined;
  if (!desc) return null;
  let perDoc = cache.get(doc);
  if (!perDoc) {
    perDoc = new Map();
    cache.set(doc, perDoc);
  }

  if (desc.type === "splineExtrude") {
    const input = firstChildSpline(doc, node.id);
    const key = `se:${JSON.stringify(desc.params)}:${input ? JSON.stringify(input) : "∅"}`;
    const hit = perDoc.get(node.id);
    if (hit && hit.key === key) return hit.mesh ? { key, mesh: hit.mesh } : null;
    const mesh = input ? buildSplineExtrude(input, desc.params) : null;
    perDoc.set(node.id, { key, mesh });
    return mesh ? { key, mesh } : null;
  }

  // boolean: async — return the cached result, kick a worker job when stale
  const inputs = booleanInputs(doc, node.id);
  const key = `bool:${desc.params.op}:${inputs.key}`;
  const entry = perDoc.get(node.id) ?? { key: "", mesh: null };
  if (entry.key === key) return entry.mesh ? { key, mesh: entry.mesh } : null;
  if (entry.pendingKey !== key && inputs.sources.length >= 2) {
    entry.pendingKey = key;
    perDoc.set(node.id, entry);
    const nodeId = node.id;
    // tris are built lazily here (transferred buffers can't be reused anyway)
    const a = hemeshToTris(inputs.sources[0]!.mesh, inputs.sources[0]!.transform);
    const b = hemeshToTris(inputs.sources[1]!.mesh, inputs.sources[1]!.transform);
    booleanEngine
      .run(desc.params.op, a, b)
      .then((tris) => {
        const per = cache.get(doc);
        const cur = per?.get(nodeId);
        if (!cur || cur.pendingKey !== key) return; // superseded by newer inputs
        cur.key = key;
        cur.mesh = tris ? trisToHEMesh(tris) : null;
        cur.pendingKey = undefined;
        if (doc.scene.has(nodeId)) doc.touchNode(nodeId); // re-pull renders it
      })
      .catch(() => {});
  }
  // stale-but-valid result keeps rendering while the worker computes
  return entry.mesh ? { key: entry.key, mesh: entry.mesh } : null;
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

/**
 * Boolean inputs: the first two children that resolve to a mesh (editable
 * registry mesh or primitive), in the boolean's local space. The key covers
 * geometry identity + positions + transforms; tris build lazily on job kick.
 */
function booleanInputs(doc: Document, id: Uuid) {
  const sources: { mesh: HEMesh; transform: SceneNode["transform"] }[] = [];
  const parts: string[] = [];
  for (const childId of doc.scene.childrenOf(id)) {
    if (sources.length >= 2) break;
    const child = doc.scene.get(childId);
    if (!child) continue;
    let mesh: HEMesh | null = null;
    let idKey = "";
    const meshRef = child.data?.mesh as { id: Uuid } | undefined;
    const prim = child.data?.primitive as PrimitiveDescriptor | undefined;
    if (meshRef) {
      mesh = meshRegistry.get(meshRef.id) ?? null;
      if (mesh) idKey = `m:${meshRef.id}:${mesh.topologyVersion}:${posChecksum(mesh)}`;
    } else if (prim) {
      mesh = buildPrimitive(prim);
      idKey = `p:${JSON.stringify(prim)}`;
    }
    if (!mesh) continue;
    parts.push(`${idKey}|${JSON.stringify(child.transform)}`);
    sources.push({ mesh, transform: child.transform });
  }
  return { key: parts.join("+") || "∅", sources };
}

/** Cheap position fingerprint (component drags don't bump topologyVersion). */
function posChecksum(mesh: HEMesh): number {
  let sum = 0;
  const n = mesh.vCount * 3;
  for (let i = 0; i < n; i++) sum = (sum + mesh.vPos[i]! * (i + 1)) % 1e9;
  return Math.round(sum * 1e3);
}
