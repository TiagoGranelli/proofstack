# Agent skills and package-shipped docs

Checked 2026-09-27. A skill is committed to this repo only when it is official, its license allows
redistribution, no installed package already ships it, and it helps with this stack. Everything else is
loaded from `node_modules` (pinned by `pnpm-lock.yaml`) or fetched on demand.

## Installed (in the repository, pinned to a commit)

| Field | `shadcn` |
| --- | --- |
| Source | https://github.com/shadcn-ui/ui/tree/7c9eaba1c0a6404c990c144a654792e3313c650d/skills/shadcn |
| Commit | `7c9eaba1c0a6404c990c144a654792e3313c650d`, the commit of tag `shadcn@4.21.0`, which matches the `shadcn` devDependency. `skills/shadcn` is unchanged on `main` up to `98a1fe6` (2026-09-21). |
| License | MIT |
| Size | 15 files, 98,055 bytes |
| Location | `.agents/skills/shadcn/` (canonical, read by Codex) with the symlink `.claude/skills/shadcn` (Claude Code) |
| Lock | `skills-lock.json` records the commit (`ref`) and a content hash (`computedHash`) |
| Installed | 2026-09-27 with `skills@1.7.0` |

Update it in the same PR that bumps the `shadcn` devDependency:

```sh
git ls-remote https://github.com/shadcn-ui/ui 'refs/tags/shadcn@<version>^{}'   # peeled commit of the release tag
DISABLE_TELEMETRY=1 npx -y skills@1.7.0 add https://github.com/shadcn-ui/ui/tree/<commit>/skills/shadcn \
  --skill shadcn -a claude-code codex -y
```

The CLI clones the upstream repository (sparse and shallow), so run it under a memory cap. Afterwards,
review the diff of `.agents/skills/shadcn` and `skills-lock.json` and update the table above.

**Unpinned command in the skill.** `SKILL.md` embeds ``!`npx shadcn@latest info --json` ``. Claude Code
runs that command when the skill loads, which downloads the latest shadcn from npm and bypasses the
lockfile and pnpm's release-age quarantine. The skill's examples also use `npx shadcn@latest`. In this
repo, run the pinned CLI instead: `pnpm exec shadcn info --json`, `pnpm exec shadcn docs <component>`,
and `pnpm exec shadcn add <component>`. To stop the injection, a maintainer can set
`"disableSkillShellExecution": true` in `.claude/settings.json`. That setting also disables `!` commands
in personal skills while working in this repo, so it is not set by default.

## Shipped inside installed packages (pinned by the lockfile)

| Library | What ships | How to load |
| --- | --- | --- |
| TanStack Start and Router | 22 skills: `@tanstack/react-start` 1.168.58 (3), `@tanstack/start-client-core` 1.170.32 (7), `@tanstack/start-server-core` 1.169.37 (1), `@tanstack/router-core` 1.171.32 (10), `@tanstack/router-plugin` 1.168.40 (1) | `pnpm dlx @tanstack/intent@0.4.0 list`, then `pnpm dlx @tanstack/intent@0.4.0 load <package>#<skill>`. Intent is MIT. Pin its version: the `Load:` lines it prints use `@tanstack/intent@latest`, so replace `@latest` with `@0.4.0`. |
| Effect 4.0.0-rc.117 | `node_modules/effect/AGENTS.md` (409 lines), `ai-docs/` (about 150 KB of content), and `src/` (20 MB) | Read `node_modules/effect/AGENTS.md` before writing Effect code. The upstream skill `Effect-TS/skills/effect-ts` (MIT, 870 bytes, commit `2309e6f`) only says to do that, so the instruction is in `AGENTS.md` and the skill is not installed. `effect-v3-to-v4` is not needed because the project already uses v4. |
| Fallow 3.29.0 | `node_modules/fallow/skills/fallow/` (about 330 KB of content) | Read `node_modules/fallow/skills/fallow/SKILL.md`, or run `pnpm dlx @tanstack/intent@0.4.0 load fallow#fallow`. `fallow-rs/fallow-skills` (MIT) is not installed because the package already ships it. |
| Playwright 1.63.0 | `playwright-core/lib/tools/skills/`: `playwright-trace` (12 KB), `playwright-cli` (88 KB), `playwright-component-testing` (52 KB) | For failed E2E runs, use `pnpm exec playwright trace open test-results/<test>/trace.zip`, then `trace actions`, `trace errors`, and `trace requests`. The skill files are at `find node_modules/.pnpm -path '*playwright-core/lib/tools/skills/*/SKILL.md'`. `microsoft/playwright-cli` (Apache-2.0) duplicates them. |

`package.json` sets `"intent": { "skills": ["@tanstack/*", "fallow"] }`, so `intent list` shows only
those sources: 7 packages and 24 skills, which are the 22 above, one from the transitive
`@tanstack/virtual-file-routes`, and Fallow's. The two skills of the transitive `dotenv` are hidden, and a
notice says so.

Sizes are content bytes (`du -sb`); `du -h` reports more because it counts disk blocks.

## On demand only (not redistributable)

**Better Auth.** `better-auth/skills` at `20c9e88a5c007461a703f1c213572b073196113e` (2026-09-01) has no
LICENSE file and no license metadata. By default that means all rights reserved, so no copy is committed.
To print a skill into the session without writing files:

```sh
DISABLE_TELEMETRY=1 npx -y skills@1.7.0 use \
  https://github.com/better-auth/skills/tree/20c9e88a5c007461a703f1c213572b073196113e/better-auth/best-practices
```

The relevant skills are `better-auth/best-practices`, `better-auth/emailAndPassword`, and `security`.
The Better Auth docs for the installed version are MIT and can be fetched with
`node scripts/vendor-source.ts better-auth` (see [dependency-sources.md](dependency-sources.md)).

## Not available or not useful

- **No official skill:** Drizzle, Hey API, Vitest, and TanStack Query. Query's guidance is limited to
  what the Router skills cover.
- **Oxc:** its skills are migration-only (from ESLint or Prettier), and this repo already uses Oxlint and
  Oxfmt.
- **shadcn `migrate-radix-to-base`:** the project deliberately stays on Radix (`radix-nova`).

## Tooling exclusions

Skill files are Markdown, JSON, YAML, and PNG, with no JS or TS. `.oxfmtrc.json` ignores `.agents/**`,
`.claude/**`, `skills-lock.json`, `repos/**`, and `**/*.md`. `.oxlintrc.json` ignores `.agents/**`,
`.claude/**`, and `repos/**`; `.fallowrc.json` ignores `repos/**`. `tsconfig.json` includes only `src`,
`scripts`, `tests`, and `*.config.ts`, and excludes `repos`. If a future skill ships `.ts` or `.js` files,
add `.agents/**` and `.claude/**` to the Fallow `ignorePatterns`; Oxlint already skips them.
