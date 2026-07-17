import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// The `no-unsafe-*` / no-explicit-any family. It fights TSL node graphs (every
// `.mul().add()` chain reads as an unsafe op on an `any`) unless the nodes are
// typed with the barrel's `Vec3/Vec2/Vec4/Float` aliases. `src/materials/**` is
// typed that way and enforces the family (see the override below); elsewhere the
// codebase still has scattered `any` escape hatches (renderer internals, the BVH
// monkey-patch, third-party SSR effect nodes in render/viewport/ditherOutput),
// so it's off globally for now. `tsc -b` is the real type gate everywhere.
const UNSAFE_ANY_FAMILY = {
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-call": "off",
  "@typescript-eslint/no-unsafe-argument": "off",
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-return": "off",
  "@typescript-eslint/no-redundant-type-constituents": "off",
};

export default tseslint.config(
  { ignores: ["dist", "node_modules", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      ...UNSAFE_ANY_FAMILY,

      // Allow intentionally-unused `_`-prefixed args/vars.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],

      // Pre-existing debt, surfaced the first time this repo ran a working
      // type-aware linter (oxlint's tsgolint hung, so these rules never ran).
      // Downgraded to warnings — visible, not silenced — pending a dedicated
      // cleanup; NOT from the TSL typing work. (The react-hooks findings were
      // fixed or annotated with per-line reasons, so react-hooks/refs and
      // set-state-in-effect stay at their recommended `error` severity.)
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "prefer-const": "warn",
      "no-useless-assignment": "warn",
    },
  },

  // The TSL library IS fully typed via the `@/materials/tsl` barrel aliases, so
  // the unsafe-any family is enforced here — it's what stops a new `type Node =
  // any` from creeping back into the noise/procedural graph code.
  {
    files: ["src/materials/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error",
    },
  },
);
