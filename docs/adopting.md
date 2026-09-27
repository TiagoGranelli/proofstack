# Adopting ProofStack

How to start a product from this template, keep it building on the template's gates, and take template
updates later. [AGENTS.md](../AGENTS.md) is the reference for working in the code; this page is the path
from "Use this template" to your own app.

## Is this for you

ProofStack fits when:

- You want one Node service on one origin: server-rendered React, a typed business API, Postgres and
  cookie sessions, deployed as a container.
- You work with coding agents and want the repository to catch their mistakes: a contract that the
  OpenAPI document, the generated client, the running API and the tests must all agree with, and gates
  that fail with instructions instead of warnings.
- You accept the cost of those gates: `pnpm check` on every commit, `pnpm verify:app` for contract,
  database, auth and UI changes, Lighthouse at 100, and every exception written down next to its reason.

It fits less well when:

- You need production-stable dependencies today. Effect 4 is a release candidate, Nitro 3 a beta, Hey API
  a `next` snapshot, TanStack Start calls itself a release candidate, and the stack runs on TypeScript 7
  and Node 26. [stack-review.md](stack-review.md) has the evidence and the risks; each upgrade is gated
  but may need work.
- You want a public API for third parties with its own versioning, a mobile client with token auth, or
  several services. The contract here is for the app's own UI.
- You want a scaffold to fill in quickly. The template trades speed of the first week for fewer
  surprises later.

## Day 1

1. Choose how to start. The template has two branches:
   - `main`: the foundation plus an example feature (posts: a public list, authoring, pagination) that shows
     every layer working together. Useful while you learn the structure.
   - `minimal`: the same foundation without the example, with a plain home page and a dashboard that reads
     `GET /api/me`. CI runs `pnpm check` and `pnpm verify:app` on it like on `main`.

   On GitHub, choose **Use this template** and tick **Include all branches** to get both, then make the one
   you want your default branch. Without GitHub, copy one branch with
   `npx giget gh:<org>/<repo>#minimal <dir>` (or `#main`).
2. Install and start what the app needs (Node 26, pnpm 12 and Docker, see the README):

   ```sh
   pnpm install
   pnpm bootstrap          # .env with a secret, Postgres and Mailpit in Docker, migrations
   ```

3. Rename the app (below).
4. Put your team in `.github/CODEOWNERS` and turn on branch protection for your default branch with the CI
   checks required. Code-owner review is what keeps the gate files from being loosened unnoticed.
5. Run everything once, then commit:

   ```sh
   pnpm check
   pnpm check:drift
   pnpm build && pnpm verify:app   # needs Mailpit: pnpm mail:up
   ```

### Rename the app

The name lives in two places; every internal identifier (database names, env vars, service tags, Docker
names) is neutral, so nothing else carries it.

1. `package.json`: `name`, your package and Docker name (lower case, such as `acme-notes`).
2. `src/config/app.ts`: `APP_NAME`, the name people see in page titles, the header, the API title, account
   mail and Better Auth.
3. Run `pnpm codegen`, which puts the new name in the API title of `openapi.json`.
4. Rewrite `README.md` for your app. Keep the LICENSE notice (MIT asks you to), adding your own line if you
   like, and drop or rewrite the template's CHANGELOG, `docs/decisions/` and community files as you see fit.
5. Confirm:

   ```sh
   git grep -n -i proofstack
   ```

   What is left should be prose about the template. `tests/unit/app-name.test.ts`, part of `pnpm check`,
   fails if the name shows up in code or configuration outside those two files.

`COMPOSE_PROJECT_NAME` and the ports in `.env` are neutral too (`app`); if another project on this machine
uses the same, change them there.

## Your first feature

The feature workflow in [AGENTS.md](../AGENTS.md) walks through the layers in order. In short:

1. Table in `src/server/db/schema/`, then `pnpm db:generate --name <slug>` and `pnpm db:migrate`.
2. Endpoints, schemas and tagged errors in `src/contract/`, added to `Api` in `src/contract/api.ts`.
   Private endpoints go in a group with the `Authentication` middleware; the `openapi-security` guard fails
   on an operation without it unless you list it in `PUBLIC_OPERATIONS` (`scripts/check.ts`).
3. A repository under `src/server/<feature>/` and handlers in `src/server/api/handlers.ts`, provided in
   `src/server/api/web-handler.ts` and in the api test harness (`tests/api/harness.ts`).
4. `pnpm codegen`, then a message for each new error tag in `src/lib/api-error.ts` (typecheck fails until
   there is one).
5. UI in `src/features/<name>/`, pages in `src/routes/`.
6. Tests from the cheapest layer up, an axe state, a landmark snapshot and a tab-order row for each new
   page (the `routes` gate checks), and a query budget for each repository method.

On the `minimal` branch, the posts code on `main` is the most complete reference for each layer
(`git show template/main:src/server/posts/repo.ts` with the `template` remote below).
[minimal-branch.md](minimal-branch.md) lists what `minimal` removes, which is also what you remove if you
started from `main` and drop the example later. Two things come back with your first write endpoint:

- Give it the shared middleware: `RequestValidation` for input and `WriteRateLimit` for a per-user budget.
  Their errors are already handled in `src/lib/api-error.ts`.
- `pnpm verify:app` then reports that the endpoint answered `403`, which the contract does not declare:
  that is the CSRF check in `src/start.ts`, which refuses cross-origin writes before the API runs. Put this
  entry back in the `undeclared` list of `tests/contract-coverage-allowlist.json`:

  ```json
  {
    "operation": "*",
    "status": 403,
    "reason": "The CSRF check of src/start.ts refuses a POST, PATCH or DELETE from another origin before the API runs, with a plain-text body and no tagged error. It applies to every write alike, so the API description in src/contract/api.ts states it once instead of every operation declaring it."
  }
  ```

## Tuning the gates

Every gate can be changed; the rule is that a change is a visible edit with its reason, in a file
`.github/CODEOWNERS` routes to review. AGENTS.md lists each gate and its escape hatch. The ones adopters
change most:

- Coverage: `COVERAGE_FLOOR` and `COVERAGE_GATE` in `vitest.config.ts`. Raise the floor as coverage grows;
  add modules that must stay fully covered to the gate.
- Lighthouse: `PAGES` and `POLICY` in `scripts/lighthouse.ts`. Add your pages; loosen the policy for a
  page with a reason, not globally.
- Complexity and duplication: per-function overrides in `.fallowrc.json` (`health.thresholdOverrides`,
  `duplicates.ignoredClones`), never a higher global ceiling.
- Browsers: `PW_PROJECTS` chooses the Playwright projects locally; CI runs all five.
- Allowlists with expiry (`security/*-allowlist.json`) and license exceptions (`scripts/licenses.ts`).

If a gate costs more than it catches for your product, remove it in its own commit that says why. The
pre-commit hook runs `pnpm check`; `pnpm hooks:uninstall` turns it off locally, and CI still runs it.

## Deploying

The app is one container: the image built by the `Dockerfile` serves the app, and the same image runs the
migrations (`node .output/migrate.mjs`) once per deploy, before the new version takes traffic. It needs
Postgres, an SMTP server for account mail, and a reverse proxy that terminates TLS and sets
`X-Forwarded-For`. [operations.md](operations.md) covers each part: the environment variables, the deploy
sequence, migration safety, the reverse proxy and client IPs, health checks, shutdown, logs and the
security settings. `deploy/` holds three recipes that put it together:
[one server with Docker Compose](operations.md#deploy-on-one-server-with-docker-compose)
(`compose.production.yaml`, `Caddyfile`, `postgres-init.sh` and `deploy.env.example`: Postgres, the migrations,
the app and Caddy with automatic HTTPS), [Fly.io](operations.md#deploy-on-flyio) (`fly.toml`) and
[Kubernetes](operations.md#deploy-on-kubernetes) (`kubernetes.yaml`). Each names the image and the app as
`app` or `your-app`; replace those with your own.

Before the first deploy, decide:

- How the first account is created: with `AUTH_SIGN_UP=closed` (the default), run the image's bundled
  command with the app's environment, `node .output/create-user.mjs <email> <name>` (the password from
  `CREATE_USER_PASSWORD` or a hidden prompt; [operations.md](operations.md#first-account) shows it for plain
  Docker and each recipe). `open` lets people sign up with email verification
  ([ADR 0003](decisions/0003-sign-up-policy.md)).
- Where backups come from. The app keeps all state in Postgres; back it up the way your provider does, and
  test a restore.
- `APP_URL`: the exact public origin. SSR, cookies and the CSRF check depend on it.

## Staying current

The template is released with tags (`vX.Y.Z`) and a [CHANGELOG](../CHANGELOG.md) whose entries end with
upgrade notes: what to run and what to check when you take the change. A repository created from a GitHub
template has no shared history with it, so take updates as patches:

```sh
git remote add template https://github.com/<owner>/proofstack.git
git fetch template --tags
git log --oneline v0.1.0..v0.2.0            # what changed between two releases (tags from the template)
git cherry-pick <commit>                    # one change
git diff v0.1.0 v0.2.0 -- scripts/ | git apply -3   # or a whole area, with three-way merge
```

Some adopters merge instead: `git merge --allow-unrelated-histories template/minimal` (or `template/main`)
once, then plain merges of the same branch later. That keeps the history connected but brings every
template change at once. Either way:

- Take updates from the branch you started from (`template/minimal` or `template/main`), so the example does
  not come back. The name is only in `package.json` and `src/config/app.ts`: keep yours when those conflict.
- Read the upgrade notes of every version you skip, in order.
- After taking a change, run the full set: `pnpm check`, `pnpm check:drift`, `pnpm build && pnpm verify:app`.

## Growing into a SaaS

The template ships the account lifecycle and nothing more on purpose. What most products add next, and
where it goes:

- Organizations, roles and OAuth. Better Auth has plugins for each (`organization`, `admin`, access
  control, social providers). The cost is the endpoint allowlist: every Better Auth endpoint a plugin adds
  is closed until you add it to `EXPOSED` in `src/server/http/auth-endpoints.ts` (and to `HTTP_ENDPOINTS`
  only if a browser must call it directly, as an OAuth callback must), with a server function in
  `src/lib/auth.functions.ts`, its error codes in `describe-auth-failure.ts`, and its tables in
  `src/server/db/schema/auth.ts` (`pnpm auth:check` says what is missing). Authorization for your own data
  stays in the Effect middleware: add the organization or role to `CurrentUser` and check it in handlers.
- Durable background jobs. `runInBackground` (`src/server/background-tasks.ts`) is for work that may be lost
  on a restart, such as sending a mail. For work that must survive one, use a Postgres-backed queue such as
  [pg-boss](https://github.com/timgit/pg-boss) or [graphile-worker](https://github.com/graphile/worker):
  no new infrastructure, jobs enqueued in the same transaction as the data. Run the worker in the same image
  as a second process, and stop it through `onShutdown` (`src/server/lifecycle.ts`) before the pool closes.
- File uploads. Requests over 64 KiB are refused (`src/start.ts`), so files never pass through the app. Add
  an endpoint that returns a presigned upload URL for S3 or a compatible store, upload from the browser
  directly, and add the bucket's origin to `connect-src` (and `img-src` if you show the files) in
  `src/lib/content-security-policy.ts`.
- Tracing. Effect ships OpenTelemetry support; provide an OTLP exporter layer in
  `src/server/api/web-handler.ts` and add the trace id to the fields `src/server/log.ts` writes, so a log
  line leads to its trace.
- Email. Account messages are built in `src/server/mail/auth-messages.ts` and sent through `authMail`; put
  your product's messages next to them and send them through the same mailer, so tests and Mailpit see them.
- Analytics. The Content-Security-Policy allows no inline script and no third-party origin. Load a script
  from your own origin through the root route's `head()`, which gives it the nonce, and add the
  collector's origin to `connect-src`. Prefer a server-side or first-party collector; the Lighthouse gate
  measures what a third-party tag costs.

## Trust: reproduce every claim

Nothing in the README asks you to take it on trust. Each claim has a command:

| Claim | How to check it |
| --- | --- |
| The OpenAPI document, the SDK and the served API agree | `pnpm check:drift contract`; `tests/integration/api.test.ts` compares the served document with `openapi.json` |
| Every declared status is exercised by some test | the contract-coverage step at the end of a full `pnpm verify:app` |
| Migrations produce exactly the schema | `pnpm check:drift migrations database` |
| The auth tables hold what Better Auth writes | `pnpm check:drift auth` |
| Security behavior (CSRF, headers, sessions, rate limits, database failures) | `pnpm verify:app` (`tests/integration/`, `tests/e2e/csp.spec.ts`) |
| Accessibility of every page and state | `pnpm verify:app` (axe, landmarks and tab order in `tests/e2e/`) and the `routes` gate of `pnpm check` |
| Lighthouse 100 | `pnpm build && pnpm lighthouse` |
| The app's name lives in two files | `pnpm test:unit app-name` |
| The branch without the example works | CI on the `minimal` branch (`pnpm check`, `pnpm verify:app`) |
| All of CI without GitHub | `pnpm ci:local` |

If a claim and its check disagree, the check is the source of truth; please open an issue.
