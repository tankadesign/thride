# PLAN_PROGRESS_25 — Noise maps: procedural noises in every image-map slot

**Date:** 2026-07-15
**Chunks worked:** none by ID — user-directed feature ("we have no UI to create and
apply noises to materials so that's the new priority"), which is also the
"layer-stack editor UI" follow-up PROGRESS_24 flagged as the highest-value gap.
**Milestone context:** M2 in progress; A5 remains. This closes the usability hole
that made E2/E3/E4 unreachable for a user.

## Completed

**The map slot (`ui/panels/materialEditor/MapSlot.tsx`).** Every image-map row
(Color/Roughness/Metalness/Normal/Emissive) is now a dual slot, per the user's
chosen design (split buttons + chip):

- Empty: two buttons — **Image** (file dialog, as before) and **Noise**.
- Filled with a noise: live 64px thumbnail chip (rendered through the E3 compiler
  on a shared offscreen device, debounced) + type name + ✕ remove. Clicking the
  chip toggles the inline editor.
- Image and noise are **mutually exclusive per channel by construction** — the
  correspondence lives in `TEXTURE_TO_PROCEDURAL` (`types/core/material.ts`), and
  assigning either clears the other.

**The inline editor (`NoiseEditor.tsx`).** Type, Seed, the noise's own params
(Scale/Octaves/Jitter/…), then shaping — Contrast, Bias, Clip Low/High — plus
Strength on the Normal channel and Projection at the bottom. The user's requested
control list, plus the full multi-stop gradient ramp they chose for Color/Emissive
(`RampEditor.tsx`: draggable stops on a gradient bar, click-to-add with
neighbor-interpolated color, per-stop color/position/delete; delete disabled ≤2).

**Under the hood — everything rides E3, no new machinery:**

- A channel's noise is a **single-layer stack** in `MaterialDTO.procedural`
  (`channelLayer`/`withChannelLayer` read/write layer 0). Compiler, warm-swap,
  thumbnails, serialization and undo all came for free.
- New `ProceduralLayer` shaping fields (`seed/clipLow/clipHigh/contrast/bias/
bumpStrength`) are all optional + uniform-backed: **none are in `structureKey`,
  so shaping edits never recompile.** Seed shifts the sample coordinate through
  the field (per-axis irrational-ish steps, well inside f32 precision).
- Shaping order: clip window → contrast around mid → bias → clamp, componentwise.
- **`normal` joined `ProceduralChannel`**: the stack is a height field, converted
  in the compiler by `bump.ts` — three's `perturbNormalArb` math restated over an
  arbitrary height node (three's own `bumpMap` needs a texture to re-sample; our
  noises sample positions). `faceDirection`-aware for DoubleSide. Strength is a
  live uniform.

## Verified end-to-end in the browser (real UI, not console pokes)

- Noise button → fractal renders on the cube + sphere thumbnail + chip, editor
  opens (one click).
- Ramp authored through the UI: rust `#431c0a` → gold `#e8a33d`.
- Normal-channel noise: visible bump lighting on the cube.
- Type swap (select → Worley): structural warm-swap path, per-type param rows
  switch (Octaves/Gain → Jitter), seed/contrast preserved.
- **No-recompile proven against the app**: 10 shaping edits — the viewport's
  `CompiledStacks` and material are the SAME objects after, seed uniform reads
  the last value. (The global compile counter does tick during edits — that's
  the chip + sphere _previews_ compiling on their own devices, by design.)
- Remove ✕ → channel cleared, buttons return; **undo restores the noise with
  the exact ramp** (UpdateMaterialCommand covers `procedural`).
- Reload: worley + ramp + bump all persist and render; fresh-tab console clean.

## Decisions made (and why)

- **UX chosen by the user from presented options:** split buttons + chip (one
  click per assignment, beats a popover with only two source types); essentials
  - full gradient ramp; Normal channel via derivative bump (accepting the mild
    grazing-angle grit inherent to screen-space bump).
- **The Noise Gallery stays a preview** (user: "nice to see what we have") — it's
  also still E2's visual golden.
- **Editor defaults:** new noise = fractal, triplanar, white tint (a gray tint
  would silently halve scalar channels), black→white ramp on color/emissive.
- **Ramp stop selection got an `onClick` in addition to `onPointerDown`** —
  keyboard activation fires click, not pointerdown, so stops were unselectable
  without a mouse. (Found because the browser-automation tool has the same
  limitation as a keyboard; the fix is a genuine a11y fix, not test appeasement.)

## Files added / changed

- `src/types/core/procedural.ts` — shaping fields + `SHAPING_DEFAULTS`, `normal`
  channel, `channelLayer`/`withChannelLayer`.
- `src/types/core/material.ts` — `TEXTURE_TO_PROCEDURAL`.
- `src/materials/procedural/compile.ts` — seed offset, `shape()`, normal→bump;
  `bump.ts` — new. Tests extended (shaping no-recompile, normal channel,
  pre-shaping docs still compile).
- `src/render/scene-sync/proceduralBind.ts` — `normal` → `normalNode`.
- `src/render/thumbnails/noiseThumbnails.ts` — `renderLayer()` for chips.
- `src/ui/panels/materialEditor/{MapSlot,NoiseEditor,RampEditor,controls}.tsx`,
  `noisePreview.ts` — new. `MaterialEditor.tsx` slimmed to 182 lines (was near
  the 500 cap before the split).

## Test status

- `tsc -b`: clean (`vp check` still hangs on tsgolint — unchanged).
- `vp test`: **200 passed / 32 files**, 0 failed.
- Browser: full flow above; fresh-tab console clean.

## Known issues

- Bump quality is derivative-based: slightly gritty at grazing angles (inherent;
  accepted at design time — E6 bake would be the higher-quality path).
- Bump strength rides the FIRST enabled layer of a normal stack (the UI authors
  exactly one; multi-layer docs via API share one strength).
- One demo material ("Material", worley rust/gold + fractal bump, assigned to the
  cube) was left in the working project as a feature showcase — delete if unwanted.
- Ramp add-stop (click on bar) and stop dragging are pointer-event driven and
  verified by code-path equivalence + JS dispatch, not by real drag automation
  (the browser tool doesn't synthesize pointer events).

## Next steps (exact, resumable cold)

1. **A5 (icons)** — the last M2 chunk; then the M2 hard stop (progress file, QA
   checklist, user sign-off).
2. Later polish candidates: transform controls (offset/rotation per layer) in the
   editor — the uniforms already exist; phase/animation hookup lands with chunk G.
