# ProofStack

> Working name for an open-source, full-stack web application template.

When coding agents write much of an app, the hard part is knowing whether a change is right. ProofStack is a
template for a web app that answers that with checks instead of review alone. Its central promise is a
**verifiable API contract**: the published OpenAPI specification, generated client, running API, and
integration tests must agree, and the quality gates give maintainers concrete evidence when Claude, Codex, or
another agent changes the application.

The first vertical slice runs end to end: a public page rendered on the server, PostgreSQL, sign-in with sessions, the Effect API with its OpenAPI contract, the generated Hey API SDK, and authenticated operations.

Status: 0.1.0. The stack is pre-release in places: Effect 4 is a release candidate,
Nitro 3 a beta, Hey API a `next` snapshot, TanStack Start still calls itself a release candidate, and the
project runs on TypeScript 7 and Node 26. Each upgrade is gated, but expect some to need work. See
[docs/stack-review.md](docs/stack-review.md) for the evidence and risks, and [CHANGELOG.md](CHANGELOG.md) for
releases.

## Foundation

- One Node service and one origin, with a public page and a functional authenticated flow.
- TanStack Start for React rendering, routing, and server integration; Vite 8 and Nitro 3 beta for build and deployment.
- TypeScript 7, React Compiler, TanStack Query, Tailwind CSS 4, and shadcn/ui with Radix.
- Effect 4 for the business API and its OpenAPI contract; Hey API for the generated client. Every business operation goes through this API, including server-side rendering.
- PostgreSQL with Drizzle for persistence; Better Auth with email and password for sessions.
- Oxlint, Oxfmt, Fallow, shadcn lint, tests, and Lighthouse in CI.

The example application publishes short posts publicly and lets an authenticated author create, edit, and delete them. This exercises rendering, the database, sessions, API validation, client generation, and end-to-end behavior in one project. The `minimal` branch is the same template without it (see [docs/adopting.md](docs/adopting.md)).

## Quick start

Requirements: pnpm 12 and Docker (for the local database). `pnpm install` downloads the Node version in `package.json#devEngines` and runs every script with it.

```sh
pnpm install
pnpm bootstrap                      # creates .env with a secret, starts Postgres and Mailpit, applies migrations
pnpm user:create you@example.com "Your Name"   # prompts for the password without echo
pnpm dev                            # http://localhost:3000
```

Public sign-up is closed by default: accounts are created with `pnpm user:create`, and `AUTH_SIGN_UP=open` in `.env` opens `/sign-up` with email verification ([ADR 0003](docs/decisions/0003-sign-up-policy.md)). Account email (confirmation links, password resets) goes to Mailpit, which `pnpm bootstrap` starts (`pnpm mail:up` restarts it): read it at http://localhost:54380 (`MAILPIT_HTTP_PORT`). Before handing off a change, run `pnpm check`. Contract, database, auth, and UI changes also need `pnpm check:drift` and `pnpm build && pnpm verify:app` (needs Mailpit, `pnpm mail:up`; install the test browsers once with `pnpm exec playwright install chromium firefox`).

Starting your own app from the template (rename it, remove the example, deploy, take template updates):
[docs/adopting.md](docs/adopting.md).

- [AGENTS.md](AGENTS.md): architecture, workflows, and rules for coding agents and humans.
- [docs/operations.md](docs/operations.md): configuration, deployment, and security notes.
- [docs/decisions/](docs/decisions/README.md): architecture decisions.

## What “proof” means here

- CI checks that the generated SDK matches the served OpenAPI contract and uses it against the running application and a freshly migrated database.
- Schema and migration checks catch drift in the database and authentication tables.
- The public example targets 100 in all four Lighthouse categories on mobile and desktop. The authenticated route is measured where each category applies. CI checks metrics and stability while allowing an isolated 99 caused by measurement variance.
- Dependency sources and official agent skills are pinned with provenance when they are useful for maintaining the stack.

These checks reduce the chance of unnoticed mistakes; they cannot guarantee that generated code is correct. The thresholds live next to the scripts that enforce them (`scripts/lighthouse-policy.ts`, `scripts/check-drift.ts`).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) for reporting vulnerabilities, and the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT. See [LICENSE](LICENSE).
