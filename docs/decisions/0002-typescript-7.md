# 0002: TypeScript 7, with a configuration TypeScript 6 also accepts

Status: Accepted (2026-09-27; amended for the `minimal` branch 2026-09-30)

## Context

TypeScript 7 (the native Go port) typechecks this project in a fraction of a second, which keeps `pnpm check`
fast enough for every commit. It ships no JavaScript compiler API, so a tool that loads `typescript` as a library
does not work on it. On `main` that was Hey API's code generator, which the `minimal` branch does not have.

The `minimal` branch is for projects that bring their own stack, and many of them are still on TypeScript 6. The
gates should not force the upgrade.

## Decision

- `typescript` is pinned to `7.0.2`, used by `tsc` (`pnpm typecheck`).
- `tsconfig.json` uses no setting that only TypeScript 7 knows, so a project on TypeScript 6 can copy it. It names
  every setting whose default changed in 6 (`strict`, `types`, `module`, `target`), so both versions read it the
  same way.
- The other gates do not load the project's TypeScript: Oxlint's type-aware rules run on `oxlint-tsgolint`, and
  Fallow brings its own parser. They work the same on a TypeScript 6 project.
- The TanStack Router lint plugin brings typescript-eslint, whose packages declare `typescript <6.1` as a peer.
  Oxlint gives JS plugins no type information, so that code path never runs; `pnpm-workspace.yaml` allows the peer
  and says when to remove the rule (typescript-eslint/typescript-eslint#10940).

## Evidence (2026-09-30)

- `pnpm check` passes with TypeScript 7.0.2.
- `pnpm --package=typescript@6 dlx tsc --noEmit` (TypeScript 6.0.3) checks the same files and reports no error.

## Consequences

Editors use the TypeScript 7 language service (`.vscode/settings.json` sets `"js/ts.experimental.useTsgo": true`).
Scripts run through Node's type stripping, so they use erasable syntax only (`erasableSyntaxOnly`).

## Revisit when

A setting only TypeScript 7 has would catch real bugs here: then decide whether TypeScript 6 compatibility is still
worth it, and say so in the README.
