# Gates, escape hatches and the less common checks

Reference for agents and maintainers. `AGENTS.md` lists the everyday commands; this file says what each gate
covers and how to make an exception.

## What `pnpm check` runs

`pnpm check` is `lefthook run pre-commit --all-files`: every job in `.config/lefthook.yml`, one at a time, about
5 s, then a summary with each failed job's fix. No build; it needs Playwright's Chromium. No job depends on Vite:
the demo builds with it, but each job reads the source files directly.

| Job | What fails it |
| --- | --- |
| `secrets` | gitleaks on the staged changes, only when a `gitleaks` binary is installed (CI's `secrets` job always runs) |
| `format` | `oxfmt --check` |
| `lint` | type-aware Oxlint with the `pedantic` category, React and React Compiler rules, jsx-a11y, TanStack Router, Playwright and the repository's syntax rules (below); zero warnings: `--deny-warnings`, every rule is error or off |
| `typecheck` | `tsc` |
| `deadcode` | Fallow with `--fail-on-issues`: unused files, exports, types and dependencies, and the zones in `.fallowrc.json` (`lib` imports nothing, `components` only `lib`, the app layer both) |
| `complexity` | Fallow: cognitive 15, cyclomatic 20 per function |
| `dupes` | any clone group outside generated code and tests (`fallow dupes --threshold 0.000001`) |
| `security` | a new security-sink candidate in `src/` on a line changed since `CHECK_BASE_REF` (default `HEAD`) |
| `tests` | `pnpm test:fast`: Vitest projects `unit` and `component` with the coverage gate ([tests/AGENTS.md](../../tests/AGENTS.md)). Two of the tests are gates themselves: `tests/unit/repo-policy.test.ts` and `tests/unit/route-coverage.test.ts` (below) |
| `repo-policy` | `tests/unit/repo-policy.test.ts` alone, on every commit (under a second), so a commit without code runs it too |

The pre-commit hook runs the same jobs, but only those whose `glob` matches a staged file: a Markdown-only commit
runs `secrets` and `repo-policy`, in about a second. `pnpm install` installs the hook
(`prepare`: `lefthook install --reset-hooks-path`, which also clears any `core.hooksPath` setting).

**Working tree, not commit.** lefthook runs each job on the working tree, and every job checks the whole project.
It sets aside the unstaged part of a partially staged file while the jobs run, but a modified file that is not
staged at all, or an untracked one, is checked as if it were part of the commit: a file left out of the commit
can hide a problem the commit has. CI checks the exact commit: `pnpm ci:static` runs `pnpm check` with
`CHECK_BASE_REF=HEAD^` (the commit under test against its parent). A job subset: `pnpm check --job lint --job tests`,
or `LEFTHOOK_EXCLUDE=tests pnpm check`.

## Outside `pnpm check`

| Command | Covers |
| --- | --- |
| `pnpm test:e2e` | The production build in Chromium (`tests/e2e`): flows, axe on every page state, landmark snapshots, tab order. CI job `e2e` |
| `pnpm build && pnpm lighthouse` | The Lighthouse gate (below). CI job `lighthouse` |
| `pnpm audit:check` | `pnpm audit --audit-level high` over production and development packages: fails on a high or critical advisory not in `auditConfig.ignoreGhsas` (`pnpm-workspace.yaml`). Needs the npm registry; CI job `supply-chain`, with `pnpm audit signatures` |
| `pnpm ci:local [job ...]` | The CI jobs (`workflows secrets static supply-chain e2e lighthouse`, default all) as `pnpm ci:<job>` scripts, the container jobs in the Playwright Ubuntu image with a GitHub runner's CPU and memory (`.github/compose.ci.yaml`). Needs Docker |

`pnpm ci:workflows` lints the workflows (actionlint, zizmor) and checks that every copy of a container image pin
matches `scripts/images.ts`; `pnpm ci:secrets` runs gitleaks over the whole history. Both run their tools from
pinned images, so they need Docker and nothing else.

## Escape hatches

Fix what a gate reports; every failure message says how. `git commit --no-verify` skips the hook, and CI runs the
same gates anyway. An exception is always a visible edit next to its reason, and `.github/CODEOWNERS` routes the
gate files to review:

- **Lint:** a rule that is wrong for one line takes `// oxlint-disable-next-line <rule>` under a comment line
  saying why (`tests/unit/repo-policy.test.ts` rejects one without; a stale directive fails). `@ts-expect-error`
  needs a reason of 10 or more characters; `@ts-ignore` and `@ts-nocheck` are banned. Turned-off rules are
  commented in `.oxlintrc.json`.
- **Repository syntax rules** (`eslint-js/no-restricted-syntax` selectors in `.oxlintrc.json`, each message says
  what to do instead): everywhere, `node:child_process` starting pnpm or a `node_modules/.bin` tool (a `.cmd` shim on
  Windows); in `src/`, `as unknown as` and `import.meta.env.VITE_*` (compiled into the browser bundle); in `tests/`,
  `expect(<literal>)`; in component and E2E tests, `setTimeout` and `sleep`. The same comment-and-disable takes an
  exception for one line. A later override replaces the whole selector list of an earlier one, so each override
  repeats the selectors of the wider globs.
- **Tests that never fail:** `vitest/no-focused-tests`, `vitest/no-disabled-tests` and `vitest/warn-todo`; on
  `tests/e2e/**`, where oxlint's vitest rules do not recognize Playwright's `test`, `playwright/no-focused-test`,
  `playwright/no-skipped-test` (a conditional skip is fine: `test.skip(({ isMobile }) => isMobile, 'reason')`;
  `.fixme` fails) and `playwright/no-wait-for-timeout`.
- **Repository rules** (`tests/unit/repo-policy.test.ts`, no exceptions): a lint directive has its reason on the
  line above; every dependency is pinned exactly (`savePrefix: ''`); folders under `src/` are kebab-case; the
  `AGENTS.md` files stay within their size budget.
- **Route coverage** (`tests/unit/route-coverage.test.ts`, reading `scripts/route-coverage.ts`): every page route in
  `src/routes` has an axe state, a landmark snapshot and a tab-order row in `tests/e2e`. No exceptions: a page
  without controls still gets its row, with the navigation as its only stops.
- **complexity:** split the function into named steps. A function that is irreducible gets a
  `health.thresholdOverrides` entry in `.fallowrc.json` with its reason. **dupes:** extract the shared code; a
  deliberate clone goes in `duplicates.ignoredClones`. **security:** keep untrusted input away from the sink; a
  reviewed false positive gets `// fallow-ignore-next-line security-sink` with the reason.
- **audit:check:** an `auditConfig.ignoreGhsas` entry in `pnpm-workspace.yaml` needs a comment with the reason and a
  review date.

## Claude Code hooks and permissions

`.claude/settings.json` (committed) enforces in configuration what `AGENTS.md` asks for.

**Hook.** `PostToolUse` on `Edit|Write|MultiEdit` runs `scripts/format-edited-file.ts`: it reads the hook input on
stdin, formats the edited file with oxfmt and lints that one file with oxlint in its agent format, which keeps each
rule's help text (without `--type-aware`; `pnpm check` adds those rules). A problem goes back to Claude as
`{"decision": "block", "reason": ...}`, which Claude Code adds next to the tool result. Files the Oxc configs ignore
(generated code, Markdown, `node_modules`) and files outside the checkout are skipped. About 0.1 to 1 s per edit.
Try it: `echo '{"tool_input":{"file_path":"'"$PWD"'/src/lib/count-words.ts"}}' | node scripts/format-edited-file.ts`.

**Deny rules.**

- Generated files: `Edit(/src/routeTree.gen.ts)`. An `Edit(...)` rule also covers Write.
- Skipping the pre-commit hook: `git commit --no-verify` and `git commit -n` (as the first or a later option),
  `git -c core.hooksPath...`, `LEFTHOOK=0 ...` and `lefthook uninstall` (also through `pnpm exec`).
- Linters and formatters this repo does not use, whose default scope includes `node_modules`: `eslint`, `prettier`
  and `biome`, directly, through `npx` or through `pnpm dlx`.
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
`pnpm format*`) and `git status`, `git diff` and `git log`. Claude Code applies project `allow` rules only after you
accept the workspace trust dialog. Personal additions go in `.claude/settings.local.json`.

## Lighthouse policy

`scripts/lighthouse.ts` serves `dist/` with `vite preview` over HTTPS and HTTP/2 (a self-signed certificate from
`@vitejs/plugin-basic-ssl`, which Chrome trusts by its key alone), runs Lighthouse with Playwright's Chromium on every
page in `PAGES` (`scripts/lighthouse-policy.ts`), mobile and desktop, and judges the runs by `POLICY`:
accessibility, best practices and SEO must score 100 on every run; performance needs a median of at least 99, at
most one run below 100 and none below 95 (the `target` bar); the median metrics must stay within the budgets.
`agentic-browsing` is reported but not gated. Exit 2 means inconclusive, not failed: a run's `benchmarkIndex` was
below 1000 or Lighthouse warned about a slow CPU (each run's value and warnings are in
`lighthouse-report/summary.json`). CI runs it with `--runs=5 --bar=ci`: performance only fails there when a run
scores below 95, because GitHub's 2-vCPU runners score an unchanged page 99 on mobile
([ADR 0011](../decisions/0011-lighthouse-over-https-http2.md)); the other categories and the budgets are as strict as
locally.

`pnpm build && pnpm lighthouse [--runs=3] [--page=<name>] [--form-factor=mobile|desktop] [--protocol=h2|h1|http]
[--bar=target|ci]`. `--protocol=h1|http` measures HTTP/1.1 to compare. A real host adds what `vite preview` does
not: its own headers, caching and compression level. Measure the deployed site too once there is one.
