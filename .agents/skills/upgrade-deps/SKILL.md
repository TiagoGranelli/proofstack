---
name: upgrade-deps
description: Upgrade dependencies in this repo and apply its version policy (exact pins, the one-day release quarantine, trust policy, overrides, audit exceptions). Use when bumping any package version, reviewing a Renovate PR, acting on pnpm audit:check, or when an install fails the release quarantine or the trust policy.
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
  the lockfile). An advisory that cannot apply here goes in `auditConfig.ignoreGhsas` in
  `pnpm-workspace.yaml`, with a comment giving the reason and a review date (write it by hand; `pnpm audit
  --ignore` adds the id without the comment). `pnpm audit:check` is the gate; Renovate's OSV alerts open fix PRs.
- Pre-release packages are pinned exactly and upgraded one per PR: today `oxfmt` (0.x, announced as beta).
- The Playwright library, `@playwright/test` and the runner image in `scripts/images.ts` and
  `.github/compose.ci.yaml` move together (Renovate's `playwright` group), so the browsers match the library.

## Steps

1. Renovate (`.github/renovate.json`) opens the PRs, a week after each release. By hand, `pnpm outdated` lists what
   is newer.
2. Upgrade one pre-release package per PR: `pnpm add --save-exact <name>@<version>`.
3. After a TypeScript bump, check that TypeScript 6 still passes too:
   `pnpm --package=typescript@6 dlx tsc --noEmit` ([ADR 0002](../../../docs/decisions/0002-typescript-7.md)).
4. Run `pnpm check` and `pnpm test:e2e`; for anything that changes the shipped bundle (React, the router, Vite,
   Tailwind), also `pnpm build && pnpm lighthouse`. All must pass.

## Done when

The commands pass, `package.json` and `pnpm-lock.yaml` change together, and every exception added to
`pnpm-workspace.yaml` names the exact version and its reason.
