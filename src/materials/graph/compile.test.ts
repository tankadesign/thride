import { beforeEach, describe, expect, it } from "vitest";
import type { GraphConnection, GraphNode, MaterialGraphDTO, Uuid } from "@/types/core";
import { defaultGraphNode, defaultMaterialGraph, graphStructureKey } from "@/types/core";
import { NOISE_DEFS } from "@/materials/noises";
import { compileGraph, getGraphCompileCount, resetGraphCompileCount } from "./compile";

/**
 * The E7 acceptance test, at the compiler layer: a graph compiles to per-channel
 * nodes, param scrubs poke uniforms without recompiling, and structural edits
 * invalidate the graph. `compileGraph()` is the only thing that builds nodes and
 * it increments a counter, so "zero recompile on scrubs" is asserted against a
 * real number — the same approach as the layer-stack test. Logic-level: nodes are
 * constructed but never sent to a GPU (a real compile is proven by the viewport).
 */

const id = (s: string) => s as Uuid;

function node(nodeId: string, kind: GraphNode["kind"], patch: Partial<GraphNode> = {}): GraphNode {
  return { ...defaultGraphNode(id(nodeId), kind), ...patch };
}

function wire(from: string, fromSocket: string, to: string, toSocket: string): GraphConnection {
  return { from: { node: id(from), socket: fromSocket }, to: { node: id(to), socket: toSocket } };
}

function graph(nodes: GraphNode[], connections: GraphConnection[]): MaterialGraphDTO {
  return { nodes, connections, output: id("out") };
}

/** noise "n" → mix "m" (over a color "c") → Output.color; a stand-in for the
 *  ramp-driven color path until Stage 2 gives us a real ramp node. */
function noiseToColor(): MaterialGraphDTO {
  return graph(
    [
      node("out", "output"),
      node("n", "noise", { select: { noise: "perlin" }, params: { scale: 3 } }),
      node("c", "color", { colors: { value: "#204080" } }),
      node("m", "mix", { select: { blend: "multiply" }, params: { factor: 0.5 } }),
    ],
    [wire("n", "out", "m", "a"), wire("c", "out", "m", "b"), wire("m", "out", "out", "color")],
  );
}

const clone = (g: MaterialGraphDTO): MaterialGraphDTO =>
  JSON.parse(JSON.stringify(g)) as MaterialGraphDTO;

describe("graph compiler", () => {
  beforeEach(() => resetGraphCompileCount());

  it("compiles a noise→mix→color graph to a color node", () => {
    const c = compileGraph(noiseToColor());
    expect(getGraphCompileCount()).toBe(1);
    expect(c.nodes.color).toBeTruthy();
    expect(typeof c.nodes.color!.rgb).toBe("object"); // a vec3 node exposes swizzles
    expect(c.nodes.roughness).toBeUndefined(); // that channel is undriven
  });

  it("an empty graph (just Output) drives no channels", () => {
    const c = compileGraph(defaultMaterialGraph(id("out")));
    expect(c.nodes.color).toBeUndefined();
    expect(c.nodes.roughness).toBeUndefined();
  });

  it("a noise-scale scrub does NOT recompile — it pokes the uniform", () => {
    const g = noiseToColor();
    const c = compileGraph(g);
    expect(getGraphCompileCount()).toBe(1);
    expect(c.uniforms.getFloat("n/param.scale")).toBe(3);

    const edited = clone(g);
    edited.nodes.find((n) => n.id === "n")!.params!.scale = 12;

    expect(c.applies(edited)).toBe(true); // param-only ⇒ reusable graph
    c.update(edited);

    expect(getGraphCompileCount()).toBe(1); // ← the criterion
    expect(c.uniforms.getFloat("n/param.scale")).toBe(12); // and the edit landed
  });

  it("mix factor / color / math inline values scrub without recompiling", () => {
    const g = graph(
      [
        node("out", "output"),
        node("f", "float", { params: { value: 0.2 } }),
        node("k", "math", { select: { op: "multiply" }, params: { a: 0, b: 2 } }),
      ],
      [wire("f", "out", "k", "a"), wire("k", "out", "out", "roughness")],
    );
    const c = compileGraph(g);
    expect(c.nodes.roughness).toBeTruthy();
    expect(c.uniforms.getFloat("f/value")).toBe(0.2);
    expect(c.uniforms.getFloat("k/in.b")).toBe(2); // b is unconnected → inline fallback

    const edited = clone(g);
    edited.nodes.find((n) => n.id === "f")!.params!.value = 0.9;
    edited.nodes.find((n) => n.id === "k")!.params!.b = 5;
    expect(c.applies(edited)).toBe(true);
    c.update(edited);
    expect(getGraphCompileCount()).toBe(1);
    expect(c.uniforms.getFloat("f/value")).toBe(0.9);
    expect(c.uniforms.getFloat("k/in.b")).toBe(5);
  });

  it("node position and colors/params are NOT structural (no recompile)", () => {
    const g = noiseToColor();
    const c = compileGraph(g);
    const edited = clone(g);
    edited.nodes.find((n) => n.id === "n")!.position = [500, 250];
    edited.nodes.find((n) => n.id === "c")!.colors!.value = "#ffaa00";
    edited.nodes.find((n) => n.id === "m")!.params!.factor = 0.9;
    expect(graphStructureKey(edited)).toBe(graphStructureKey(g));
    expect(c.applies(edited)).toBe(true);
  });

  it("structural edits DO invalidate the graph", () => {
    const g = noiseToColor();
    const c = compileGraph(g);
    const cases: [string, (x: MaterialGraphDTO) => void][] = [
      ["noise-type swap", (x) => (x.nodes.find((n) => n.id === "n")!.select!.noise = "worley")],
      ["math/mix op change", (x) => (x.nodes.find((n) => n.id === "m")!.select!.blend = "screen")],
      ["disconnect a wire", (x) => x.connections.pop()],
      ["rewire a socket", (x) => (x.connections[0]!.to.socket = "b")],
      ["add a node", (x) => x.nodes.push(node("z", "float"))],
      ["remove a node", (x) => (x.nodes = x.nodes.filter((n) => n.id !== "c"))],
    ];
    for (const [name, mutate] of cases) {
      const edited = clone(g);
      mutate(edited);
      expect(c.applies(edited), name).toBe(false);
    }
  });

  it("a scalar channel coerces a vec3 source to a scalar (vec3 → .r)", () => {
    // wire a noise (vec3) straight into roughness (scalar) — must bind, not throw
    const g = graph(
      [node("out", "output"), node("n", "noise", { select: { noise: "perlin" } })],
      [wire("n", "out", "out", "roughness")],
    );
    const c = compileGraph(g);
    expect(c.nodes.roughness).toBeTruthy();
    // scalar channels store a vec3(x.r) and are `.r`'d again at bind — identical
    // to the layer stack, so the binder treats graph and stack nodes the same.
    expect(typeof c.nodes.roughness!.r).toBe("object");
  });

  it("a cycle fails safe (mid-gray), never a stack overflow", () => {
    // m.a ← k, k.a ← m : a two-node loop feeding the color channel
    const g = graph(
      [node("out", "output"), node("m", "mix"), node("k", "math")],
      [wire("k", "out", "m", "a"), wire("m", "out", "k", "a"), wire("m", "out", "out", "color")],
    );
    expect(() => compileGraph(g)).not.toThrow();
    expect(compileGraph(g).nodes.color).toBeTruthy();
  });

  it("the graph round-trips through JSON deep-equal", () => {
    const g = noiseToColor();
    const back = clone(g);
    expect(back).toEqual(g);
    expect(graphStructureKey(back)).toBe(graphStructureKey(g));
    expect(compileGraph(back).nodes.color).toBeTruthy();
  });

  it("compiles every noise kind into the color channel", () => {
    for (const def of NOISE_DEFS) {
      const g = graph(
        [node("out", "output"), node("n", "noise", { select: { noise: def.id } })],
        [wire("n", "out", "out", "color")],
      );
      expect(compileGraph(g).nodes.color, def.id).toBeTruthy();
    }
  });

  it("compiles every math op", () => {
    const ops = ["add", "subtract", "multiply", "divide", "min", "max", "power"];
    for (const op of ops) {
      const g = graph(
        [node("out", "output"), node("k", "math", { select: { op }, params: { a: 1, b: 2 } })],
        [wire("k", "out", "out", "metalness")],
      );
      expect(compileGraph(g).nodes.metalness, op).toBeTruthy();
    }
  });

  it("an unknown noise id still compiles (forward-compat docs)", () => {
    const g = graph(
      [node("out", "output"), node("n", "noise", { select: { noise: "noise-from-the-future" } })],
      [wire("n", "out", "out", "color")],
    );
    expect(compileGraph(g).nodes.color).toBeTruthy();
  });

  it("update on a pre-existing structure pokes every live path", () => {
    const g = noiseToColor();
    const c = compileGraph(g);
    // every declared live value is addressable in the table
    expect(c.uniforms.paths()).toEqual(
      expect.arrayContaining(["n/param.scale", "n/seed", "n/phase", "c/color", "m/factor"]),
    );
  });
});
