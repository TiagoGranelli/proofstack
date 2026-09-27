# Changelog

Notable changes to the template, newest first, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format. Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) as it applies to a template:
a minor version may change what adopters must do when they take it, and says so under "Upgrade notes". Each
release is a `vX.Y.Z` tag; [docs/adopting.md](docs/adopting.md#staying-current) explains how to take one into a
repository created from the template.

## [Unreleased]

## [0.1.0] - 2026-09-27

The first release.

### Added

- One Node service with server-rendered React (TanStack Start), an Effect HttpApi business API with its
  OpenAPI document and a generated Hey API client, Postgres through Drizzle, and Better Auth sessions with
  email and password, sign-up closed or open (`AUTH_SIGN_UP`), email verification, password reset, session
  management and account deletion.
- An example feature (posts) that exercises every layer on `main`, and a `minimal` branch without it
  ([docs/minimal-branch.md](docs/minimal-branch.md)).
- `GET /api/me`, the signed-in user, which the security tests use as their subject.
- The app's name in two places, `package.json` and `src/config/app.ts`, with neutral internal identifiers
  and a test that keeps it so; renaming is a short manual step ([docs/adopting.md](docs/adopting.md#rename-the-app)).
- Quality gates: `pnpm check` (format, type-aware lint, typecheck, Effect diagnostics, dead code,
  complexity, duplication, security sinks, unit, api and component tests with coverage, drift, migration
  lint, licenses, route accessibility coverage, guards), `pnpm check:drift`, `pnpm verify:app`
  (integration and E2E on five browser projects, contract coverage), the Lighthouse gate, supply-chain
  checks, a Docker smoke test, and `pnpm ci:local` to run CI without GitHub.
- Production image, migrations as a bundled script, a Caddy edge configuration, and
  [docs/operations.md](docs/operations.md).
- Adopter guide ([docs/adopting.md](docs/adopting.md)), contributing guide, security policy, code of
  conduct, issue and pull request templates, and a release workflow that publishes each tag's section of
  this file.

### Upgrade notes

Nothing to upgrade from. Start with [docs/adopting.md](docs/adopting.md#day-1).
