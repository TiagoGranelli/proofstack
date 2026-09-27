# ProofStack

> Working name for an open-source, full-stack web application template.

ProofStack aims to make AI-assisted development easier to trust. Its central promise is a **verifiable API contract**: the published OpenAPI specification, generated client, running API, and integration tests must agree. Quality gates should give maintainers concrete evidence when Claude, Codex, or another agent changes the application.

The first vertical slice runs end to end: a public page rendered on the server, PostgreSQL, sign-in with sessions, the Effect API with its OpenAPI contract, the generated Hey API SDK, and authenticated operations. Several dependencies are release candidates or betas; see [docs/stack-review.md](docs/stack-review.md) for the evidence and risks.

## Foundation

- One Node service and one origin, with a public page and a functional authenticated flow.
- TanStack Start for React rendering, routing, and server integration; Vite 8 and Nitro 3 beta for build and deployment.
- TypeScript 7, React Compiler, TanStack Query, Tailwind CSS 4, and shadcn/ui with Radix.
- Effect 4 for the business API and its OpenAPI contract; Hey API for the generated client. Every business operation goes through this API, including server-side rendering.
- PostgreSQL with Drizzle for persistence; Better Auth with email and password for sessions.
- Oxlint, Oxfmt, Fallow, shadcn lint, tests, and Lighthouse in CI.

The example application publishes short posts publicly and lets an authenticated author create, edit, and delete them. This exercises rendering, the database, sessions, API validation, client generation, and end-to-end behavior in one project.

## Quick start

Requirements: Node 26 (see `.node-version`), pnpm 12 (`npm install -g pnpm@12.3.4`; Node 26 no longer ships Corepack), and Docker for the local database.

```sh
pnpm install
pnpm bootstrap                      # creates .env with a secret, starts Postgres, applies migrations
pnpm user:create you@example.com "Your Name"   # prompts for the password without echo
pnpm dev                            # http://localhost:3000
```

Public sign-up is closed; accounts are created with `pnpm user:create`. Before handing off a change, run `pnpm check`. Contract, database, auth, and UI changes also need `pnpm check:drift` and `pnpm build && pnpm verify:app` (install the test browser once with `pnpm exec playwright install chromium`).

- [AGENTS.md](AGENTS.md): architecture, workflows, and rules for coding agents and humans.
- [docs/operations.md](docs/operations.md): configuration, deployment, and security notes.
- [docs/decisions/](docs/decisions/README.md): architecture decisions.

## What “proof” means here

- CI checks that the generated SDK matches the served OpenAPI contract and uses it against the running application and a freshly migrated database.
- Schema and migration checks catch drift in the database and authentication tables.
- The public example targets 100 in all four Lighthouse categories on mobile and desktop. The authenticated route is measured where each category applies. CI checks metrics and stability while allowing an isolated 99 caused by measurement variance.
- Dependency sources and official agent skills are pinned with provenance when they are useful for maintaining the stack.

These checks reduce the chance of unnoticed mistakes; they cannot guarantee that generated code is correct. The thresholds live next to the scripts that enforce them (`scripts/lighthouse.ts`, `scripts/check-drift.ts`).

## License

MIT. See [LICENSE](LICENSE).
