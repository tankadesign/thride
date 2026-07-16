# M2 — Materials & look: manual QA checklist

PLAN.md's testing plan (§6) lists only generic per-milestone examples (nav feel, gizmo
precision) — nothing M2-specific. This is M2's own checklist: the flows a user actually
performs against E1–E5, C6 and A5.

**Why manual:** the repo has no golden-image harness (E2's stated "done when" assumed one).
Every item below is a rendered-output check that automated tests cannot make — the recurring
lesson of this milestone is that a node graph can build, typecheck, and screenshot fine while
being wrong (see the vec2 ramp bug and the `chromaticAberration` null-center throw, both
caught only by a live console).

Run in a **fresh tab** — this preview pane's console buffer persists across reloads, so a
reused tab reports stale errors.

---

## E1 — Material manager

- [ ] New → material appears with a lit sphere thumbnail.
- [ ] Drag swatch onto a mesh in the viewport → assigns; the mesh updates immediately.
- [ ] Edit color / roughness / metalness → viewport + thumbnail both update.
- [ ] Switch material type (Physical → Standard → Toon …) → rebuilds, no crash.
- [ ] Delete a material → assigned meshes fall back to the default; **undo restores it**.
- [ ] Slider scrub = ONE undo step (drag, release, undo once → back to the start value).

## E2 — Noise library

- [ ] View → Noise Gallery: all 7 render distinct, correct patterns.
- [ ] Perlin/Fractal/Worley/Cell/Value/Turbulence/Curl each look like their name.
- [ ] Scrub Phase → patterns evolve.
- [ ] **"Turbulence"**, not "Tri (animated)"; it has no dangling Speed slider.

## E3 — Layer stacks / noise maps

- [ ] Every map slot (Color/Roughness/Metalness/Normal/Emissive) shows **[Image] [Noise]**
      when empty.
- [ ] Noise → renders on the mesh + a live chip appears; editor opens in one click.
- [ ] Type, Seed, per-noise params, Contrast, Bias, Clip Low/High all affect the render.
- [ ] **Param scrubs never hitch** (they poke uniforms; only Type/Projection rebuild).
- [ ] Ramp (Color/Emissive): add a stop by clicking the bar, drag a stop, recolor, delete.
      **Drag + click-to-add are the two gestures automation could not synthesize — feel these.**
- [ ] Normal channel: noise → visible bump lighting; Strength scrubs live.
- [ ] ✕ removes the noise; **undo restores it with its exact ramp**.
- [ ] Image and noise are mutually exclusive per channel (adding one clears the other).

## E4 — Projections

- [ ] Noise layer: UV / Flat / Triplanar / Cylindrical / Spherical each change the mapping.
- [ ] **Flat streaks** on faces parallel to its axis; **Triplanar doesn't** (the pair that
      proves both are real). Cube is the honest test object.
- [ ] Image channel: the filename row expands a Projection select; switching remaps the image.
- [ ] Normal Map image has **no** Projection row (tangent-space maps need a UV frame).
- [ ] **Camera is absent** from every projection list (returns with scene cameras, F4).

## E5 — Environment & reflections

- [ ] Environment panel: load an HDR/EXR → lights the scene; background modes switch.
- [ ] Studio source + Environment background → the default HDR renders behind.
- [ ] Reflections ON, Fast → mirror reflections; roughness blurs them.
- [ ] Reflections High → converges to clean over ~0.4s, then idles (no permanent GPU burn).
- [ ] **No black smears/artifacts** with an HDR environment (the NaN-guard regression).
- [ ] Planar reflector on a floor → reflects the back of a sphere (what SSR structurally can't).
- [ ] Gizmo / selection handles / light helpers do **not** appear in reflections.

## C6 — Post-processing

- [ ] View Settings has **View** and **Post** tabs.
- [ ] Post tab holds: Ambient Shadows, Reflections, Bloom, Chromatic Aberration, Vignette.
- [ ] **Tone Map stays on the View tab** (output transform, not a stacked effect).
- [ ] Bloom on an emissive object → HDR glow; Threshold/Strength/Radius all respond.
- [ ] Chromatic Aberration → colour fringing, zero at centre, strongest at the edge.
- [ ] Vignette → corner darkening; Amount/Radius respond.
- [ ] **All three work with Reflections=High** (the temporal path shares the output tail —
      this is exactly what `composeOutput` was extracted to guarantee).
- [ ] Tone Map AgX / ACES / Neutral visibly differ.
- [ ] Effects persist across reload.

## A5 — Icons

- [ ] ToolRail, Object Manager, menus, Materials panel all render icons (no glyphs/boxes).
- [ ] Object Manager: a scene with mixed light types shows **six different glyphs**.
- [ ] Changing the global icon size rescales unsized icons; explicitly-sized chrome holds.
- [ ] Project tab ✕, map-slot ✕, ramp-stop ✕, section carets are all real icons.

## Cross-cutting

- [ ] **Fresh-tab console clean** on boot and through the flows above.
- [ ] Save → reload → everything round-trips (materials, noises, projections, post-FX, env).
- [ ] Undo/redo across material + noise + post-FX edits leaves no orphaned state.

---

## Known gaps (accepted, not bugs to find)

- No golden-image harness → nothing regression-guards rendered output (E2/E3/E4).
- Bump is derivative-based: mild grit at grazing angles (inherent).
- Value/all noises degrade past ~100k world coordinates (f32 coordinate precision).
- Post-FX + AO + SSR are **active-pane only** in quad layout (one composite, one tone map).
- `🎥` in the camera dropdown is a `<select>` option label — no component can render there.
