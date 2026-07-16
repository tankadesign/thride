# PLAN_PROGRESS_26 — M2/A5 + M2 milestone closeout

**Date:** 2026-07-16
**Chunks worked:** A5 (Icon set) — the last M2 chunk.
**Milestone context:** **M2 COMPLETE, pending user sign-off.** All chunks done: E1, E2,
E3, E4, E5, C6, A5. Carve-outs (all user-agreed) recorded below. **M2 is a hard stop
(PLAN.md:95, AGENTS.md) — do not start M3 without sign-off.**

## A5 — one coherent icon system, and docs that describe it (`10fdd17`)

A5 said "original SVG icons"; M0X had already replaced the hand-drawn SVGs with hugeicons
at a global 20px (deleted in `62784f0`). Three docs still described the dead world — PLAN's
A5 line, AGENTS.md/CLAUDE.md, and `src/icons/README.md` (which flatly claimed "original
artwork — no GPL assets"). A5 = **consistency closure**, not redrawing.

Coverage was already met. The debt was everything bypassing the system:

- **2 barrel bypasses** — ViewportPanel + ViewSettingsModal imported `@hugeicons` directly
  and hardcoded `size={14}`, so those icons ignored the global size. → `IconSettings`,
  `IconClose` in the barrel.
- **7 glyph stand-ins** (✕ ×4, ▶ ×2, ▾) → real icons; the ▶ carets keep the `rotate-90`
  pattern.
- **Misleading icons** — boolean reused the cube; `IconDisc`/`IconCircle` were the _same_
  glyph (now filled `RecordIcon` disc vs outlined `CircleIcon` spline); the Object Manager
  flattened 6 light types to one bulb (now per-type via `LightDataDTO.type` — the payload is
  at `data.light`, NOT `data.type`; the wrong path fails silently as "every light a bulb").
- **7 orphan exports** — vestigial from the viewport context menu `488db99` replaced. Wired
  `IconDelete`/`IconGroup`; deleted the other 5.
- **Dead dep** — `@boxicons/react` removed (zero usages).

**`src/icons/barrel.test.ts`** pins all three invariants (only the barrel imports
`@hugeicons`; no glyph stand-ins; no orphan exports). Each assertion was **verified to fail**
when its violation is reintroduced — neither tsc nor a screenshot catches these (a bypassed
icon renders fine, it just stops scaling). Kept: the `🎥` in a `<select>` option label
(ViewportPanel:149) — no component can render there.

## M2 milestone summary

| Chunk                        | State                                                         |
| ---------------------------- | ------------------------------------------------------------- |
| E1 Material manager          | done (pre-session)                                            |
| E2 Noise library             | done — live gallery stands in for goldens (no harness)        |
| E3 Layer-stack compiler      | done — instrumented no-recompile test                         |
| E4 Projections               | done (math) — **gizmo → M5**, **camera → F4**                 |
| E5 Environment + reflections | done — HDR/EXR, SSR Fast/High, planar                         |
| C6 Post-FX stack             | done — bloom/CA/vignette + Post tab; **custom shaders → 1.x** |
| A5 Icon set                  | done (this session)                                           |
| E6 Bake                      | **excluded from M2 by PLAN**                                  |

**Beyond the chunk list** (user-directed, this milestone): noise maps in every map slot,
per-channel image projections, the shaping controls (seed/contrast/bias/clip), derivative-
bump normal channel, Turbulence rename.

### Carve-outs — all user-agreed, none silently dropped

- **C6 custom shader effects → 1.x** (user chose defer; PROGRESS_24).
- **E4 texture-mode projection gizmo → M5** — M5 already lists it beside the UV editor.
  I built E4's math and never recorded this deferral; PROGRESS_24 omitted it. **Corrected in
  this session**: PLAN's E4 + M5 lines updated, ToolRail's disabled button retargeted M2→M5.
- **`camera` projection → F4** — needs scene cameras; out of the UI, union member kept.
- **No golden-image harness** — E2's stated "done when" assumed one; the repo has none.
  Every rendered-output check is manual. This is the milestone's recurring lesson (the vec2
  ramp bug and the `chromaticAberration` null-center throw both passed tsc + screenshots and
  were caught only by a live console).

## QA — ran the M2 checklist (`progress/M2_QA_CHECKLIST.md`, new)

PLAN §6 had no M2-specific checklist; wrote one. Spot-checked the highest-risk items live:

- **Post-FX in the High-SSR path**: bloom + vignette + chromatic aberration + High SSR all
  compose at 62fps, **console clean** — the depth-copy fix holds under the full stack, and
  `composeOutput` genuinely covers both graph modes.
- **E4 flat vs triplanar** on a cube: flat streaks on axis-parallel faces, triplanar doesn't.
- **A5 per-light-type icons**: created all 6 light types via the real Create commands → the
  Object Manager shows **8 unique kind-icon signatures** across 15 rows (Cube + 6 light types
  - targets), not one repeated bulb.
- **A5 global size**: unsized icons rescaled 20→32→20; explicitly-sized chrome held.

The full checklist (E1 undo steps, E2 gallery, E3 ramp gestures, E5 HDR/reflections, tone-map
modes, save/reload round-trip) is **for the user to run at sign-off** — especially the ramp
drag/click-to-add gestures, which browser automation cannot synthesize.

## Known issues / QA findings

- **PRE-EXISTING (M0X lights, NOT M2): Area light throws on WebGPU.**
  `RectAreaLightNode.setupDirectRectArea` reads `null.LTC_FLOAT_1` — three's WebGPU
  RectAreaLight needs `RectAreaLightTexturesLib.init()` (the LTC textures) and nothing calls
  it. Surfaced by A5's mixed-light QA; the other five light types are fine. Flag for whoever
  next touches lights.
- **Self-inflicted, resolved:** an early QA script created lights with a malformed name
  (an object, not a string), which React can't render as a child → blank app. The document
  autosaves before React mounts, so a live tab kept re-writing the break over each repair;
  fixing it required navigating to a static asset (no running app) before the IndexedDB edit.
  Repaired to the user's original scene (Cube + "Material"); lesson: **never hand-build nodes
  in QA — use the real commands**, which validate.
- **PRE-EXISTING (E5): High-SSR temporal depth copy** — sample-count 4-vs-1 validation error
  (PROGRESS_24). Did NOT recur under the post-FX stack test above (clean console), so it's
  scene/state-dependent; still unfixed.
- Standing M2 gaps: no rendered-output regression guard; derivative-bump grit at grazing
  angles; noise degrades past ~100k coords; post-FX/AO/SSR active-pane-only in quad.

## Files added / changed

- `src/icons/index.tsx` — barrel (added Settings/Close/carets/Boolean, disc≠circle, dropped
  5 orphans, docstring); `src/icons/README.md` — rewritten; `src/icons/barrel.test.ts` — new.
- `src/ui/panels/{ViewportPanel,ViewSettingsModal,AttributesPanel,ObjectManagerPanel}.tsx`,
  `src/ui/panels/materialEditor/{MapSlot,RampEditor,controls}.tsx`,
  `src/ui/panels/viewSettings/controls.tsx`, `src/ui/shell/{ProjectTabs,ToolRail}.tsx`,
  `src/app/commands.tsx` — barrel imports, glyph→icon, per-light tree icons, wired commands.
- `AGENTS.md`, `PLAN.md` — icon reality + E4-gizmo→M5; `package.json` — boxicons removed.
- `progress/M2_QA_CHECKLIST.md` — new.

## Test status

- `tsc -b`: clean. `vp test`: **203 passed / 33 files** (+3 barrel). `vp fmt`: clean.
  (`vp check` still hangs on tsgolint — unchanged.)
- Browser: booted clean, scene restored, post-FX+SSR+lights spot-checks pass, fresh-tab
  console clean.

## Next steps (exact, resumable cold)

1. **STOP — M2 is a hard stop.** Present the milestone for sign-off; hand the user
   `M2_QA_CHECKLIST.md` to run (especially ramp gestures + save/reload round-trip).
2. On sign-off, M3 (Motion & scatter): F2 cloner, F4 cameras (unblocks `camera` projection +
   E4's gizmo enablement path), G1–G3 animation (unblocks noise `phase`/Turbulence speed).
3. Worth fixing before or early in M3: the Area-light LTC crash (any scene with an area light
   currently breaks).
