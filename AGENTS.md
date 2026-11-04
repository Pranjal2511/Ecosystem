# NexaShare Agent Instructions

This is a monorepo of TypeScript packages under `packages/*`.

## Verification commands

Typecheck all packages:
```
cd packages/protocol   && npx tsc -p tsconfig.json --noEmit
cd packages/shared     && npx tsc -p tsconfig.json --noEmit
cd packages/validation && npx tsc -p tsconfig.json --noEmit
cd packages/transfer-core && npx tsc -p tsconfig.json --noEmit
```

Run all tests:
```
npm test
```

Lint all sources (from repo root):
```
npx eslint --config eslint.config.js packages/*/src
```

## Package structure

- `packages/protocol` — protocol types and constants
- `packages/shared` — shared utilities
- `packages/validation` — message validation schemas
- `packages/transfer-core` — transfer engine

## Notes

- `packages/*/tsconfig.json` extends `tsconfig.base.json` at the repo root.
- `@nexashare/*` packages are linked via npm workspaces (root `package.json`).
- Tests live in `tests/` and are run with vitest.
