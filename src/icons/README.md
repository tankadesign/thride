# icons

The app's icon set, built on **hugeicons** (`@hugeicons/core-free-icons` +
`@hugeicons/react`). `index.tsx` is the whole thing: one `makeIcon()` factory wrapping each
glyph as an `Icon<Concept>` component, grouped by domain (edit modes, primitives / node
kinds, lights, mesh tools, UI).

**Add icons here only — never import `@hugeicons/*` from anywhere else.** A direct import
bypasses the two things this barrel exists to guarantee:

- **Global size** — every icon reads `iconSizeAtom` (default 20px), so the app-wide icon
  size setting works. A bypassed icon keeps its hardcoded size while everything else scales.
- **Consistent stroke** — `strokeWidth={1.6}`, set in one place.

Pass `size` explicitly only for chrome that must stay fixed regardless of the global setting
(e.g. a 14px modal close button); content icons should inherit.

Every export is wired to real UI. If an icon loses its last consumer, delete it rather than
leaving it here — dead exports read as coverage that doesn't exist.

## Picking a name

Use the `hugeicons` skill: grep `references/icon-list.md` for the exact export name and copy
it. Never guess — a wrong name may not exist, or may exist as a different glyph than you
expect.

## History

This directory once held original hand-drawn SVGs. **M0X replaced them with hugeicons at a
global 20px** (the SVGs were deleted in `62784f0`). This README and PLAN.md's A5 line both
went on describing the old world until A5 corrected them — if you're reading a doc that says
"original SVG icons", it predates that decision.
