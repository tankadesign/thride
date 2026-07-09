# PLAN_PROGRESS_3 — Geometry kernel, primitives, render sync

**Date:** 2026-07-09
**Chunks worked:** D1, D2 (core), D3
**Milestone context:** M0 in progress — 8 of 12 chunks done. Remaining: A2, A3, A4, C1, C2, C3, C4.

## Completed

- **D1** — `src/geometry/kernel/HEMesh.ts`: typed-array SoA half-edge (origin-vertex convention, twin=-1 boundaries, per-corner UVs in `heUV`), `fromPolygons` with non-manifold rejection, accessors, Newell face normals, area-weighted vertex normals, `snapshot()/restore()` (+`snapshotBytes` for history memoryCost), topologyVersion + dirty flags. `validate.ts`: twin symmetry, closed face-consistent next-cycles, full halfedge coverage, vHE consistency, Euler characteristic + boundary counting.
- **D3** — `src/geometry/primitives/`: cube, plane, disc, pyramid (basic.ts); sphere/cylinder/cone/capsule via a shared **lathe helper** — winding math lives once (lathe.ts); torus (closed grid); icosphere (subdivided icosahedron) (ico.ts). Basic UVs on all lathe/grid prims. Descriptors + defaults + labels in `src/types/geometry/primitives.ts` (`node.data.primitive` holds the descriptor; live params until D4 make-editable).
- **D2 (core parts)** — `src/geometry/sync/`: `triangulate` (tri direct, quad split, earcut in Newell-dominant plane for n-gons; `triFace`/corner maps), `RenderMesh` (non-indexed BufferGeometry with position/normal/uv; POSITIONS dirty → in-place rewrite, TOPOLOGY/restore → full rebuild).

## Deferred within D-chunks (to M1)

- Tube + platonic solids + landscape primitives; `updateRanges` partial uploads; BVH build (wired at C4 picking instead); 100k-tri perf budget in CI.

## Decisions made (and why)

- Poles/caps flow through one `lathe()` helper so the (error-prone) winding math exists exactly once; property tests assert outward normals on all convex closed prims.
- Cap n-gons are single faces (n-gon support is the kernel's point); disc = one 32-gon.
- Winding validated by test: face normal · centroid > 0 for convex closed primitives; Euler 2 (closed), 0 (torus), 1 (plane/disc).

## Test status

- `vp check`: pass (2 pre-existing warnings)
- `vp test`: 68 passed / 0 failed (10 files) — 34 new geometry tests

## Next steps

1. A2–A4 (design system, dockview shell, menus/commands/palette).
2. C1–C4 (renderer, C4D nav, multi-view, picking + gizmo), then M0 gate.
