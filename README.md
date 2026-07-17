# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Linting & type-checking

This project lints with **ESLint** (flat config in `eslint.config.js`), not oxlint.
oxlint's type-aware pass (`oxlint-tsgolint`) hangs indefinitely on the TSL node-graph
files, so `vp lint` / `vp check`'s lint step are disabled.

```bash
pnpm lint         # ESLint (type-aware, via typescript-eslint)
pnpm lint:fix     # ESLint with --fix
pnpm check        # tsc --noEmit  (type gate; also `tsc -b`)
vp test           # tests
```

Notes:

- **TypeScript is pinned at `~6.0.2`.** `typescript-eslint` has no support for the
  TypeScript 7 native compiler yet (its parser fails to load against it), so bumping
  TS to 7 would stop ESLint from running.
- The strict `no-unsafe-*` / `no-explicit-any` family is enforced only in
  `src/materials/**`, where TSL nodes are properly typed via the `@/materials/tsl`
  barrel aliases (`Vec3` / `Vec2` / `Vec4` / `Float`). See `AGENTS.md` for the
  full convention.

See the [typescript-eslint docs](https://typescript-eslint.io) for rule details.
