# PLAN_PROGRESS_18 — Shadows, gradient banding, Ambient Shadows (Spline parity)

Post-M1 render-quality session chasing Spline-quality shadows. The user's
"we still have banding" turned out to be two unrelated problems plus a
genuine missing feature. Gates at each commit: `tsc -b` clean, `vp test`
147/147, verified live in the WebGPU viewport.

## What landed (newest first)

- **Ambient Shadows (GTAO)** (`b02b2eb`) — Spline's project-level AO pass.
  three's `GTAONode` folded into the HDR composite: reads the HDR target's
  depth (added a sampleable `DepthTexture`; normals auto-derived, no MRT),
  darkens creases multiplicatively toward a tint in LINEAR space before tone
  mapping. Single-pane + PBR only (GTAO is per-camera; a shared pass would
  corrupt quad panes). Params in `PaneDisplay` (Radius/Bias/Tint/Samples,
  reusing the `ssao` flag) + Display > Ambient Shadows submenu
  (Enabled / Radius / Quality / Strength).
- **Per-light shadow controls + runtime shadow fix** (`e55f879`) — Quality
  (1k/2k/4k), Blur (PCF radius), Size (frustum extent) per light, stored in
  LightDataDTO. AND fixed a real bug: three's WebGPU bakes shadow-receiving
  code into materials at compile time; adding the first shadow-caster at
  runtime didn't recompile them, so cast shadows silently didn't appear
  until reload. `SceneSynchronizer.refreshShadowMaterials` recompiles the
  lit material when the shadow-caster count changes (no hitch on scrubs).
- **Gradient banding fix** (`35c2b68`) — the "shadow banding" was 8-bit
  OUTPUT QUANTIZATION, not shadows (identical with shadows off; contour
  rings on a smooth-lit sphere; immune to every shadow knob). Fixed by
  rendering the scene into a half-float HDR target, then a composite pass
  (`render/viewport/ditherOutput.ts`) applies tone mapping + a ±1-LSB
  interleaved-gradient-noise dither in display space before the 8-bit write.
  Two-pass render: pass 1 linear into HDR (device-pixel viewport), pass 2
  composites once with the active pane's tone mapping. Fixes ALL gradients.

## Load-bearing WebGPU gotchas (non-obvious, cost real time)

1. **8-bit quantization ≠ shadow acne.** Clean contour rings on a smooth
   gradient that don't move when shadows toggle = output quantization. Fix
   is HDR + dither, not shadow bias/PCF. Two rounds of shadow tuning did
   nothing because of this.
2. **WebGPU shadow receiving is compiled per material.** Adding a caster (or
   toggling a light's Shadows) after materials compiled needs a material
   recompile or shadows won't render until reload.
3. **RenderTarget viewport is device pixels** (no implicit pixelRatio like
   the canvas) — scale pane rects by `getPixelRatio()` when rendering to the
   HDR target.
4. **`renderer.clear()` on a fresh WebGPU RenderTarget throws** "Texture
   already initialized" — rely on per-scissor autoClear instead.

## Known limitations

- AO runs single-pane only (off in quad — GTAO is per-camera).
- One benign one-time "texture already initialized" on first AO enable; it
  self-recovers and doesn't recur.
- AO param UI is preset submenus (Radius/Quality/Strength), not free sliders
  (context-menu constraint) — a real settings panel would allow finer tuning.
- Scripted camera framing in the harness was unreliable this session; live
  verification leaned on fixed positions + zoom crops.

## Next

M1 sign-off still pending (milestone hard stop). M2 = materials.
