# PLAN_PROGRESS_17 — Post-M1 spline polish: curves, sweep, 3D editing, fixes

Post-M1 user-driven session (M1 still awaiting sign-off). All work is spline /
generator polish on top of the signed-off-pending M1. Gates at each commit:
`tsc -b` clean, `vp test` green, verified live in the WebGPU viewport.

## What landed (newest first)

- **Sweep generator** (`3ba30b8`) — `generators/sweep.ts` + `sweep` in the
  generator union. Two ordered spline children ([0] profile, [1] path), each
  sampled + transform-baked into the sweep's space, profile transported via
  double-reflection **rotation-minimizing frames** (no Frenet flips). Closed
  profile on open path → manifold end caps. Memo key covers BOTH children.
  Create > Sweep + AttributesPanel segment sliders + Pipeline icon.
- **Curve primitives** (`ef49982`) — Circle / N-Side / Star / Helix as
  parametric spline nodes: `node.data.splinePrimitive` recipe bakes
  `node.data.spline`, so they render + feed extrude/sweep like any spline and
  edit live. Math in `geometry/splines/primitives.ts`. Rounding sliders
  0–1000 → 0–1 fraction (sharp → exact circle). Create > Spline submenu.
- **Boolean hides+unpicks inputs; extrude respects 3D** (`a44a3fe`) —
  `isConsumed()` (ancestor is a boolean) drives both render visibility and
  `visibleNodeIdOf` so inputs vanish and clicks fall through. Extrude now fits
  the profile's **best-fit plane** (`geometry/splines/planeFrame.ts`, Newell)
  and extrudes along its normal; planar-XY = identity (tests unchanged).
- **Uncouple generator on reparent-out** (`9fcbd8a`) — reparent re-evaluates
  the OLD parent generator too; `syncGeometry` clears a generator whose input
  vanished (hides the object — an attribute-less geometry crashes the WebGPU
  pass, same class as the empty-Line2 freeze).
- **3D point drag + extrude height segments** (`06680e1`) — spline point/handle
  drags ride a camera-facing plane (full 3D, fixes edge-on-view lock);
  `heightSegments` param on extrude.
- Earlier this session: composeTRS euler-order fix (`d7da9b2`), nested-submenu
  flyout fix + spline-visible-while-drawing + ACES default (`3cdb2de`), project
  tab inline rename (`042382a`).

## Load-bearing gotcha (bit twice)

An **attribute-less geometry** (empty `BufferGeometry`, or a `LineGeometry`
with <2 points) still makes WebGPU compile a material pipeline that fails
validation and **aborts every subsequent frame** — the viewport freezes on the
last good frame. Never submit one: hide the object instead. See
`SplineSync.syncSplineGeometry` and `SceneSynchronizer.clearGeometry`.

## Known limitations / notes

- Extrude flattens a non-planar profile to its best-fit plane (a truly
  scattered-in-z profile is ill-defined — degrades gracefully, returns null on
  self-intersection).
- Curve-primitive params regenerate points, so hand-editing a primitive's
  points is clobbered on the next param change (no make-editable yet).
- Sweep centers the profile on the path via its plane centroid (fine for the
  origin-centered primitives; a profile offset from its own origin is centered
  rather than riding by that offset).

## Next

M1 sign-off still pending (milestone hard stop). M2 = materials.
