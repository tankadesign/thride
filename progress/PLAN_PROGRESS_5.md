# PLAN_PROGRESS_5 — Post-M0 polish: daisyUI, jotai, MMB pane toggle

**Date:** 2026-07-09
**Chunks worked:** A2/A3/A4 rework (user-directed), B4 rework, C3 addition
**Milestone context:** M0 signed-off work being polished per user review; M1 not started.

## Completed

- **MMB pane maximize** — middle-mouse _click_ (≤4px movement, no Alt) on a viewport pane maximizes it; MMB again returns to 4-up (C4D behavior). `maximizedPane` concept added: single layout renders the maximized pane's camera; MMB+Alt pan unchanged. Logical-pane mapping threaded through rects/picking/nav in `ViewportSystem`.
- **daisyUI 5.6 + Tailwind 4 UI rebuild** (sunset theme, smallest sizes everywhere):
  - Wiring: `@tailwindcss/vite` plugin, `@import "tailwindcss"; @plugin "daisyui" { themes: sunset --default; }`, `data-theme="sunset"` on `<html>`. Custom CSS reduced to dockview theme glue (`--dv-*` vars mapped to daisy `--color-*`) + scrub cursor.
  - MenuBar → **megamenu** (popover API) with `menu-xs` popovers, `kbd` shortcut hints, responsive collapse to a Menu button under `sm`.
  - ToolRail → `menu-xs` with tooltips + original SVG icons; palette → daisy `modal` + `input` + `menu-xs`; object manager rows, attributes (`fieldset`/`fieldset-legend`, `toggle-xs`, grid rows), viewport selects (`select-xs` w/ backdrop blur), stats `badge`, gallery showcasing daisy components at editor sizes.
  - Old custom design system deleted (`widgets.css`, Button/Select/Checkbox wrappers); `NumberDrag` kept (scrub logic) restyled as `input-xs`.
  - `src/icons/index.tsx`: original 16px stroke icon set (~24 icons: modes, primitives, kinds, eye, search…).
- **jotai state management** — centralized under `src/ui/hooks/` (nested, multi-hook domain files):
  - `doc/document.ts` (docAtom, `setAppDocument`, slice-version atoms bridging the event bus, `useDocument`, `useSliceVersion`), `doc/selection.ts`, `doc/history.ts`.
  - `editor/viewport.ts` (layout/activePane/maximizedPane/paneCameras atoms, `useViewportState`, and the `EditorStateStore` facade), `editor/shell.ts` (palette atom).
  - New `src/types/editor.ts`: `EditorViewportState` contract — **fixes a layering violation**: render/ no longer imports ui/ (CameraRig + ViewportSystem now depend on types only).
  - Deleted: `ui/state/EditorState.ts`, `DocumentContext.tsx`, `useDocSlice.ts(x)`. DocumentProvider gone — doc installed into jotai's default store at startup.

## Verified in-browser (user's 5656 server, WebGPU)

- Sunset-themed shell renders; megamenu Create → Sphere adds+selects; ⌘Z/⇧⌘Z undo/redo through jotai-driven menus; ⌘4 layout toggle.
- MMB: single→quad; MMB on the Top pane → maximized **Top** view; MMB → back to quad; MMB on persp pane → single persp. Verified via pane camera selects.
- `vp check` clean, 68/68 tests (slice re-render test migrated to jotai), production build OK.

## Decisions made (and why)

- daisyUI conventions recorded in AGENTS.md + PLAN.md tech stack (component-first, xs sizes, sunset, no custom CSS beyond dockview glue).
- jotai uses the **default store** (no `<Provider>`) so the non-React render layer and command layer share state through plain `store.get/set` behind the `EditorViewportState` facade.
- Hook file convention: nested domain dirs, combined hooks per file, filenames not starting with `use` (`history.ts`, `viewport.ts`).
- Preview-harness note: browser window may report 0×0/tiny transiently; `preview_resize` after the page loads, or trust functional evals over screenshots.

## Known issues

- daisyUI `menu-disabled` items still receive pointer events in menus (cosmetic; commands guard via `enabled()` anyway).
- Megamenu popovers close on item click via `hidePopover()`; hover-move between top-level menus doesn't auto-switch like native menubars (acceptable; revisit in A5/M5 polish).
- Preview-managed dev server on :5175 fails to boot via launch.json (user's :5656 server used for verification instead).

## Next steps

1. **M1 session 1: D4 component mode tools** per PLAN_PROGRESS_4 next-steps.
2. During M1 UI work, keep daisyUI conventions (AGENTS.md “UI & state conventions”).
