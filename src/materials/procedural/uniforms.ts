import { Color, Vector3 } from "three";
import { uniform, type Vec3 } from "@/materials/tsl";

/**
 * The UniformTable (E3) — every live-tunable value in a compiled layer stack,
 * addressed by a stable string path so a doc edit can find and poke it without
 * touching the node graph.
 *
 * This table IS the recompile boundary. If a value has an entry here, editing it
 * is a `.value` write; if it doesn't, editing it is structural and forces a
 * recompile. Paths are `<layerId>/<field>`, e.g. `abc-123/opacity`,
 * `abc-123/param.scale`.
 */

// Uniform-node types. @types/three doesn't export `UniformNode`, so we name each
// via the ReturnType of a tiny factory over the barrel's `uniform`. Each result
// is BOTH a live TSL graph node and an object with a writable `.value` — exactly
// the two things a table entry is used for (wired into the graph, then poked).
const makeFloatU = (v: number) => uniform(v);
const makeVec3U = (v: Vector3) => uniform(v);
export type FloatUniform = ReturnType<typeof makeFloatU>;
export type Vec3Uniform = ReturnType<typeof makeVec3U>;
// A color uniform is a `vec3` in the graph — three treats Color nodes as vec3 in
// all math and coercions — but @types/three types `uniform(Color)` as the
// distinct `Node<"color">` with no vec3 conversion. Model the graph-facing shape
// (`Vec3`) intersected with the writable `.value: Color` the table pokes.
export type ColorUniform = Vec3 & { value: Color };

export class UniformTable {
  private readonly floats = new Map<string, FloatUniform>();
  private readonly colors = new Map<string, ColorUniform>();
  private readonly vec3s = new Map<string, Vec3Uniform>();

  /** Get-or-create a float uniform node at `path`, seeded with `initial`. */
  float(path: string, initial: number): FloatUniform {
    const existing = this.floats.get(path);
    if (existing) return existing;
    const u = makeFloatU(initial);
    this.floats.set(path, u);
    return u;
  }

  /** Get-or-create a color uniform node at `path`, seeded with a hex string. */
  color(path: string, hex: string): ColorUniform {
    const existing = this.colors.get(path);
    if (existing) return existing;
    // See ColorUniform: the graph type is vec3, so bridge the Node<"color"> that
    // `uniform(Color)` is typed as. Runtime-sound (color nodes ARE vec3-valued).
    const u = uniform(new Color(hex)) as unknown as ColorUniform;
    this.colors.set(path, u);
    return u;
  }

  /** Get-or-create a vec3 uniform node at `path`. */
  vec3(path: string, x: number, y: number, z: number): Vec3Uniform {
    const existing = this.vec3s.get(path);
    if (existing) return existing;
    const u = makeVec3U(new Vector3(x, y, z));
    this.vec3s.set(path, u);
    return u;
  }

  /** Poke a float. No-op (returns false) if `path` isn't in the table. */
  setFloat(path: string, value: number): boolean {
    const u = this.floats.get(path);
    if (!u) return false;
    u.value = value;
    return true;
  }

  setColor(path: string, hex: string): boolean {
    const u = this.colors.get(path);
    if (!u) return false;
    u.value.set(hex);
    return true;
  }

  setVec3(path: string, x: number, y: number, z: number): boolean {
    const u = this.vec3s.get(path);
    if (!u) return false;
    u.value.x = x;
    u.value.y = y;
    u.value.z = z;
    return true;
  }

  /** Every path in the table — for tests and debugging. */
  paths(): string[] {
    return [...this.floats.keys(), ...this.colors.keys(), ...this.vec3s.keys()].sort();
  }

  /** Current value at `path` — lets a test prove an edit actually landed. */
  getFloat(path: string): number | undefined {
    return this.floats.get(path)?.value;
  }

  /** Current color at `path` as hex — for tests. */
  getColorHex(path: string): string | undefined {
    return this.colors.get(path)?.value.getHexString();
  }

  /** Current vec3 at `path` as a tuple — for tests. */
  getVec3(path: string): [number, number, number] | undefined {
    const v = this.vec3s.get(path)?.value;
    return v ? [v.x, v.y, v.z] : undefined;
  }
}
