import { fileURLToPath } from "node:url";
import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  test: {
    // Scope collection to THIS tree's src. A git worktree checked out under
    // .claude/worktrees/ (experimental branches, e.g. the Option-B placement
    // spike) carries its own *.test.ts files; anchored at the repo root, the
    // `src/**` glob never descends into `.claude/`, so those don't get run
    // against this config (they fail collection with a different setup).
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
  },
  // Linting is handled by ESLint (`pnpm lint`), not oxlint — oxlint's tsgolint
  // type-aware pass hangs indefinitely on our TSL node-graph files. Skip the
  // lint step in `vp check` so the composite command doesn't freeze; it still
  // runs the format step. Type checking is covered by `tsc -b` / `pnpm check`.
  check: { lint: false },
  lint: {
    plugins: ["react", "typescript", "oxc"],
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
        },
      ],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    // Type-aware linting + type-check are OFF here: oxlint's tsgolint pass
    // hangs indefinitely on our TSL node-graph files. ESLint handles type-aware
    // linting (`pnpm lint`) and `tsc -b` / `pnpm check` handles type checking.
    options: {
      typeAware: false,
      typeCheck: false,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
  plugins: lazyPlugins(() => [tailwindcss(), react()]),
});
