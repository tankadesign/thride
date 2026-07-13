# PLAN_PROGRESS_21 — M2/E1: material fixes, IBL reflections, full params, texture channels

**Date:** 2026-07-13
**Chunks worked:** E1 follow-ups (bugs + params + textures) and E2 groundwork (IBL environment)
**Milestone context:** M2 in progress (user-authorized through the milestone). E1 + IBL done; SSGI deferred; E2–E6 + C6 + A5 remain.

## Completed

Driven by a 5-issue user list on the material system:

- **#1 + #5 — opacity / Transparent had no effect.** `materials/build.ts` `applyMaterialParams`: `transparent`/`depthWrite` are pipeline blend-state (not uniforms), so an in-place change needs `needsUpdate`. Derive `wantTransparent = dto.transparent || dto.opacity < 1`, set `depthWrite = !wantTransparent`, flag `needsUpdate` only on real change. (`977c3b3`)
- **#3 — full material params + collapsible editor.** `types/core/material.ts`: MaterialDTO gains the MeshPhysical superset (clearcoat, transmission/ior/thickness, sheen, iridescence, specular) + `PHYSICAL_DEFAULTS` + `HAS_PHYSICAL`. `build.ts` applies them guarded by `in mat` (absent → three default). New `ui/panels/MaterialEditor.tsx`: collapsible sections (Base/Surface/Clearcoat/Transmission/Sheen/Iridescence/Emission) gated by type; scrub = one undo step. (`685869e`)
- **#2 — reflections via a studio IBL environment.** `render/environment/studioEnvironment.ts`: neutral studio painted on a 2:1 equirect canvas (gradient + softbox blobs), assigned to `scene.environment` on both the viewport and the thumbnail scene (`environmentIntensity` ~0.5–0.55). Metals went from black to reflective. (`6dfab96`)
- **#4 — image-map texture channels (color/roughness/metalness/normal/emissive), end-to-end:**
  - Data/persist (`7212e3a`): MaterialDTO `textures?: Partial<Record<TextureChannel, Uuid>>`; `TextureAssetDTO` (raw encoded bytes); `TEXTURE_CHANNELS` (label + `applies` set + colorSpace). Runtime `io/storage/textureAssets.ts` registry (mirrors `meshRegistry`); project record persists referenced assets alongside kernel meshes (structured clone, no base64). Tests in `textureAssets.test.ts`.
  - Render + editor (`94f70ec`): `render/scene-sync/textureCache.ts` decodes bytes → GPU texture (async `createImageBitmap`, cached per asset+colorSpace), MaterialSync binds channels with `needsUpdate` + re-bind/re-render on late decode; MaterialEditor "Textures" section with per-channel load/replace/clear slots.
  - Thumbnails (`45038ba`): preview sphere decodes + binds its own device textures (shared `decodeChannelTexture` keeps color-space/wrap/flip consistent).
  - Verified live: checker → Color renders UV-mapped on the object AND the card, and survives a full dev-server restart + reload (persisted → hydrated → re-decoded).

## Left mid-flight

- Nothing broken. All work committed; `tsc -b` + `vp test` green (173 tests).

## Decisions made (and why)

- **SSGI deferred (user-approved).** Spiked three's `SSGINode` in the DitherOutput pipeline: GI/color-bleed is correct, but it relies on multi-frame temporal accumulation + denoise. The viewport renders on-demand (one frame then idle) → permanent static noise; forcing ~90 frames timed out (>300ms/frame). It needs a **progressive-refinement render mode** (accumulate while idle + denoise + reset-on-camera-move), not a plain toggle. Spike reverted. `realism-effects`/`postprocessing` npm pkgs are WebGL-only (`EffectComposer`) — incompatible with WebGPURenderer; three's native `SSGINode`/`SSRNode` are the WebGPU path. See [[webgpu-render-gotchas]] #10.
- **IBL via `scene.environment` + node `PMREMNode`,** NOT `PMREMGenerator` (WebGL-only). Painted equirect canvas → no HDR asset. See gotcha #9.
- **`textureAssets` registry lives in `io`, not `materials`.** `materials` is a sibling tier of `io`; putting it there made io→materials a lateral import. The registry is pure-DTO, and its consumers (io persist, render decode, ui create) all import `io` downward.
- **Textures decode in the render layer, not `build.ts`.** Decode is async + GPU + per-device; `build.ts` stays sync scalar/color application. Thumbnail device gets its OWN texture objects (GPU resources are per-renderer).
- **Texture bytes persist in the project record** (like kernel meshes). A separate asset store is the future split if scenes grow large.

## Files added / changed

- types: `core/material.ts` (physical superset + texture channels + defaults), `core/index.ts`
- materials: `build.ts` (transparency fix + physical extras)
- render: `environment/studioEnvironment.ts` (new), `scene-sync/textureCache.ts` (new), `scene-sync/MaterialSync.ts` (texture binding + onDirty), `scene-sync/SceneSynchronizer.ts` (pass onDirty), `thumbnails/materialThumbnails.ts` (IBL + textures), `viewport/ViewportSystem.ts` (scene.environment)
- io: `storage/textureAssets.ts` (new) + `.test.ts` (new), `storage/projectStore.ts` (persist/hydrate/release textures)
- ui: `panels/MaterialEditor.tsx` (new — collapsible editor + Textures section), `panels/MaterialManagerPanel.tsx` (use MaterialEditor)

## Test status

- `vp check`: not run — `vp check`/`vp lint` hang on tsgolint. Manual gates used: `tsc -b` clean, `vp fmt` applied.
- `vp test`: 173 passed / 0 failed (27 files).

## Known issues

- Clearing a texture channel leaves the asset in the registry until save (unreferenced assets are dropped by `projectRecordOf`) — harmless, not GC'd live.
- SSGI/SSR not shipped (see decision above) — env-map covers baseline reflections.
- Thumbnail decodes textures per-instance; no cross-material sharing (fine at current scale).

## Next steps (exact, resumable cold)

1. Confirm with user whether to build the **progressive-refinement render mode** for SSGI/SSR now or continue E2+.
2. Continue M2: E2 (lighting/HDRI look), E3 (procedural material layer stack — builds on the texture channels landed here), per PLAN.md.
3. Optional polish: normal-map strength / UV tiling+offset controls; Object-Manager-row material drop target; unregister orphaned texture assets on clear.
