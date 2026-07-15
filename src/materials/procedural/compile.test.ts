import { beforeEach, describe, expect, it } from "vitest";
import type { ProceduralLayer, ProceduralMaterialDoc, Uuid } from "@/types/core";
import { defaultLayer, defaultRamp, structureKey } from "@/types/core";
import { NOISE_DEFS } from "@/materials/noises";
import { compile, getCompileCount, resetCompileCount } from "./compile";

/**
 * The E3 acceptance test: **param edits never recompile.** `compile()` is the
 * only thing that builds nodes and it increments a counter, so this asserts the
 * real, observable behavior rather than a proxy for it. Logic-level — the node
 * graph is constructed but never sent to a GPU (same approach as the E2 registry
 * test; a real compile is proven by the viewport/thumbnail render).
 */

const layer = (id: string, patch: Partial<ProceduralLayer> = {}): ProceduralLayer => ({
  ...defaultLayer(id as Uuid, "perlin"),
  params: { scale: 3 },
  ...patch,
});

const doc = (...layers: ProceduralLayer[]): ProceduralMaterialDoc => ({
  channels: { color: { layers } },
});

/** Deep-ish clone so a test edit can't alias the compiled doc. */
const clone = (d: ProceduralMaterialDoc): ProceduralMaterialDoc =>
  JSON.parse(JSON.stringify(d)) as ProceduralMaterialDoc;

describe("layer-stack compiler", () => {
  beforeEach(() => resetCompileCount());

  it("compiles a channel stack to a node", () => {
    const c = compile(doc(layer("a")));
    expect(getCompileCount()).toBe(1);
    expect(c.nodes.color).toBeTruthy();
    // a TSL vec3 node exposes swizzles
    expect(typeof c.nodes.color.rgb).toBe("object");
    expect(c.nodes.roughness).toBeUndefined(); // no stack for that channel
  });

  it("a noise param edit does NOT recompile — it pokes the uniform", () => {
    const d = doc(layer("a"));
    const c = compile(d);
    expect(getCompileCount()).toBe(1);
    expect(c.uniforms.getFloat("a/param.scale")).toBe(3);

    const edited = clone(d);
    edited.channels.color!.layers[0]!.params.scale = 12;

    expect(c.applies(edited)).toBe(true); // param-only ⇒ reusable graph
    c.update(edited);

    expect(getCompileCount()).toBe(1); // ← the criterion
    // ...and the edit actually landed (else a no-op update would pass the above)
    expect(c.uniforms.getFloat("a/param.scale")).toBe(12);
  });

  it("opacity / color / transform edits do NOT recompile", () => {
    const d = doc(layer("a"));
    const c = compile(d);

    const edited = clone(d);
    const l = edited.channels.color!.layers[0]!;
    l.opacity = 0.25;
    l.color = "#ff0000";
    l.transform.offset = [5, 0, 0];
    l.transform.rotation = [0, 1.57, 0];
    l.transform.scale = [2, 2, 2];

    expect(c.applies(edited)).toBe(true);
    c.update(edited);
    expect(getCompileCount()).toBe(1);

    expect(c.uniforms.getFloat("a/opacity")).toBe(0.25);
    expect(c.uniforms.getColorHex("a/color")).toBe("ff0000");
    expect(c.uniforms.getVec3("a/offset")).toEqual([5, 0, 0]);
    expect(c.uniforms.getVec3("a/rotation")).toEqual([0, 1.57, 0]);
    expect(c.uniforms.getVec3("a/scale")).toEqual([2, 2, 2]);
  });

  it("a ramp stop edit does NOT recompile (the DataTexture is re-baked)", () => {
    const d = doc(layer("a", { ramp: defaultRamp() }));
    const c = compile(d);

    const edited = clone(d);
    edited.channels.color!.layers[0]!.ramp!.stops = [
      { t: 0, color: "#ff0000" },
      { t: 0.5, color: "#00ff00" },
      { t: 1, color: "#0000ff" },
    ];

    // adding/moving/recoloring stops is texture data, not graph shape
    expect(c.applies(edited)).toBe(true);
    c.update(edited);
    expect(getCompileCount()).toBe(1);
  });

  it("every live-tunable field of a layer is in the uniform table", () => {
    const c = compile(doc(layer("a")));
    const paths = c.uniforms.paths();
    expect(paths).toEqual(
      expect.arrayContaining([
        "a/opacity",
        "a/color",
        "a/offset",
        "a/rotation",
        "a/scale",
        "a/phase",
        "a/param.scale",
      ]),
    );
  });

  it("structural edits DO invalidate the graph", () => {
    const d = doc(layer("a"), layer("b"));
    const c = compile(d);

    const cases: [string, (x: ProceduralMaterialDoc) => void][] = [
      ["source swap", (x) => (x.channels.color!.layers[0]!.source = "worley")],
      ["blend change", (x) => (x.channels.color!.layers[0]!.blend = "multiply")],
      ["projection change", (x) => (x.channels.color!.layers[0]!.projection = "spherical")],
      ["layer disabled", (x) => (x.channels.color!.layers[0]!.enabled = false)],
      ["layer removed", (x) => x.channels.color!.layers.pop()],
      ["reorder", (x) => x.channels.color!.layers.reverse()],
      ["ramp added", (x) => (x.channels.color!.layers[0]!.ramp = defaultRamp())],
    ];
    for (const [name, mutate] of cases) {
      const edited = clone(d);
      mutate(edited);
      expect(c.applies(edited), name).toBe(false);
    }
  });

  it("structureKey ignores values and tracks shape", () => {
    const d = doc(layer("a"));
    const params = clone(d);
    params.channels.color!.layers[0]!.params.scale = 99;
    params.channels.color!.layers[0]!.opacity = 0.1;
    expect(structureKey(params)).toBe(structureKey(d));

    const shape = clone(d);
    shape.channels.color!.layers[0]!.blend = "screen";
    expect(structureKey(shape)).not.toBe(structureKey(d));
  });

  it("an unknown noise source still compiles (forward-compat docs)", () => {
    const c = compile(doc(layer("a", { source: "noise-from-the-future" })));
    expect(c.nodes.color).toBeTruthy();
  });

  /**
   * Structural coverage: every registry noise compiles in both the ramped and
   * rampless paths.
   *
   * NOTE what this does NOT prove. Node-graph *construction* is all that happens
   * here — three only validates component counts when it generates WGSL, on a
   * real device. A ramp lookup fed a vec3 instead of `.r` builds a 4-component
   * vec2: three logs an error at build and still renders something plausible,
   * so neither this test nor a screenshot catches it (both were green while it
   * was broken). That class of bug needs the live console — see the E2/E3 note
   * about there being no rendered-output regression guard.
   */
  it("compiles every noise source, rampless and ramped", () => {
    for (const def of NOISE_DEFS) {
      for (const ramp of [undefined, defaultRamp()]) {
        const c = compile(doc(layer(`n-${def.id}`, { source: def.id, ramp })));
        expect(c.nodes.color, `${def.id} ramp=${!!ramp}`).toBeTruthy();
      }
    }
  });

  it("compiles every channel independently", () => {
    const c = compile({
      channels: {
        color: { layers: [layer("a")] },
        roughness: { layers: [layer("b")] },
      },
    });
    expect(c.nodes.color).toBeTruthy();
    expect(c.nodes.roughness).toBeTruthy();
    expect(c.nodes.metalness).toBeUndefined();
  });
});
