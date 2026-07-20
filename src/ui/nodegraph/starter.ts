import { defaultGraphNode, defaultMaterialGraph, type MaterialGraphDTO } from "@/types/core";
import { uuidv7 } from "@/core";

/**
 * A ready-to-render starter graph: `coord → fractal noise → ramp → Output.color`
 * — the canonical E7 done-when shape. Seeded when the user turns a material into
 * a node material so the panel (and the live viewport, via MaterialSync) has
 * something to show immediately, instead of an empty Output node.
 */
export function starterGraph(): MaterialGraphDTO {
  const out = uuidv7();
  const coord = uuidv7();
  const noise = uuidv7();
  const ramp = uuidv7();

  const g = defaultMaterialGraph(out);
  const outNode = g.nodes[0]!;
  outNode.position = [640, 60];

  const coordNode = defaultGraphNode(coord, "coord", [-40, 60]);
  const noiseNode = defaultGraphNode(noise, "noise", [220, 60]);
  noiseNode.select = { noise: "fractal" };
  noiseNode.params = { scale: 4 };
  const rampNode = defaultGraphNode(ramp, "ramp", [440, 60]);

  g.nodes.push(coordNode, noiseNode, rampNode);
  g.connections.push(
    { from: { node: coord, socket: "out" }, to: { node: noise, socket: "coord" } },
    { from: { node: noise, socket: "out" }, to: { node: ramp, socket: "t" } },
    { from: { node: ramp, socket: "out" }, to: { node: out, socket: "color" } },
  );
  return g;
}
