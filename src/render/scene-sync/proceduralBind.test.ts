import { describe, expect, it } from "vitest";
import type { MaterialDTO, MaterialGraphDTO, Uuid } from "@/types/core";
import { defaultLayer, defaultMaterialData } from "@/types/core";
import { getGraphCompileCount, resetGraphCompileCount } from "@/materials/graph";
import { compileLook, hasGraph, hasLook, lookKey } from "./proceduralBind";

/**
 * The E7 Stage-3 seam: `compileLook` normalizes the two authoring front-ends
 * (E7 graph, E3 layer stack) to one compiled look. This proves the render layer
 * never has to branch on which produced it — graph wins when present, a
 * front-end switch is structural, and a param scrub pokes uniforms with no
 * recompile (asserted against the real compile counter). Logic-level: TSL nodes
 * are built but never sent to a device.
 */

const id = (s: string) => s as Uuid;

/** A graph that drives Output.color from a perlin noise. */
function colorGraph(): MaterialGraphDTO {
  return {
    output: id("out"),
    nodes: [
      { id: id("out"), kind: "output" },
      { id: id("n"), kind: "noise", select: { noise: "perlin" }, params: { scale: 3 } },
    ],
    connections: [
      { from: { node: id("n"), socket: "out" }, to: { node: id("out"), socket: "color" } },
    ],
  };
}

function mat(patch: Partial<MaterialDTO>): MaterialDTO {
  return { ...defaultMaterialData(), id: id("m"), name: "m", ...patch };
}

const stackDto = () =>
  mat({ procedural: { channels: { color: { layers: [defaultLayer(id("a"), "perlin")] } } } });

const clone = (d: MaterialDTO): MaterialDTO => JSON.parse(JSON.stringify(d)) as MaterialDTO;

describe("compileLook — graph/stack normalization", () => {
  it("hasGraph is false for an empty graph, true once a channel is wired", () => {
    expect(
      hasGraph(
        mat({
          graph: { output: id("out"), nodes: [{ id: id("out"), kind: "output" }], connections: [] },
        }),
      ),
    ).toBe(false);
    expect(hasGraph(mat({ graph: colorGraph() }))).toBe(true);
  });

  it("lookKey tags the front-end (g: vs s:) so a switch is structural", () => {
    const g = lookKey(mat({ graph: colorGraph() }));
    const s = lookKey(stackDto());
    expect(g.startsWith("g:")).toBe(true);
    expect(s.startsWith("s:")).toBe(true);
    expect(g).not.toBe(s);
    expect(lookKey(mat({}))).toBe(""); // no look
    expect(lookKey(undefined)).toBe("");
  });

  it("the graph wins when a material somehow has both front-ends", () => {
    const both = mat({ graph: colorGraph(), procedural: stackDto().procedural });
    expect(lookKey(both).startsWith("g:")).toBe(true);
    expect(hasLook(both)).toBe(true);
  });

  it("a graph param scrub applies without recompiling", () => {
    resetGraphCompileCount();
    const dto = mat({ graph: colorGraph() });
    const look = compileLook(dto)!;
    expect(look).toBeTruthy();
    expect(look.nodes.color).toBeTruthy();
    expect(getGraphCompileCount()).toBe(1);

    const edited = clone(dto);
    edited.graph!.nodes.find((n) => n.id === "n")!.params!.scale = 9;
    expect(look.applies(edited)).toBe(true); // param-only
    look.update(edited);
    expect(getGraphCompileCount()).toBe(1); // no recompile
    look.dispose();
  });

  it("switching front-ends (graph → stack) does NOT apply — forces a rebuild", () => {
    const look = compileLook(mat({ graph: colorGraph() }))!;
    // same material id, but now a layer stack instead of a graph
    expect(look.applies(stackDto())).toBe(false);
    look.dispose();
  });

  it("a structural graph edit (noise-type swap) does NOT apply", () => {
    const dto = mat({ graph: colorGraph() });
    const look = compileLook(dto)!;
    const edited = clone(dto);
    edited.graph!.nodes.find((n) => n.id === "n")!.select!.noise = "worley";
    expect(look.applies(edited)).toBe(false);
    look.dispose();
  });

  it("a plain scalar material has no look", () => {
    expect(compileLook(mat({}))).toBeUndefined();
    expect(hasLook(mat({}))).toBe(false);
  });
});
