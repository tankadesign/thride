import type { Uuid, Vec3 } from "@/types/core";
import type { Document, SceneNode } from "@/core";
import type { SplineData } from "@/types/geometry/spline";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import {
  type BooleanOp,
  booleanEngine,
  composeTRS,
  hemeshToTris,
  trisToHEMesh,
} from "@/geometry/boolean/booleanEngine";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { buildPrimitive } from "@/geometry/primitives";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { sampleSpline3D } from "@/geometry/splines/eval";
import { type ClonerParams, clonerMatrices, defaultClonerParams } from "./cloner";
import {
  buildSplineExtrude,
  defaultSplineExtrudeParams,
  type SplineExtrudeParams,
} from "./splineExtrude";
import { buildSweep, defaultSweepParams, type SweepCurve, type SweepParams } from "./sweep";

/** Document payload of a generator node (`node.data.generator`). */
export type GeneratorDescriptor =
  | { type: "splineExtrude"; params: SplineExtrudeParams }
  | { type: "sweep"; params: SweepParams }
  | { type: "boolean"; params: { op: BooleanOp } }
  | { type: "cloner"; params: ClonerParams };

export const splineExtrudeDescriptor = (): GeneratorDescriptor => ({
  type: "splineExtrude",
  params: defaultSplineExtrudeParams(),
});

export const sweepDescriptor = (): GeneratorDescriptor => ({
  type: "sweep",
  params: defaultSweepParams(),
});

export const booleanDescriptor = (): GeneratorDescriptor => ({
  type: "boolean",
  params: { op: "subtract" },
});

export const clonerDescriptor = (): GeneratorDescriptor => ({
  type: "cloner",
  params: defaultClonerParams(),
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
    const key = `se:${JSON.stringify(desc.params)}:${
      input ? JSON.stringify(input.data) + JSON.stringify(input.transform) : "∅"
    }`;
    const hit = perDoc.get(node.id);
    if (hit && hit.key === key) return hit.mesh ? { key, mesh: hit.mesh } : null;
    let mesh = input ? buildSplineExtrude(input.data, desc.params) : null;
    if (mesh && input) {
      // bake the child spline's LOCAL transform so the extrusion sits exactly
      // where the spline is drawn (profile plane = the spline's work plane)
      const m = composeTRS(input.transform);
      for (let v = 0; v < mesh.vCount; v++) {
        const x = mesh.vPos[v * 3]!;
        const y = mesh.vPos[v * 3 + 1]!;
        const z = mesh.vPos[v * 3 + 2]!;
        mesh.setPosition(
          v,
          m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
          m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
          m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
        );
      }
    }
    perDoc.set(node.id, { key, mesh });
    return mesh ? { key, mesh } : null;
  }

  if (desc.type === "sweep") {
    // two ordered spline children: [0] = profile, [1] = path
    const inputs = sweepInputs(doc, node.id, desc.params.profileSegments ?? 12);
    const key = `sw:${JSON.stringify(desc.params)}:${inputs.key}`;
    const hit = perDoc.get(node.id);
    if (hit && hit.key === key) return hit.mesh ? { key, mesh: hit.mesh } : null;
    const mesh =
      inputs.profile && inputs.path ? buildSweep(inputs.profile, inputs.path, desc.params) : null;
    perDoc.set(node.id, { key, mesh });
    return mesh ? { key, mesh } : null;
  }

  // cloners don't yield a single HEMesh — the render layer pulls evaluateCloner
  if (desc.type !== "boolean") return null;

  // boolean: async — return the cached result, kick a worker job when stale
  const inputs = booleanInputs(doc, node.id);
  const key = `bool:${desc.params.op}:${inputs.key}`;
  const entry = perDoc.get(node.id) ?? { key: "", mesh: null };
  if (inputs.sources.length < 2) {
    // fewer than two inputs (a child was moved/deleted out): drop the stale
    // result so the boolean uncouples instead of freezing its last mesh
    perDoc.set(node.id, { key, mesh: null });
    return null;
  }
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

/**
 * Cloner evaluation — a SEPARATE path from {@link evaluateGenerator} because a
 * cloner doesn't produce one HEMesh: it produces a base template mesh (for the
 * InstancedMesh's geometry) plus a flat matrix array (one transform per clone).
 * Keeping it apart lets the HEMesh return above stay non-optional for every
 * consumer (Convert-to-Mesh, syncGeometry) that expects a single mesh.
 *
 * Memoized like the others: the key covers the params (a count/effector change
 * recomputes the matrices) and the template's identity + geometry fingerprint
 * (a template edit recomputes the base). The child's own transform is ignored
 * in v1 — the template sits at the cloner's origin and the distribution places
 * the clones; baking the child matrix into every instance is a later refinement.
 */
const clonerCache = new WeakMap<
  Document,
  Map<Uuid, { key: string; base: HEMesh | null; matrices: Float32Array | null }>
>();

export function evaluateCloner(
  doc: Document,
  node: SceneNode,
): { key: string; base: HEMesh; matrices: Float32Array } | null {
  const desc = node.data?.generator as GeneratorDescriptor | undefined;
  if (desc?.type !== "cloner") return null;
  let perDoc = clonerCache.get(doc);
  if (!perDoc) {
    perDoc = new Map();
    clonerCache.set(doc, perDoc);
  }
  const template = clonerTemplate(doc, node.id);
  const key = `clone:${JSON.stringify(desc.params)}:${template?.key ?? "∅"}`;
  const hit = perDoc.get(node.id);
  if (hit && hit.key === key) {
    return hit.base && hit.matrices ? { key, base: hit.base, matrices: hit.matrices } : null;
  }
  const base = template?.mesh ?? null;
  const matrices = base ? clonerMatrices(desc.params) : null;
  perDoc.set(node.id, { key, base, matrices });
  return base && matrices ? { key, base, matrices } : null;
}

/**
 * The cloner's template: the first child that resolves to a mesh (editable
 * registry mesh or primitive). Same resolution as {@link booleanInputs} but
 * single-source and transform-less (see {@link evaluateCloner}).
 */
function clonerTemplate(doc: Document, id: Uuid): { mesh: HEMesh; key: string } | null {
  for (const childId of doc.scene.childrenOf(id)) {
    const child = doc.scene.get(childId);
    if (!child) continue;
    const meshRef = child.data?.mesh as { id: Uuid } | undefined;
    const prim = child.data?.primitive as PrimitiveDescriptor | undefined;
    if (meshRef) {
      const mesh = meshRegistry.get(meshRef.id);
      if (mesh) return { mesh, key: `m:${meshRef.id}:${mesh.topologyVersion}:${posChecksum(mesh)}` };
    } else if (prim) {
      return { mesh: buildPrimitive(prim), key: `p:${JSON.stringify(prim)}` };
    }
  }
  return null;
}

/** The generator's profile input: its first spline child (data + transform). */
function firstChildSpline(
  doc: Document,
  id: Uuid,
): { data: SplineData; transform: SceneNode["transform"] } | null {
  for (const childId of doc.scene.childrenOf(id)) {
    const child = doc.scene.get(childId);
    const data = child?.data?.spline as SplineData | undefined;
    if (child?.kind === "spline" && data) return { data, transform: child.transform };
  }
  return null;
}

/**
 * Sweep inputs: the first two spline children in object-manager order —
 * [0] profile, [1] path — each baked into the child's world transform so both
 * live in the sweep's local space. Both are bezier-sampled to a polyline; the
 * profile at `profileSegments` per curved span (1 → anchors verbatim, so a
 * bezier circle is a polygon; higher → round), the path at the default density.
 * The key covers both children's data + transforms (a path edit must recompute).
 */
function sweepInputs(doc: Document, id: Uuid, profileSegments: number) {
  const splines: { data: SplineData; transform: SceneNode["transform"] }[] = [];
  for (const childId of doc.scene.childrenOf(id)) {
    if (splines.length >= 2) break;
    const child = doc.scene.get(childId);
    const data = child?.data?.spline as SplineData | undefined;
    if (child?.kind === "spline" && data) splines.push({ data, transform: child.transform });
  }
  const bake = (
    s: { data: SplineData; transform: SceneNode["transform"] },
    local: readonly Vec3[],
  ): SweepCurve => {
    const m = composeTRS(s.transform);
    const points = local.map(
      (p): Vec3 => [
        m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
        m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
        m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
      ],
    );
    return { points, closed: s.data.closed };
  };
  const key = splines.map((s) => JSON.stringify(s.data) + JSON.stringify(s.transform)).join("|");
  return {
    profile: splines[0]
      ? bake(splines[0], sampleSpline3D(splines[0].data, Math.max(1, Math.round(profileSegments))))
      : null,
    path: splines[1] ? bake(splines[1], sampleSpline3D(splines[1].data)) : null,
    key: key || "∅",
  };
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
