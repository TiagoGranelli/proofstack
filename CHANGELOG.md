# Changelog

Notable changes to the template, newest first, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format. Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) as it applies to a template:
a minor version may change what adopters must do when they take it, and says so under "Upgrade notes". Each
release is a `vX.Y.Z` tag; [docs/adopting.md](docs/adopting.md#staying-current) explains how to take one into a
repository created from the template.

## [Unreleased]

The first version of the template.

### Added

- One Node service with server-rendered React (TanStack Start), an Effect HttpApi business API with its
  OpenAPI document and a generated Hey API client, Postgres through Drizzle, and Better Auth sessions with
  email and password, sign-up closed or open (`AUTH_SIGN_UP`), email verification, password reset, session
  management and account deletion.
- An example feature (posts) that exercises every layer, and the recipe to remove it
  ([docs/removing-the-example.md](docs/removing-the-example.md)).
- A `minimal` branch with only the gates, on a small client-side React app, for projects on another stack.
- `GET /api/me`, the signed-in user, which the security tests use as their subject.
- The app's name in two places, `package.json` and `src/config/app.ts`, with neutral internal identifiers
  and a test that keeps it so; renaming is a short manual step ([docs/adopting.md](docs/adopting.md#rename-the-app)).
- Quality gates: `pnpm check` (format, type-aware lint, typecheck, Effect diagnostics, dead code,
  complexity, duplication, security sinks, unit, api and component tests with coverage, drift, migration
  lint, licenses, route accessibility coverage, guards), `pnpm check:drift`, the `db`, integration and E2E
  layers (`pnpm test:db`, `pnpm test`, `pnpm test:e2e`, each starting its own servers on a throwaway
  database, and `pnpm verify:app` to run them all with contract coverage), the Lighthouse gate behind the Caddy
  edge, supply-chain checks, and a Docker smoke test that runs `deploy/compose.production.yaml` and scans the
  image with grype.
- `pnpm ci:local` to run the CI jobs in containers (`.github/compose.ci.yaml`) without GitHub.
- Agent support: `AGENTS.md` with nested files for the server, features and tests, project skills in
  `.agents/skills/`, Claude Code settings that format and lint each edited file, and agent evals in
  `.agents/evals/`.
- Production image, migrations as a bundled script, deploy recipes for one server with Docker Compose and
  Caddy, Fly.io and Kubernetes, and [docs/operations.md](docs/operations.md).
- Adopter guide ([docs/adopting.md](docs/adopting.md)), contributing guide, security policy, code of
  conduct, issue and pull request templates, Renovate, and a release workflow that publishes each tag's
  section of this file.
