# The `minimal` branch

`main` is a full-stack template: server-rendered React on TanStack Start, an Effect HTTP API with a generated client,
Postgres, accounts, a deploy path, and the quality gates around all of it. Most people who want the gates already
have a stack, and taking them from `main` means separating them from code they don't use.

`minimal` is that separation. It keeps the gates that work on any React 19 and TypeScript project, and a demo app
small enough to read in a few minutes (a word counter with two routes) so that every gate has something to run on.
The [README](../README.md) says which files, dependencies and scripts make up each gate.

## What it keeps and what it drops

It keeps Oxlint and Oxfmt with `main`'s rules, TypeScript, Fallow (dead code, boundaries, complexity, duplication,
security sinks), Vitest with component tests in Chromium and a coverage gate, Playwright with axe, landmark and
tab-order checks, the route coverage check, the Lighthouse gate, lefthook and `pnpm check`, the pnpm supply-chain
settings, Renovate, the Claude Code settings and edit hook, the CI jobs and their local runner (`pnpm ci:local`), and
the secret scan.

It drops everything that serves the full stack: TanStack Start and server rendering, the API contract and its
generated client, the database and its migrations, accounts, the server, the Docker image and deploy recipes, the
server-side test layers and the checks that go with them (contract drift, contract coverage, query budgets, migration
lint, the license check), the agent evals, and the skills about those parts. The demo is a client-side app on
TanStack Router; its build is static files, so the branch has no production Dockerfile. Any static host serves
`dist/`.

## How it relates to `main`

The two branches share history up to the commit `minimal` started from, and they are never merged: a merge from
`main` would bring its app code back into `minimal`, as new files and as conflicts with the files this branch
removed.

Gate and configuration changes are made on `main` first. Maintainers then port them to `minimal` by hand, by reading
the change and applying the parts that still apply here. `git diff main minimal -- .oxlintrc.json` (or any other
gate file) shows where the branches differ. Features of the full-stack app do not come to `minimal`.
