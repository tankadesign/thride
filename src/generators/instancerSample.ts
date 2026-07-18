import type { TransformDTO, Vec3 } from "@/types/core";
import type { SplineData } from "@/types/geometry/spline";
import { composeTRS } from "@/geometry/boolean/booleanEngine";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { sampleSpline3D } from "@/geometry/splines/eval";
import { computeTangents, lerp3, resample } from "@/geometry/splines/resample";
import {
  basisFromUp,
  type ClonerParams,
  type Instance,
  normClonerParams,
  upVectorAxis,
} from "./cloner";

/**
 * The Instancer's target sampler: turns child[0] (the object to clone *onto*)
 * into the base {@link Instance}s the effector then jitters and bakes. A mesh
 * yields a clone at each vertex / polygon center / edge center; a spline yields
 * a clone at each anchor or an even count along its arc length. Each carries an
 * orientation frame — aligned to the surface normal / curve tangent (`normal`
 * mode) or a fixed world axis (`direction` mode). Pure: reads geometry data,
 * emits plain instances; no Three, no scene objects.
 *
 * Positions and directions are baked through child[0]'s own transform so the
 * instances live in the Instancer's local space (the InstancedMesh IS the
 * Instancer node).
 */

/** Minimum clones along a spline in `count` distribution (one at each end needs 2). */
export const MIN_SPLINE_COUNT = 2;

/** Sample a mesh target. `distribution` selects vertices / face centers / edge centers. */
export function sampleMeshTarget(
  mesh: HEMesh,
  transform: TransformDTO,
  params: ClonerParams,
): Instance[] {
  const p = normClonerParams(params);
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];

  if (p.distribution === "faces") {
    for (let f = 0; f < mesh.fCount; f++) {
      const verts = mesh.faceVertices(f);
      const c: Vec3 = [0, 0, 0];
      const g: Vec3 = [0, 0, 0];
      for (const v of verts) {
        mesh.getPosition(v, g);
        c[0] += g[0];
        c[1] += g[1];
        c[2] += g[2];
      }
      const inv = verts.length > 0 ? 1 / verts.length : 0;
      positions.push([c[0] * inv, c[1] * inv, c[2] * inv]);
      normals.push(mesh.faceNormal(f));
    }
  } else if (p.distribution === "edges") {
    // per-halfedge face map, so an edge midpoint can average its two faces
    const heFace = new Int32Array(mesh.heCount).fill(-1);
    for (let f = 0; f < mesh.fCount; f++) for (const h of mesh.faceHalfEdges(f)) heFace[h] = f;
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [0, 0, 0];
    for (let h = 0; h < mesh.heCount; h++) {
      const tw = mesh.heTwin[h]!;
      if (tw !== -1 && tw < h) continue; // each undirected edge once (lower handle)
      mesh.getPosition(mesh.heVert[h]!, a);
      mesh.getPosition(mesh.heVert[mesh.heNext[h]!]!, b);
      positions.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
      const fn = heFace[h]! >= 0 ? mesh.faceNormal(heFace[h]!) : ([0, 1, 0] as Vec3);
      if (tw !== -1 && heFace[tw]! >= 0) {
        const fn2 = mesh.faceNormal(heFace[tw]!);
        normals.push(normalize([fn[0] + fn2[0], fn[1] + fn2[1], fn[2] + fn2[2]]));
      } else {
        normals.push(fn);
      }
    }
  } else {
    // points (default): a clone at each vertex, oriented to its smooth normal
    const vn = mesh.computeVertexNormals();
    const g: Vec3 = [0, 0, 0];
    for (let v = 0; v < mesh.vCount; v++) {
      mesh.getPosition(v, g);
      positions.push([g[0], g[1], g[2]]);
      normals.push([vn[v * 3]!, vn[v * 3 + 1]!, vn[v * 3 + 2]!]);
    }
  }

  return toInstances(positions, normals, transform, p);
}

/** Sample a spline target. `points` uses the anchors; `count` spreads N evenly. */
export function sampleSplineTarget(
  data: SplineData,
  transform: TransformDTO,
  params: ClonerParams,
): Instance[] {
  const p = normClonerParams(params);
  let local: Vec3[];
  if (p.distribution === "count") {
    const polyline = sampleSpline3D(data);
    if (polyline.length < 2) return [];
    const n = Math.max(MIN_SPLINE_COUNT, Math.floor(p.count));
    local = resample(polyline, n, data.closed, lerp3);
  } else {
    // points: the spline's own anchors (closed splines don't duplicate the last)
    local = data.points.map((pt) => [...pt.position] as Vec3);
  }
  if (local.length === 0) return [];
  const tangents = computeTangents(local, data.closed);
  return toInstances(local, tangents, transform, p);
}

/**
 * Bake sampled local positions + surface directions through child[0]'s transform
 * and build the oriented {@link Instance}s. In `normal` mode each clone's +Y
 * follows the (transformed) surface normal / tangent; in `direction` mode every
 * clone's +Y points along a fixed world axis.
 */
function toInstances(
  localPositions: Vec3[],
  localDirs: Vec3[],
  transform: TransformDTO,
  p: ClonerParams,
): Instance[] {
  const m = composeTRS(transform);
  const fixedAxis = p.orientation === "direction" ? upVectorAxis(p.upVector) : null;
  const fixedBasis = fixedAxis ? basisFromUp(fixedAxis) : null;
  const out: Instance[] = [];
  for (let i = 0; i < localPositions.length; i++) {
    const lp = localPositions[i]!;
    const position: Vec3 = [
      m[0]! * lp[0] + m[4]! * lp[1] + m[8]! * lp[2] + m[12]!,
      m[1]! * lp[0] + m[5]! * lp[1] + m[9]! * lp[2] + m[13]!,
      m[2]! * lp[0] + m[6]! * lp[1] + m[10]! * lp[2] + m[14]!,
    ];
    let basis: number[];
    if (fixedBasis) {
      basis = fixedBasis;
    } else {
      const ld = localDirs[i] ?? [0, 1, 0];
      const dir = normalize([
        m[0]! * ld[0] + m[4]! * ld[1] + m[8]! * ld[2],
        m[1]! * ld[0] + m[5]! * ld[1] + m[9]! * ld[2],
        m[2]! * ld[0] + m[6]! * ld[1] + m[10]! * ld[2],
      ]);
      basis = basisFromUp(dir);
    }
    out.push({ position, basis });
  }
  return out;
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
