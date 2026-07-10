import { HEMesh, type HEMeshSnapshot } from "@/geometry/kernel/HEMesh";

/**
 * JSON-safe (de)serialization of kernel meshes for the interim localStorage
 * autosave: typed arrays travel as base64 of their little-endian bytes.
 * Same-machine round-trips only — the real cross-machine format is the
 * binary .hem chunk inside the .thride package (H1).
 */
export interface PackedMesh {
  vCount: number;
  heCount: number;
  fCount: number;
  heNext: string;
  heTwin: string;
  heVert: string;
  heFace: string;
  heUV: string;
  vPos: string;
  vHE: string;
  fHE: string;
}

const B64_CHUNK = 0x8000; // String.fromCharCode arg-spread limit safety

function toB64(a: Int32Array | Float32Array): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(bin);
}

function fromB64(s: string): ArrayBuffer {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function packMesh(mesh: HEMesh): PackedMesh {
  const s = mesh.snapshot();
  return {
    vCount: s.vCount,
    heCount: s.heCount,
    fCount: s.fCount,
    heNext: toB64(s.heNext),
    heTwin: toB64(s.heTwin),
    heVert: toB64(s.heVert),
    heFace: toB64(s.heFace),
    heUV: toB64(s.heUV),
    vPos: toB64(s.vPos),
    vHE: toB64(s.vHE),
    fHE: toB64(s.fHE),
  };
}

/** Throws on malformed input — callers drop the mesh rather than crash. */
export function unpackMesh(p: PackedMesh): HEMesh {
  const snapshot: HEMeshSnapshot = {
    vCount: p.vCount,
    heCount: p.heCount,
    fCount: p.fCount,
    heNext: new Int32Array(fromB64(p.heNext)),
    heTwin: new Int32Array(fromB64(p.heTwin)),
    heVert: new Int32Array(fromB64(p.heVert)),
    heFace: new Int32Array(fromB64(p.heFace)),
    heUV: new Float32Array(fromB64(p.heUV)),
    vPos: new Float32Array(fromB64(p.vPos)),
    vHE: new Int32Array(fromB64(p.vHE)),
    fHE: new Int32Array(fromB64(p.fHE)),
  };
  if (snapshot.vPos.length < snapshot.vCount * 3 || snapshot.heNext.length < snapshot.heCount) {
    throw new Error("meshPack: truncated mesh data");
  }
  return HEMesh.fromSnapshot(snapshot);
}
