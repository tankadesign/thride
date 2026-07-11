import Module from "manifold-3d";

/**
 * Boolean worker: Manifold WASM runs off the main thread so CSG never
 * hitches the UI. One message per job; results transfer back zero-copy.
 */

interface TriMeshMsg {
  positions: Float32Array;
  triVerts: Uint32Array;
}

interface JobMsg {
  jobId: number;
  op: "union" | "subtract" | "intersect";
  a: TriMeshMsg;
  b: TriMeshMsg;
}

const manifoldReady = Module().then((wasm) => {
  wasm.setup();
  return wasm;
});

self.onmessage = async (e: MessageEvent<JobMsg>) => {
  const { jobId, op, a, b } = e.data;
  try {
    const wasm = await manifoldReady;
    const { Manifold, Mesh } = wasm;
    const make = (t: TriMeshMsg) =>
      new Manifold(new Mesh({ numProp: 3, vertProperties: t.positions, triVerts: t.triVerts }));
    const A = make(a);
    const B = make(b);
    const R =
      op === "union"
        ? Manifold.union(A, B)
        : op === "subtract"
          ? Manifold.difference(A, B)
          : Manifold.intersection(A, B);
    const out = R.getMesh();
    const positions = out.vertProperties;
    const triVerts = out.triVerts;
    A.delete();
    B.delete();
    R.delete();
    (self as unknown as Worker).postMessage({ jobId, ok: true, positions, triVerts }, [
      positions.buffer,
      triVerts.buffer,
    ]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ jobId, ok: false, error: String(err) });
  }
};
