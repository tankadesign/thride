import type { MaterialGraphDTO, Uuid } from "@/types/core";
import { noiseDef } from "@/materials/noises";

/**
 * Per-node problems for the editor's error badges (E7 Stage 6). Everything
 * reported here is STRUCTURAL (wiring / select values), so badges computed at
 * canvas build time stay correct until the next structural rebuild.
 *
 * The compiler never throws for these — a cycle reads as mid-gray and an
 * unknown noise renders the fallback — the badge just tells the artist why a
 * node isn't doing what they expect.
 */
export function graphProblems(graph: MaterialGraphDTO): Map<Uuid, string> {
  const problems = new Map<Uuid, string>();

  for (const n of graph.nodes) {
    if (n.kind === "noise" && !noiseDef(n.select?.noise ?? "perlin")) {
      problems.set(n.id, `Unknown noise type "${n.select?.noise}" — renders mid-gray`);
    }
  }

  // cycle membership: a node is in a cycle iff it can reach itself. Graphs are
  // tiny (tens of nodes), so the O(V·E) walk is fine and dead simple.
  const outgoing = new Map<Uuid, Uuid[]>();
  for (const c of graph.connections) {
    const list = outgoing.get(c.from.node) ?? [];
    list.push(c.to.node);
    outgoing.set(c.from.node, list);
  }
  for (const n of graph.nodes) {
    if (problems.has(n.id)) continue;
    const seen = new Set<Uuid>();
    const stack = [...(outgoing.get(n.id) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === n.id) {
        problems.set(n.id, "Part of a cycle — its wire reads as mid-gray");
        break;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(outgoing.get(id) ?? []));
    }
  }

  return problems;
}
