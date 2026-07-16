import { describe, expect, it } from "vitest";

/**
 * A5's invariants, as a test rather than a promise.
 *
 * Both rules are stated in `src/icons/README.md` and the barrel's own docstring,
 * and both were broken in the codebase before A5 — by drift, not by intent.
 * Neither a typecheck nor a screenshot catches them: a bypassed icon renders
 * *fine*, it just silently stops honoring the global icon size. So they're
 * pinned here. Each assertion was verified to fail when its violation is
 * reintroduced.
 *
 * Sources are read via Vite's `import.meta.glob` (this is a browser project —
 * `node:fs` would need @types/node just for one test).
 */

const modules = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const BARREL = "/src/icons/index.tsx";
const files = Object.entries(modules).map(([path, text]) => ({ path, text }));

describe("icon barrel", () => {
  it("is the only place that imports @hugeicons", () => {
    // a direct import elsewhere bypasses iconSizeAtom + the shared stroke
    // weight, so that icon silently stops scaling with the global size setting
    const offenders = files
      .filter((f) => f.path !== BARREL)
      .filter((f) => /from\s+["']@hugeicons/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("leaves no unicode glyphs standing in for icons", () => {
    // ✕ / ▶ / ▾ rendered as text ignore the icon size, don't inherit the stroke
    // weight, and render differently per platform font
    const glyph = /[✕▶▾]/;
    const offenders = files
      .filter((f) => f.path.startsWith("/src/ui/") || f.path.startsWith("/src/editors/"))
      .flatMap((f) => {
        const hits: string[] = [];
        f.text.split("\n").forEach((line, i) => {
          // skip comments/JSDoc — prose may legitimately name the glyph
          if (/^\s*(\*|\/\/)/.test(line)) return;
          if (glyph.test(line)) hits.push(`${f.path}:${i + 1}`);
        });
        return hits;
      });
    expect(offenders).toEqual([]);
  });

  it("exports no icons that nothing renders", () => {
    const barrel = files.find((f) => f.path === BARREL);
    expect(barrel).toBeDefined();
    const exported = [...barrel!.text.matchAll(/^export const (Icon\w+)/gm)].map((m) => m[1]!);
    expect(exported.length).toBeGreaterThan(40); // sanity: the set is really loaded

    const consumers = files.filter((f) => f.path !== BARREL);
    const unused = exported.filter(
      (name) => !consumers.some((f) => new RegExp(`\\b${name}\\b`).test(f.text)),
    );
    expect(unused).toEqual([]);
  });
});
