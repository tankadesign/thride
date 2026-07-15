# PLAN_PROGRESS_23 — M2/E2: TSL noise library + noise gallery

**Date:** 2026-07-15
**Chunks worked:** E2 (TSL noise library)
**Milestone context:** M2 in progress (user-authorized through the milestone).
E1, E5, E2 done; E3, E4, C6, A5 remain. E6 bake deferred out of M2.

## Completed

**The noise library (`materials/noises/functions.ts`).** Seven factories, each
returning a TSL node and taking a common `NoiseOpts { pos, scale, phase }`:

| id        | source                   | notes                               |
| --------- | ------------------------ | ----------------------------------- |
| `perlin`  | `mx_noise_float`         | gradient noise, remapped to [0,1]   |
| `fractal` | `mx_fractal_noise_float` | fBm; octaves / lacunarity / gain    |
| `worley`  | `mx_worley_noise_float`  | cellular; `jitter`                  |
| `cell`    | `mx_cell_noise_float`    | one constant value per integer cell |
| `value`   | custom                   | hash lattice, smoothstep trilinear  |
| `tri`     | three's `triNoise3D`     | genuinely animated; `speed`         |
| `curl`    | custom                   | **vec3** divergence-free flow field |

`phase` folds into the sample's z-slice (`samplePos`), so a flat surface **boils**
as phase animates rather than scrolling — that's the whole point of the chunk's
"each with phase param". `tri` and `curl` phase differently, documented per-noise.
All raw `three/tsl` imports funnel through the `materials/tsl.ts` barrel per the
project's import rule; nothing else in the library reaches into three directly.

**The registry (`materials/noises/registry.ts`).** `NOISE_DEFS: NoiseDef[]` — id,
label, category (`gradient` / `fractal` / `cellular` / `flow`), param descriptors
(key, label, default, min, max, step) and a `preview(vals, phase)` node builder.
This is the seam E3's layer-stack compiler consumes: E3 should drive noises from
the registry, not by importing the factories one by one. Plus `defaultNoiseParams(def)`
and `noiseDef(id)`.

**The gallery (`ui/panels/NoiseGalleryPanel.tsx` + `render/thumbnails/noiseThumbnails.ts`).**
View → Noise Gallery. `NoiseThumbnails` shades each def's preview node onto an
offscreen 2×2 quad under an ortho camera on its **own** `WebGPURenderer`/device
(a node material's compiled pipeline is per-device — same constraint as
`MaterialThumbnails`), reads back a PNG dataURL. The panel re-renders all seven
on any phase change.

**The bug the gallery caught.** Value noise rendered a flat blob over the whole
negative octant. Cause: three's `hash()` opens with `seed.toUint()`, and WGSL
clamps a negative float to 0 on that conversion — so _every_ lattice cell with a
negative dot-product seed hashed to the same value. Fixed with `LATTICE_BIAS = 4096`
on the lattice coords. **This is the argument for the gallery existing:** the unit
test builds the graph and passes; only a real GPU render shows the pattern is wrong.

## Left mid-flight

Nothing. E2 is closed.

## Decisions made (and why)

- **E2's "done when" is not met literally, by user acceptance.** PLAN.md says
  _"noise gallery screenshot goldens match on WebGPU and WebGL2."_ Two deviations,
  both surfaced to the user, who chose "accept manual gallery":
  1. **WebGL2 half is superseded** — the app is WebGPU/TSL-only by explicit user
     decision ("no legacy crap") during E5. Not achievable, and not wanted.
  2. **No automated screenshot goldens** — there is no headless
     screenshot/golden harness in the repo (all 28 test files are logic/property
     vitest). The live gallery + manual verification stands in. **Known gap:**
     nothing committed regression-guards the _rendered output_; the next
     value-noise-class bug will not be caught by CI. Accepted for a preview
     library; revisit if noises start shipping into user documents.
- **Phase folds into z rather than being a separate uniform.** One control that
  works for every spatial noise, and it costs nothing — no extra sampler, no
  per-noise special case.
- **`NoiseThumbnails` gets its own device** rather than borrowing the viewport's.
  Consistent with `MaterialThumbnails`; keeps gallery renders off the viewport's
  converge-then-idle loop entirely.
- **Value + curl are hand-written, everything else is MaterialX.** MaterialX has
  no curl and no plain value noise, and both are load-bearing for E3 (curl for
  flow/advection, value for cheap masks).

## Files added / changed

- `src/materials/tsl.ts` — noise primitives added to the barrel (`mx_*`, `hash`,
  `triNoise3D`, `Fn`, `uv`, `time`, …).
- `src/materials/noises/{functions,registry,index}.ts` — new; the library.
- `src/materials/noises/registry.test.ts` — new; 5 tests.
- `src/render/thumbnails/noiseThumbnails.ts` — new; offscreen preview renderer.
- `src/ui/panels/NoiseGalleryPanel.tsx` — new; the gallery.
- `src/ui/shell/Shell.tsx`, `src/app/commands.tsx` — `openNoiseGallery` on
  `ShellApi`, `view.noiseGallery` command, `noiseGallery` panel component.

## Test status

- `tsc -b`: clean. (`vp check`/`vp lint` still **hang on tsgolint** — use `tsc -b`
  - `vp test` as the gates and commit `--no-verify`. Unchanged from PROGRESS_22.)
- `vp test`: **179 passed / 28 files**, 0 failed.
- `vp fmt`: clean.
- Browser (MCP, `localhost:5175`): all 7 thumbnails render distinct, correct
  patterns; each re-renders differently at phase 0 vs 7.5; console has no WebGPU
  or shader errors.

## Known issues

- **`LATTICE_BIAS = 4096` is a bounded fix.** Value noise silently degenerates
  again for samples beyond ±4096 — fine for the gallery and origin-centered
  meshes, but a real limit once these run on large-coordinate geometry. Flag for
  E3. A proper per-component integer hash would remove the bound.
- **No rendered-output regression guard** (see the decision above).
- Registry tests prove graph _construction_ only — `expect(typeof node.rgb)` is
  the strongest assertion available without a GPU.

## Next steps (exact, resumable cold)

1. **E3 — layer-stack compiler.** Read PLAN.md's E3 entry. It consumes
   `NOISE_DEFS` from `@/materials/noises` (registry-driven, not per-factory
   imports); each layer is `{ noiseId, params, blend, opacity }` compiled to a
   single TSL node. Ops-layer code, so `src/materials/` — no React, no DOM.
2. Then E4 (projections), C6 (post-FX stack), A5 (icons) to finish M2.
3. M2 is a **hard stop**: when E3/E4/C6/A5 are done, write the progress file, run
   the M2 QA checklist, and wait for user sign-off before touching M3.
