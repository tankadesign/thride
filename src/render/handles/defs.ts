import type { PrimitiveDescriptor } from "@/types/geometry/primitives";

/**
 * C4D-style primitive adjustment handles: one per float parameter, sitting
 * on the shape's extent along a local axis. Dragging along `axis` yields a
 * local-space extent; `set` maps extent → parameter value.
 */
export interface HandleDef {
  param: string;
  /** Local-space drag axis (unit). */
  axis: [number, number, number];
  /** Local-space handle position for current params. */
  pos: (p: Record<string, number>) => [number, number, number];
  /** Apply a dragged extent (distance along axis from origin) to the params. */
  set: (p: Record<string, number>, extent: number) => void;
}

const MIN = 0.001;
const pos3 = (x: number, y: number, z: number): [number, number, number] => [x, y, z];

/** Handle sets per primitive type (float params only — ints have no handles). */
export function handleDefs(desc: PrimitiveDescriptor): HandleDef[] {
  switch (desc.type) {
    case "cube":
      return [
        {
          param: "width",
          axis: [1, 0, 0],
          pos: (p) => pos3(p.width! / 2, 0, 0),
          set: (p, e) => (p.width = Math.max(MIN, e * 2)),
        },
        {
          param: "height",
          axis: [0, 1, 0],
          pos: (p) => pos3(0, p.height! / 2, 0),
          set: (p, e) => (p.height = Math.max(MIN, e * 2)),
        },
        {
          param: "depth",
          axis: [0, 0, 1],
          pos: (p) => pos3(0, 0, p.depth! / 2),
          set: (p, e) => (p.depth = Math.max(MIN, e * 2)),
        },
      ];
    case "plane":
      return [
        {
          param: "width",
          axis: [1, 0, 0],
          pos: (p) => pos3(p.width! / 2, 0, 0),
          set: (p, e) => (p.width = Math.max(MIN, e * 2)),
        },
        {
          param: "depth",
          axis: [0, 0, 1],
          pos: (p) => pos3(0, 0, p.depth! / 2),
          set: (p, e) => (p.depth = Math.max(MIN, e * 2)),
        },
      ];
    case "disc":
    case "sphere":
    case "icosphere":
      return [
        {
          param: "radius",
          axis: [1, 0, 0],
          pos: (p) => pos3(p.radius!, 0, 0),
          set: (p, e) => (p.radius = Math.max(MIN, e)),
        },
      ];
    case "cylinder":
      return [
        {
          param: "radiusTop",
          axis: [1, 0, 0],
          pos: (p) => pos3(p.radiusTop!, p.height! / 2, 0),
          set: (p, e) => (p.radiusTop = Math.max(0, e)),
        },
        {
          param: "radiusBottom",
          axis: [1, 0, 0],
          pos: (p) => pos3(p.radiusBottom!, -p.height! / 2, 0),
          set: (p, e) => (p.radiusBottom = Math.max(0, e)),
        },
        {
          param: "height",
          axis: [0, 1, 0],
          pos: (p) => pos3(0, p.height! / 2, 0),
          set: (p, e) => (p.height = Math.max(MIN, e * 2)),
        },
      ];
    case "cone":
      return [
        {
          param: "radius",
          axis: [1, 0, 0],
          pos: (p) => pos3(p.radius!, -p.height! / 2, 0),
          set: (p, e) => (p.radius = Math.max(MIN, e)),
        },
        {
          param: "height",
          axis: [0, 1, 0],
          pos: (p) => pos3(0, p.height! / 2, 0),
          set: (p, e) => (p.height = Math.max(MIN, e * 2)),
        },
      ];
    case "capsule":
      return [
        {
          param: "radius",
          axis: [1, 0, 0],
          pos: (p) => pos3(p.radius!, 0, 0),
          set: (p, e) => (p.radius = Math.max(MIN, e)),
        },
        {
          param: "height",
          axis: [0, 1, 0],
          pos: (p) => pos3(0, p.height! / 2, 0),
          set: (p, e) => (p.height = Math.max(MIN, e * 2)),
        },
      ];
    case "torus":
      return [
        {
          param: "radius",
          axis: [1, 0, 0],
          pos: (p) => pos3(p.radius!, 0, 0),
          set: (p, e) => (p.radius = Math.max(MIN, e)),
        },
        {
          param: "tube",
          axis: [0, 1, 0],
          pos: (p) => pos3(p.radius!, p.tube!, 0),
          set: (p, e) => (p.tube = Math.max(MIN, e)),
        },
      ];
    case "pyramid":
      return [
        {
          param: "width",
          axis: [1, 0, 0],
          pos: (p) => pos3(p.width! / 2, -p.height! / 2, 0),
          set: (p, e) => (p.width = Math.max(MIN, e * 2)),
        },
        {
          param: "depth",
          axis: [0, 0, 1],
          pos: (p) => pos3(0, -p.height! / 2, p.depth! / 2),
          set: (p, e) => (p.depth = Math.max(MIN, e * 2)),
        },
        {
          param: "height",
          axis: [0, 1, 0],
          pos: (p) => pos3(0, p.height! / 2, 0),
          set: (p, e) => (p.height = Math.max(MIN, e * 2)),
        },
      ];
  }
}
