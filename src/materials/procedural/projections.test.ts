import { describe, expect, it } from "vitest";
import type { Projection } from "@/types/core";
import { PROJECTIONS } from "@/types/core";
import { uniform, vec3 } from "@/materials/tsl";
import { projectedSample, type TransformNodes } from "./projections";
import { Vector3 } from "three";

/**
 * Every projection the COMPILER supports — the UI list plus `camera`, which was
 * pulled from PROJECTIONS until scene cameras exist (F4) but must keep building
 * for persisted docs that reference it.
 */
const ALL_PROJECTIONS: Projection[] = [...PROJECTIONS.map((p) => p.projection), "camera"];

/**
 * What's assertable here without a GPU: that every projection builds a graph,
 * and — the one that actually bites — that triplanar invokes the noise three
 * times while the rest invoke it once. The visual correctness of each mapping is
 * verified in the browser on a sphere + cube (see PLAN_PROGRESS); there is no
 * reference-render harness in the repo.
 */

const nodes = (): TransformNodes => ({
  offset: uniform(new Vector3(0, 0, 0)),
  rotation: uniform(new Vector3(0, 0, 0)),
  scale: uniform(new Vector3(1, 1, 1)),
});

describe("projections", () => {
  it("every projection builds a graph", () => {
    for (const projection of ALL_PROJECTIONS) {
      const out = projectedSample(projection, nodes(), (coord) => vec3(coord));
      expect(out, projection).toBeTruthy();
      expect(typeof out.rgb, projection).toBe("object");
    }
  });

  it("triplanar samples the noise 3x; every other projection samples once", () => {
    for (const projection of ALL_PROJECTIONS) {
      let calls = 0;
      projectedSample(projection, nodes(), (coord) => {
        calls++;
        return vec3(coord);
      });
      expect(calls, projection).toBe(projection === "triplanar" ? 3 : 1);
    }
  });

  it("passes a 3-component coordinate to the noise in every projection", () => {
    // noises index .x/.y/.z — a vec2 coord would break them at WGSL generation,
    // which no logic test can see, so pin the shape at construction instead
    for (const projection of ALL_PROJECTIONS) {
      projectedSample(projection, nodes(), (coord) => {
        expect(coord.x, projection).toBeTruthy();
        expect(coord.y, projection).toBeTruthy();
        expect(coord.z, projection).toBeTruthy();
        return vec3(coord);
      });
    }
  });
});
