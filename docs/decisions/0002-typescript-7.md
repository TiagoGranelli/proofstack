# 0002: TypeScript 7 only, with the Hey API snapshot that no longer needs the TypeScript API

Status: Accepted (2026-09-27; replaces the TS 6 alias decided on 2026-09-26)

## Context

TypeScript 7 (the native Go port) ships no JS compiler API. Hey API 0.99.0, the latest stable release, uses
that API to print code and crashes on TS 7 (hey-api/openapi-ts#4235, still open). The first version of this
ADR kept `typescript` as an alias for TS 6 so Hey API could run. Hey API's own printer, which removes the
TypeScript dependency, is merged upstream (PRs #4163 and #4166) and published on the `next` dist-tag, but not
yet in a stable release.

## Decision

- `typescript` is `7.0.2`: one TypeScript in the project, used by `tsc` (`pnpm typecheck`).
- `@hey-api/openapi-ts` is pinned exactly to `0.0.0-next-20260824173136` (the `next` dist-tag), which has no
  `typescript` dependency or peer.
- Dependabot ignores `@hey-api/openapi-ts`: it would otherwise propose `0.99.0`, which sorts higher but
  crashes on TS 7. `pnpm deps:check` reports when a stable release newer than 0.99.0 appears.

## Evidence (2026-09-27)

- With the snapshot, `pnpm codegen` produces the same six files as 0.99.0 did (types, SDK, TanStack Query
  options including the infinite queries, MSW handlers); `git diff -w` on `src/sdk` is empty, the only change
  is indentation. Two runs are byte-identical.
- `pnpm check` (TS 7 typecheck, lint, 250+ fast tests), `pnpm check:drift`, `pnpm build` and
  `pnpm verify:app` (109 integration, 139 E2E) pass.
- The other packages that mention `typescript` accept TS 7 or don't need it: `cosmiconfig` and `msw` (optional
  peers), Fallow (bundles its own TS 7), shadcn (uses ts-morph, which bundles TypeScript; `shadcn add --dry-run`
  works).

## Consequences

A snapshot build is not a stable release: it is pinned exactly, regenerated output is checked by
`pnpm check:drift contract`, and the whole SDK is exercised by the integration suite on every change. Editors
use the TS 7 language service (`.vscode/settings.json` sets `"js/ts.experimental.useTsgo": true`). Scripts run
through Node's type stripping, so they use erasable syntax only (`erasableSyntaxOnly`).

## Revisit when

Hey API publishes a stable release that includes the TypeScript-free printer: switch to it (expect an
indentation-only diff in `src/sdk`) and drop the Dependabot ignore.
