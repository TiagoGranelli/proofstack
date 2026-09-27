# 0002: TypeScript 7 for type checking, with a TypeScript 6 alias for tools

Status: Accepted (2026-09-26, evidence rechecked 2026-09-27)

## Context

TypeScript 7 (the native Go port) checks the project much faster. Tools that load the `typescript` JS
API are not all ready for it: Hey API 0.99.0 crashes on TS 7 (hey-api/openapi-ts#4235, still open on
2026-09-27).

## Decision

- `"@typescript/native": "npm:typescript@7.0.2"` provides the `tsc` binary used by `pnpm typecheck`.
- `"typescript": "npm:@typescript/typescript6@6.0.2"` means every tool that imports `typescript`
  (Hey API, shadcn) gets TS 6. That package is a shim: its `lib/typescript.js` re-exports its dependency
  `@typescript/old` (`npm:typescript@^6`), which resolves to `typescript@6.0.3`. It also provides the
  `tsc6` binary.
- `.fallowrc.json` lists `@typescript/native` in `ignoreDependencies`, because only its binary is used.

## Evidence

`pnpm typecheck` passes on TS 7.0.2, and `pnpm codegen` works with the TS 6 alias. The TypeScript team
documents this side-by-side setup. The pnpm store paths show `@hey-api/openapi-ts` and `shadcn` resolving
`@typescript/typescript6@6.0.2`.

## Consequences

Code or tools that import `typescript` see TS 6 semantics, while `tsc` checks with TS 7. Editors must be
pointed at the TS 7 language service explicitly. For VS Code, `.vscode/settings.json` already sets
`"js/ts.experimental.useTsgo": true`, and `.vscode/extensions.json` recommends the
`TypeScriptTeam.native-preview` extension that provides it. Scripts run through Node's type stripping,
so they must use erasable syntax only (no enums, namespaces, or parameter properties).

## Revisit when

Hey API ships its TypeScript-free printer, or a release that fixes #4235. Then remove the alias and let
`typescript` be TS 7.
