# Gates, escape hatches and the less common checks

Reference for agents and maintainers. `AGENTS.md` lists the everyday commands; this file says what each gate
covers and how to make an exception.

## What `pnpm check` runs

`format:check`, `lint` (type-aware Oxlint with the `pedantic` category and TanStack Query/Router rules; zero
warnings: `--deny-warnings`, every rule is error or off), `typecheck`, `effect` (Effect language-service
diagnostics, `effect-tsgo`), `deadcode` (Fallow with `--fail-on-issues`: unused files, exports, types and
dependencies, zones), `complexity` (Fallow: cognitive 15, cyclomatic 20 per function), `dupes` (any clone group
outside generated code and tests), `security` (new security-sink candidates in `src/` since `HEAD`), `tests`
(`pnpm test:fast`: Vitest projects `unit`, `api` and `component` with the coverage gate, see
[tests/AGENTS.md](../../tests/AGENTS.md)), `drift` (the database-free drift checks: contract, migrations,
auth), `migration-lint` (`pnpm check:migrations`: squawk over the migrations after 0004), `licenses`
(`pnpm licenses:check`: every production dependency under an allowed license), `routes` (every page route has an
axe state, a landmark snapshot and a tab-order row: `scripts/route-coverage.ts`) and `guards` (below).

No database, no build, about 12 s. It needs Playwright's Chromium, and the network once to download the pinned
squawk binary into `~/.cache/proofstack`. `pnpm check --only=<gate,...>` or `--skip=<gate,...>` runs a subset.

## Escape hatches

Fix what a gate reports; every failure message says how. `pnpm install` activates the pre-commit hook
(`prepare` sets `core.hooksPath` unless the clone already has one); `git commit --no-verify` skips it, and CI
runs the same gates anyway. An exception is always a visible edit next to its reason, and `.github/CODEOWNERS`
routes the gate files to review:

- **Lint:** a rule that is wrong for one line takes `// oxlint-disable-next-line <rule>` under a comment line
  saying why (the `bare-disable` guard rejects one without; a stale directive fails). `@ts-expect-error` needs a
  reason of 10 or more characters; `@ts-ignore` and `@ts-nocheck` are banned. Turned-off rules are commented in
  `.oxlintrc.json`.
- **effect:** the JSDoc tag or `@effect-diagnostics` comment the diagnostic names, with the reason (see
  `Authentication` in `src/contract/middleware.ts`).
- **complexity:** split the function into named steps. A function that is irreducible gets a
  `health.thresholdOverrides` entry in `.fallowrc.json` with its reason. **dupes:** extract the shared code; a
  deliberate clone goes in `duplicates.ignoredClones`. **security:** keep untrusted input away from the sink; a
  reviewed false positive gets `// fallow-ignore-next-line security-sink` with the reason.
- **guards** (`scripts/check.ts`): `focused-test` (`.only`, `.fixme`, `.todo`), `skipped-test` (a skip without
  a condition; `test.skip(({ isMobile }) => isMobile, 'reason')` is fine), `test-sleep` (fixed waits in
  component, integration and E2E tests), `tautology` (`expect(<literal>)`), `double-cast` (`as unknown as` in
  `src`) and `cors` accept `// guards-allow <guard>: <reason>` on the line above. The others use allowlists in
  `scripts/check.ts`: `vite-env` (`PUBLIC_VITE_ENV`), `openapi-security` (`PUBLIC_OPERATIONS`: operations
  without a session), `server-routes` (`SERVER_ROUTES`: the only Start server routes). `exact-versions`,
  `server-fn-validator` (Effect Schema only), `applied-migrations` (migrations in the journal at `HEAD` never
  change; on CI, at `HEAD^`), `bare-disable`, `tailwind-source`, `folder-name` and `agent-docs` (the size
  budget of the `AGENTS.md` files) have no exception.
- **migration-lint:** make the migration safe, or waive one statement with `-- squawk-ignore <rule>` under a
  comment line giving the reason ([docs/operations.md](../operations.md#migration-safety)). **licenses:** an
  acceptable license goes in `ALLOWED` in `scripts/licenses.ts`, one exact version in `EXCEPTIONS`, each with the
  reason. **audit:check:** an `auditConfig.ignoreGhsas` entry in `pnpm-workspace.yaml` needs a comment with the reason
  and a review date. The image scan: `security/image-allowlist.json` entries need a reason and an expiry.

## Claude Code hooks and permissions

`.claude/settings.json` (committed) enforces in configuration what `AGENTS.md` asks for.

**Hook.** `PostToolUse` on `Edit|Write|MultiEdit` runs `scripts/format-edited-file.ts`: it reads the hook input on
stdin, formats the edited file with oxfmt and lints that one file with oxlint (without `--type-aware`; `pnpm check`
adds those rules). A problem goes back to Claude as `{"decision": "block", "reason": ...}`, which Claude Code adds
next to the tool result. Files the Oxc configs ignore (generated code, Markdown, `node_modules`) and files outside
the checkout are skipped. About 0.1 to 1 s per edit. Try it:
`echo '{"tool_input":{"file_path":"'"$PWD"'/src/lib/utils.ts"}}' | node scripts/format-edited-file.ts`.

**Deny rules.**

- Generated files: `Edit(/src/sdk/**)`, `Edit(/openapi.json)`, `Edit(/src/routeTree.gen.ts)`,
  `Edit(/drizzle/meta/**)`. An `Edit(...)` rule also covers Write. Committed migrations are protected by the
  `applied-migrations` guard and the pre-commit hook instead, because a new migration may still be adjusted
  before its first commit.
- Skipping the pre-commit hook: `git commit --no-verify` and `git commit -n` (as the first or a later option),
  `git -c core.hooksPath...`, `pnpm hooks:uninstall`.
- Linters and formatters this repo does not use, whose default scope includes `node_modules` and `repos/`:
  `eslint`, `prettier` and `biome`, directly, through `npx` or through `pnpm dlx`.
- Oxc runs without the ignore lists: any command with `--no-ignore` or `--ignore-path`, and oxlint or oxfmt with
  `-c` or `--config`.

Claude Code matches deny rules against every subcommand of a compound command (`&&`, `||`, `;`, `|`, newlines,
subshells, command substitution), past leading `VAR=value` assignments and past wrappers such as `timeout`. They
match the command text Claude writes, so they are a guard rail, not a security boundary
([permissions docs](https://code.claude.com/docs/en/permissions#what-a-bash-rule-doesn-t-match)). Not covered: a
program called by path (`node_modules/.bin/eslint`) or through `sh -c`, `git -C . commit --no-verify`, a
clustered `-an`, `pnpm exec eslint`, and other tools. A rule can also refuse a harmless command, such as
`rg --no-ignore` or a commit message containing ` -n`. CI runs every gate regardless.

**Allow rules** cover the everyday gates (`pnpm check*`, `pnpm test*`, `pnpm typecheck`, `pnpm lint*`,
`pnpm format*`, `pnpm codegen`, `pnpm db:generate *`) and `git status`, `git diff` and `git log`. Claude Code
applies project `allow` rules only after you accept the workspace trust dialog. Personal additions go in
`.claude/settings.local.json`.

## Lighthouse policy

`POLICY` in `scripts/lighthouse.ts`: per page and form factor, accessibility, best practices and SEO must score
100 on every run; performance needs a median of at least 99, at most one run below 100 and none below 95; the
median metrics must stay within the budgets. `agentic-browsing` is reported but not gated. SEO is not gated on
`/login` and `/dashboard` (noindex). Exit 2 means inconclusive, not failed: a run's `benchmarkIndex` was below
1000 or Lighthouse warned about a slow CPU (each run's value and warnings are in
`lighthouse-report/summary.json`). CI runs `pnpm lighthouse --runs=5`.

`pnpm build && pnpm lighthouse [--runs=3] [--page=<name>] [--form-factor=mobile|desktop] [--direct]
[--edge-protocol=h2|h1|http]` runs the gate on the built app behind the Caddy edge over HTTPS and HTTP/2, as in
production (needs Docker); see [ADR 0011](../decisions/0011-lighthouse-over-https-http2.md).

## Less common commands

| Command | Covers |
| --- | --- |
| `pnpm audit:check` | `pnpm audit --audit-level high` over production and development packages: fails on a high or critical advisory not in `auditConfig.ignoreGhsas` (`pnpm-workspace.yaml`). Needs the npm registry; CI job `supply-chain` |
| `pnpm sbom:release [--image=<ref>] [--no-image]` | CycloneDX SBOMs in `sbom/` for a release: production npm dependencies, and the production image with syft (Docker). Not a gate |
| `pnpm ci:local [job ...]` | The CI jobs (`workflows secrets static supply-chain drift build verify lighthouse docker`, default all) as `pnpm ci:<job>` scripts in the Playwright Ubuntu container next to Postgres and Mailpit, all five browser projects included. Needs Docker. See [docs/operations.md](../operations.md#ci-and-local-ci) |
| `harbor run -p evals/tasks -a <agent> -m <model>` | The agent eval ([evals.md](evals.md)): an agent solves each task in a container, graded by `pnpm check`, drift and hidden checks. Needs Docker and Harbor, and runs a paid agent; not a gate |
