import type { HEMesh } from "./HEMesh";

export interface MeshValidation {
  ok: boolean;
  errors: string[];
  /** V - E + F (2 for closed genus-0, 1 for a disk, etc). */
  eulerCharacteristic: number;
  boundaryEdges: number;
}

/**
 * Structural invariant checker — the backbone of the kernel property tests.
 * Every modeling op must leave the mesh passing this.
 */
export function validateMesh(m: HEMesh): MeshValidation {
  const errors: string[] = [];

  // twin symmetry + opposing origins
  for (let h = 0; h < m.heCount; h++) {
    const t = m.heTwin[h]!;
    if (t === -1) continue;
    if (t < 0 || t >= m.heCount) errors.push(`he ${h}: twin ${t} out of range`);
    else {
      if (m.heTwin[t] !== h) errors.push(`he ${h}: twin asymmetry`);
      if (m.heVert[t] !== m.heVert[m.heNext[h]!]) {
        errors.push(`he ${h}: twin origin mismatch`);
      }
    }
  }

  // next cycles: closed, face-consistent, cover every halfedge exactly once
  const seen = new Uint8Array(m.heCount);
  for (let f = 0; f < m.fCount; f++) {
    const start = m.fHE[f]!;
    let h = start;
    let steps = 0;
    do {
      if (seen[h]) {
        errors.push(`face ${f}: halfedge ${h} visited twice`);
        break;
      }
      seen[h] = 1;
      if (m.heFace[h] !== f) errors.push(`face ${f}: halfedge ${h} claims face ${m.heFace[h]}`);
      h = m.heNext[h]!;
      if (++steps > m.heCount) {
        errors.push(`face ${f}: next-cycle does not close`);
        break;
      }
    } while (h !== start);
    if (steps < 3) errors.push(`face ${f}: degenerate loop (${steps})`);
  }
  for (let h = 0; h < m.heCount; h++) {
    if (!seen[h]) errors.push(`halfedge ${h}: not in any face loop`);
  }

  // vertex -> outgoing halfedge consistency
  for (let v = 0; v < m.vCount; v++) {
    const h = m.vHE[v]!;
    if (h === -1) continue; // isolated vertex tolerated (post-delete)
    if (h < 0 || h >= m.heCount || m.heVert[h] !== v) {
      errors.push(`vertex ${v}: vHE inconsistent`);
    }
  }

  let boundary = 0;
  for (let h = 0; h < m.heCount; h++) if (m.heTwin[h] === -1) boundary++;
  const E = (m.heCount - boundary) / 2 + boundary;

  return {
    ok: errors.length === 0,
    errors,
    eulerCharacteristic: m.vCount - E + m.fCount,
    boundaryEdges: boundary,
  };
}
