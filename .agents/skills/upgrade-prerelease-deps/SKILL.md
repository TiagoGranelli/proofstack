---
name: upgrade-prerelease-deps
description: Upgrade dependencies in this repo, above all the pinned pre-release ones (effect, @effect/vitest, nitro, @tanstack/react-start, oxfmt, @hey-api/openapi-ts). Use when bumping any package version, acting on pnpm deps:check or pnpm audit:check, or when an install fails the release quarantine.
---

# Upgrade dependencies

## Policy

- `package.json` uses exact versions (`savePrefix: ''`; `tests/unit/repo-policy.test.ts` checks), and `pnpm-lock.yaml`
  is committed with them. pnpm 12 blocks dependency build scripts (`allowBuilds`) and quarantines fresh
  releases (`minimumReleaseAge`, one day, strict: a younger version fails the install instead of being excluded
  silently). Each exception names an exact version and its reason in `pnpm-workspace.yaml`.
  `trustPolicy: no-downgrade` fails a version published with weaker provenance than an earlier one, and
  `strictPeerDependencies` an unmet peer. Every frozen install checks the lockfile against these policies.
- A vulnerable transitive package gets an exact `overrides` entry in `pnpm-workspace.yaml` naming the advisory
  (and an `ignoreDependencyOverrides` entry in `.fallowrc.json`, since the overridden version is no longer in
  the lockfile). What cannot be fixed goes in `security/audit-allowlist.json` with a reason and an expiry.
  Dependabot security alerts do not work with pnpm 12 lockfiles; `pnpm audit:check` is the gate.
- Pre-release packages, pinned exactly: `effect` and `@effect/vitest` (4.0.0 RCs from the `rc` dist-tag; npm
  `latest` is v3), `nitro` (its npm `latest` is a `-beta` build), `@tanstack/react-start` (npm `latest` is a 1.x
  release, but Start's docs still call it a Release Candidate), `oxfmt` (0.x, announced as beta) and
  `@hey-api/openapi-ts` (a `next` snapshot, below).
- Skills are pinned to a commit (`skills-lock.json`); update the shadcn skill in the PR that bumps `shadcn`
  ([docs/agents/skills.md](../../../docs/agents/skills.md)). Docs shipped inside packages are pinned by the
  lockfile.

## Steps

1. `pnpm deps:check` reports what is newer (and the `rc` and `next` dist-tags).
2. Upgrade one pre-release package per PR: `pnpm add --save-exact <name>@<version>`.
3. Package-specific work:
   - **Effect:** starting with the next RC after `4.0.0-rc.117`, `effect/unstable/httpapi` becomes
     `effect/http-api` and `effect/unstable/http` becomes `effect/http`, with no compatibility exports (Effect
     PRs #8354 and #8365). Rewrite the imports in `src/contract`, `src/server/api` and `scripts/openapi.ts`, run
     `pnpm codegen`, and review the `openapi.json` diff. Upgrade `@effect/vitest` with it.
   - **Hey API:** stays on the `next` snapshot `0.0.0-next-20260824173136`. The stable 0.99.0 needs the JS
     compiler API that TypeScript 7 no longer has, and crashes; Dependabot ignores it
     ([ADR 0002](../../../docs/decisions/0002-typescript-7.md)). After any bump, run `pnpm codegen` and review
     the `src/sdk` diff.
   - **@effect/tsgo** (0.x): the tsconfig plugin serves editors and `effect-tsgo diagnostics` is the `effect`
     gate. Use it through those two only; `effect-tsgo patch` stays unused.
4. Run `pnpm check`, `pnpm check:drift`, and `pnpm build && pnpm verify:app`. All three must pass.

## Done when

The three commands pass, `package.json` and `pnpm-lock.yaml` change together, and every exception added to
`pnpm-workspace.yaml` names the exact version and its reason.
