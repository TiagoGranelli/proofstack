# 0008: Pinned official skills, package-shipped docs, and on-demand source snapshots

Status: Accepted (2026-09-27)

## Context

Coding agents write better code for fast-moving RC libraries when they read the docs for the installed
version. Options include official skills from GitHub, docs shipped inside npm packages, and copies of
upstream source (the Effect blog suggests `git subtree` into `.repos/`). Anything committed must be pinned,
licensed for redistribution, and excluded from tooling.

## Decision

- Commit only `shadcn` (MIT, pinned to commit `7c9eaba`, the tag `shadcn@4.21.0`) through the `skills` CLI
  1.7.0, with `skills-lock.json`.
- Load Effect, TanStack, Fallow, and Playwright guidance from their installed packages. The lockfile
  pins those versions.
- Better Auth's skills have no license, so they are loaded on demand only (`skills use`) and never
  committed.
- Do not commit upstream sources. Partial, sparse git clones fetch filtered snapshots (1–2 MB each) at
  the lockfile's version into the git-ignored `.repos/`.

## Evidence

Measurements are in `docs/agents/skills.md` and `docs/agents/dependency-sources.md`. The full upstream
trees are 42–77 MB, the tarballs 8–29 MB, and the filtered snapshots 1.1–1.9 MB. `node_modules/effect`
already ships `src/` and `AGENTS.md`, and the TanStack packages ship 22 skills.

## Consequences

Agents need network access and `gh` to fetch snapshots. The shadcn skill embeds an unpinned
`npx shadcn@latest` command, and `AGENTS.md` directs agents to `pnpm exec shadcn` instead.

## Revisit when

Agents need sources offline (then commit snapshots), Better Auth adds a
license, or official skills appear for Drizzle, Hey API, or TanStack Query.
