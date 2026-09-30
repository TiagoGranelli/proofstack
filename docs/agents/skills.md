# Agent skills and package-shipped docs

A third-party skill is committed to this repository only when it is official, its license allows redistribution,
no installed package already ships it, and it helps with this stack. Everything else is loaded from
`node_modules` (pinned by `pnpm-lock.yaml`) or fetched on demand.

## Project skills (this repository's own)

The multi-step workflows of `AGENTS.md` are skills, so their steps load only when a task needs them. Each lives
in `.agents/skills/<name>/SKILL.md` (read by Codex, which scans `.agents/skills` from the working directory up to
the repository root) with a relative symlink `.claude/skills/<name>` (Claude Code reads `.claude/skills` and
follows symlinked skill folders). Both tools show only `name` and `description` until a task matches the
description, then load the whole file.

| Skill | Loads when |
| --- | --- |
| `upgrade-deps` | Any dependency bump, a Renovate PR, `pnpm audit:check`, or an install that fails the release quarantine; holds the version policy |

Rules for adding or editing one:

- `name` equals the folder name (lowercase letters, digits and hyphens, at most 64 characters) and
  `description` is one line of at most 1,024 characters (the [Agent Skills spec](https://agentskills.io/specification);
  Claude Code allows 1,536 for `description` plus `when_to_use`). Put the trigger cases in the description: it
  is the only part an agent sees before deciding to load the skill.
- `.claude/skills/<name>` is a symlink to `../../.agents/skills/<name>`.
- Keep each `SKILL.md` well under 500 lines; link to docs for reference material instead of copying it.

`tests/unit/repo-policy.test.ts` (part of `pnpm check`) keeps the instruction files small. The root `AGENTS.md` stays
under 14 KiB, because every session loads it. A nested `AGENTS.md` (`tests/`) holds rules for one directory; give each
a `CLAUDE.md` next to it containing `@AGENTS.md`, because Claude Code loads a subdirectory's `CLAUDE.md` when it reads
a file there and, with a root `CLAUDE.md` present, does not read `AGENTS.md` files on its own. Codex reads nested files
only for a session started inside that directory, concatenating every `AGENTS.md` from the root down and stopping at
32 KiB (`project_doc_max_bytes`), so the root file points to each nested one and every root-to-directory chain stays
under 28 KiB.

## Shipped inside installed packages (pinned by the lockfile)

| Library | What ships | How to load |
| --- | --- | --- |
| TanStack Router | Skills in `@tanstack/router-core` (10), `@tanstack/router-plugin` (1) and `@tanstack/virtual-file-routes` (1) | `pnpm dlx @tanstack/intent@0.4.0 list`, then `pnpm dlx @tanstack/intent@0.4.0 load <package>#<skill>`. Intent is MIT. Pin its version: the `Load:` lines it prints use `@tanstack/intent@latest`, so replace `@latest` with `@0.4.0`. Some router-core skills cover SSR, which this client-side app does not use |
| Fallow | `node_modules/fallow/skills/fallow/` | Read `node_modules/fallow/skills/fallow/SKILL.md`, or run `pnpm dlx @tanstack/intent@0.4.0 load fallow#fallow` |
| Playwright | `playwright-core/lib/tools/skills/`: `playwright-trace`, `playwright-cli`, `playwright-component-testing` | For failed E2E runs, use `pnpm exec playwright trace open test-results/playwright/<test>/trace.zip`, then `trace actions`, `trace errors`, and `trace requests`. The skill files are at `find node_modules/.pnpm -path '*playwright-core/lib/tools/skills/*/SKILL.md'` |

`package.json` sets `"intent": { "skills": ["@tanstack/*", "fallow"] }`, so `intent list` shows only those sources.

## Tooling exclusions

Skill files are Markdown, with no JS or TS. `.oxfmtrc.json` ignores `.agents/**`, `.claude/**` and `**/*.md`, and
`.oxlintrc.json` ignores `.agents/**` and `.claude/**`. `tsconfig.json` includes only `src`, `scripts`, `tests` and
`*.config.ts`. If a future skill ships `.ts` or `.js` files, add `.agents/**` and `.claude/**` to the Fallow
`ignorePatterns`; Oxlint already skips them.
