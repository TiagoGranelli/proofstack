# Gates, escape hatches and the less common checks

Reference for agents and maintainers. `AGENTS.md` lists the everyday commands; this file says what each gate
covers and how to make an exception.

## What `pnpm check` runs

`pnpm check` is `lefthook run pre-commit --all-files`: every job in `.config/lefthook.yml`, one at a time, about
16 s, then a summary with each failed job's fix. No database, no build; it needs Playwright's Chromium.

| Job | What fails it |
| --- | --- |
| `secrets` | gitleaks on the staged changes, only when a `gitleaks` binary is installed (CI's `secrets` job always runs) |
| `format` | `oxfmt --check` |
| `lint` | type-aware Oxlint with the `pedantic` category, TanStack Query/Router, Playwright and the repository's syntax rules (below); zero warnings: `--deny-warnings`, every rule is error or off |
| `typecheck` | `tsc` |
| `effect` | Effect language-service diagnostics (`effect-tsgo diagnostics --strict`); every rule whose default is a suggestion is promoted to a warning in `tsconfig.json`, so it fails too |
| `deadcode` | Fallow with `--fail-on-issues`: unused files, exports, types and dependencies, zones |
| `complexity` | Fallow: cognitive 15, cyclomatic 20 per function |
| `dupes` | any clone group outside generated code and tests (`fallow dupes --threshold 0.000001`) |
| `security` | a new security-sink candidate in `src/` on a line changed since `CHECK_BASE_REF` (default `HEAD`). The generated SDK carries `// fallow-ignore-file security-sink` (Hey API `output.header`) |
| `tests` | `pnpm test:fast`: Vitest projects `unit`, `api` and `component` with the coverage gate ([tests/AGENTS.md](../../tests/AGENTS.md)). Two of the tests are gates themselves: `tests/unit/repo-policy.test.ts` and `tests/api/public-operations.test.ts` (below) |
| `repo-policy` | `tests/unit/repo-policy.test.ts` alone, on every commit (under a second), so a commit without code runs it too |
| `drift` | `check:drift contract migrations auth`. `contract` runs `pnpm codegen` in place and fails if it changed `openapi.json` or `src/sdk` (the regenerated files stay, ready to commit) |
| `migrations` | `squawk --config .config/squawk.toml drizzle/*.sql` (`squawk-cli` from npm) over the migrations after 0004 |
| `licenses` | a production dependency whose SPDX expression (`spdx-satisfies`) the list in `scripts/licenses.ts` does not allow |

The pre-commit hook runs the same jobs, but only those whose `glob` matches a staged file: a Markdown-only commit
runs `secrets` and `repo-policy`, in about a second. `pnpm install` installs the hook
(`prepare`: `lefthook install --reset-hooks-path`, which also clears any `core.hooksPath` setting).

**Working tree, not commit.** lefthook runs each job on the working tree, and every job checks the whole project.
It sets aside the unstaged part of a partially staged file while the jobs run, but a modified file that is not
staged at all, or an untracked one, is checked as if it were part of the commit: a file left out of the commit
can hide a problem the commit has. CI checks the exact commit: `pnpm ci:static` runs `pnpm check` with
`CHECK_BASE_REF=HEAD^` (the commit under test against its parent) and without `drift`, which the `drift` job runs
in full. A job subset: `pnpm check --job lint --job tests`, or `LEFTHOOK_EXCLUDE=tests pnpm check`.

## Escape hatches

Fix what a gate reports; every failure message says how. `git commit --no-verify` skips the hook, and CI runs the
same gates anyway. An exception is always a visible edit next to its reason, and `.github/CODEOWNERS` routes the
gate files to review:

- **Lint:** a rule that is wrong for one line takes `// oxlint-disable-next-line <rule>` under a comment line
  saying why (`tests/unit/repo-policy.test.ts` rejects one without; a stale directive fails). `@ts-expect-error`
  needs a reason of 10 or more characters; `@ts-ignore` and `@ts-nocheck` are banned. Turned-off rules are
  commented in `.oxlintrc.json`.
- **Repository syntax rules** (`eslint-js/no-restricted-syntax` selectors in `.oxlintrc.json`, each message says
  what to do instead): in `src/`, `as unknown as`, a CORS header, `import.meta.env.VITE_*` (compiled into the
  browser bundle) and a server function validator that is not `Schema.toStandardSchemaV1(...)`; in `src/routes/`,
  a raw server route (`server.handlers`) outside `api/$.ts` and `api/auth/$.ts`; in `tests/`, `expect(<literal>)`;
  in component, integration and E2E tests, `setTimeout` and `sleep`. The same comment-and-disable takes an
  exception for one line. A later override replaces the whole selector list of an earlier one, so each override
  repeats the selectors of the wider globs.
- **Tests that never fail:** `vitest/no-focused-tests`, `vitest/no-disabled-tests` and `vitest/warn-todo`; on
  `tests/e2e/**`, where oxlint's vitest rules do not recognize Playwright's `test`, `playwright/no-focused-test`,
  `playwright/no-skipped-test` (a conditional skip is fine: `test.skip(({ isMobile }) => isMobile, 'reason')`;
  `.fixme` fails) and `playwright/no-wait-for-timeout`.
- **Repository rules** (`tests/unit/repo-policy.test.ts`, no exceptions): a lint directive has its reason on the
  line above; every dependency is pinned exactly (`savePrefix: ''`); migrations in the journal at
  `CHECK_BASE_REF` are never edited or deleted (`git diff --diff-filter=MD`) and keep their journal entries;
  `src/styles/app.css` keeps `source("../")`; folders under `src/` are kebab-case; the app's name appears only in
  `package.json`, `src/config/app.ts` and prose (`APP_NAME`, docs/adopting.md); the `AGENTS.md` files stay
  within their size budget; every `-- squawk-ignore` has its reason on the line above.
- **Public operations** (`tests/api/public-operations.test.ts`): every operation answers 401 without a session
  unless `PUBLIC_OPERATIONS` there lists it. A new public endpoint is a reviewed edit of that list.
- **effect:** the JSDoc tag or `@effect-diagnostics` comment the diagnostic names, with the reason (see
  `Authentication` in `src/contract/middleware.ts`).
- **complexity:** split the function into named steps. A function that is irreducible gets a
  `health.thresholdOverrides` entry in `.fallowrc.json` with its reason. **dupes:** extract the shared code; a
  deliberate clone goes in `duplicates.ignoredClones`. **security:** keep untrusted input away from the sink; a
  reviewed false positive gets `// fallow-ignore-next-line security-sink` with the reason.
- **migrations:** make the migration safe, or waive one statement with `-- squawk-ignore <rule>` under a comment
  line giving the reason ([docs/operations.md](../operations.md#migration-safety)). **licenses:** an
  acceptable license goes in `ALLOWED` in `scripts/licenses.ts`, one exact version in `EXCEPTIONS`, each with the
  reason. **audit:check:** an `auditConfig.ignoreGhsas` entry in `pnpm-workspace.yaml` needs a comment with the reason
  and a review date. The image scan: an `ignore` rule in `.config/grype.yaml` needs a `reason` with a review date.

## Claude Code hooks and permissions

`.claude/settings.json` (committed) enforces in configuration what `AGENTS.md` asks for.

**Context size.** `autoCompactWindow` is 200,000 tokens. Every model turn re-reads the whole conversation, so its
cost grows with the context; models with a 1M window otherwise compact only near the limit. When an agent added
comments to posts, the context reached 650k tokens and re-reading it was about 85% of the cost. Raise it in
`.claude/settings.local.json` for a task that needs more history. `.claude/agents/verifier.md` runs the slow commands
(`verify:app`, `test:e2e`, `build`) on a smaller model and returns only the failures, so their logs never enter the
main conversation.

**Hook.** `PostToolUse` on `Edit|Write|MultiEdit` runs `scripts/format-edited-file.ts`: it reads the hook input on
stdin, formats the edited file with oxfmt and lints that one file with oxlint (without `--type-aware` and without
`no-unused-vars`, which an import is between the edit that adds it and the edit that uses it; `pnpm check` adds
both). A problem goes back to Claude as `{"decision": "block", "reason": ...}`, which Claude Code adds
next to the tool result. Files the Oxc configs ignore (generated code, Markdown, `node_modules`) and files outside
the checkout are skipped. About 0.1 to 1 s per edit. Try it:
`echo '{"tool_input":{"file_path":"'"$PWD"'/src/lib/utils.ts"}}' | node scripts/format-edited-file.ts`.

**Deny rules.**

- Generated files: `Edit(/src/sdk/**)`, `Edit(/openapi.json)`, `Edit(/src/routeTree.gen.ts)`,
  `Edit(/drizzle/meta/**)`. An `Edit(...)` rule also covers Write. Committed migrations are protected by
  `tests/unit/repo-policy.test.ts` instead, because a new migration may still be adjusted before its first commit.
- Skipping the pre-commit hook: `git commit --no-verify` and `git commit -n` (as the first or a later option),
  `git -c core.hooksPath...`, `LEFTHOOK=0 ...` and `lefthook uninstall` (also through `pnpm exec`).
- Linters and formatters this repo does not use, whose default scope includes `node_modules` and `.repos/`:
  `eslint`, `prettier` and `biome`, directly, through `npx` or through `pnpm dlx`.
- Oxc runs without the ignore lists: any command with `--no-ignore` or `--ignore-path`, and oxlint or oxfmt with
  `-c` or `--config`.

Claude Code matches deny rules against every subcommand of a compound command (`&&`, `||`, `;`, `|`, newlines,
subshells, command substitution), past leading `VAR=value` assignments and past wrappers such as `timeout`. They
match the command text Claude writes, so they are a guard rail and cannot serve as a security boundary
([permissions docs](https://code.claude.com/docs/en/permissions#what-a-bash-rule-doesn-t-match)). Not covered: a
program called by path (`node_modules/.bin/eslint`) or through `sh -c`, `git -C . commit --no-verify`, a
clustered `-an`, `pnpm exec eslint`, and other tools. A rule can also refuse a harmless command, such as
`rg --no-ignore` or a commit message containing ` -n`. CI runs every gate regardless.

**Allow rules** cover the everyday gates (`pnpm check*`, `pnpm test*`, `pnpm typecheck`, `pnpm lint*`,
`pnpm format*`, `pnpm codegen`, `pnpm db:generate *`) and `git status`, `git diff` and `git log`. Claude Code
applies project `allow` rules only after you accept the workspace trust dialog. Personal additions go in
`.claude/settings.local.json`.

## Lighthouse policy

`POLICY` in `scripts/lighthouse-policy.ts`: per page and form factor, accessibility, best practices and SEO must score
100 on every run; performance needs a median of at least 99, at most one run below 100 and none below 95 (the
`target` bar); the median metrics must stay within the budgets. `agentic-browsing` is reported but not gated. SEO is not gated on
`/login` and `/dashboard` (noindex). Exit 2 means inconclusive, not failed: a run's `benchmarkIndex` was below
1000 or Lighthouse warned about a slow CPU (each run's value and warnings are in
`lighthouse-report/summary.json`). CI runs `pnpm lighthouse --runs=5 --bar=ci`: performance only fails there when a
run scores below 95, because GitHub's 2-vCPU runners score an unchanged page 99 on mobile (ADR 0011);
the other categories and the budgets are as strict as locally. A mobile 99 whose runs show a preload task of
10 ms or more (`perRun[].preloadTaskMs`, and a note in `summary.md`) comes from a contended host, not from the page:
Lantern then adds four times that task before every preloaded script ([ADR 0011](../decisions/0011-lighthouse-over-https-http2.md#the-preload-task-and-why-ci-scored-99)).

`pnpm build && pnpm lighthouse [--runs=3] [--page=<name>] [--form-factor=mobile|desktop] [--direct]
[--edge-protocol=h2|h1|http]` runs the gate on the built app behind the Caddy edge over HTTPS and HTTP/2, as in
production (needs Docker); see [ADR 0011](../decisions/0011-lighthouse-over-https-http2.md).

## Less common commands

| Command | Covers |
| --- | --- |
| `pnpm audit:check` | `pnpm audit --audit-level high` over production and development packages: fails on a high or critical advisory not in `auditConfig.ignoreGhsas` (`pnpm-workspace.yaml`). Needs the npm registry; CI job `supply-chain` |
| `pnpm sbom:release` | `pnpm sbom`: a CycloneDX 1.7 SBOM of the production npm dependencies, with licenses, in `sbom/npm.cdx.json`, for a release. Needs `node_modules`. Not a gate |
| `pnpm ci:local [job ...]` | The CI jobs (`workflows secrets static supply-chain drift build verify lighthouse docker`, default all) as `pnpm ci:<job>` scripts in the Playwright Ubuntu container next to Postgres and Mailpit, all five browser projects included. Needs Docker. See [docs/operations.md](../operations.md#ci-and-local-ci) |
| `harbor run -p .agents/evals/tasks -a <agent> -m <model>` | The agent eval ([evals.md](evals.md)): an agent solves each task in a container, graded by `pnpm check`, drift and hidden checks. Needs Docker and Harbor, and runs a paid agent; not a gate |
