# Changelog

Notable changes to the template, newest first, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format. Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) as it applies to a template:
a minor version may change what adopters must do when they take it, and says so under "Upgrade notes". Each
release is a `vX.Y.Z` tag; [docs/adopting.md](docs/adopting.md#staying-current) explains how to take one into a
repository created from the template.

## [Unreleased]

### Changed

- Renamed from ProofStack to Slopproof: `name` in `package.json` is `slopproof`, `APP_NAME` is "Slopproof", and
  the repository is `TiagoGranelli/slopproof`. The Docker image and the `pnpm ci:docker` names follow the package
  name. Older entries below keep the old name.
- `pnpm test` and `pnpm test:e2e` start the built app themselves (their global setups, through
  `startTestServers` in `scripts/app-server.ts`), so they run directly, from `playwright test --ui` and from the
  editor extensions. `pnpm verify:app` runs the layers one after another and prints a summary; the drain check
  is `tests/integration/shutdown.test.ts`.
- `pnpm ci:docker` runs `deploy/compose.production.yaml` itself, with `deploy/compose.smoke.yaml` on top, and
  scans the image with `grype --only-fixed --fail-on high`.
- `pnpm ci:local` runs its container jobs in `.github/compose.ci.yaml`.
- `CONTRIBUTING.md`, `SECURITY.md` and `CODE_OF_CONDUCT.md` live in `.github/`, where GitHub finds them first.
- The Renovate configuration is `.github/renovate.json`, one of the locations Renovate searches.
- The lefthook, gitleaks, grype and squawk configurations live in `.config/` (`lefthook.yml`, `gitleaks.toml`,
  `gitleaksignore`, `grype.yaml`, `squawk.toml`). lefthook finds `.config/lefthook.yml` by itself; the scripts
  pass the others by flag.
- Upstream reading snapshots go in `.repos/` (was `repos/`); every tool's ignore list names the new path.
- The agent evals live in `.agents/evals/` (was `evals/`): `docker build -f .agents/evals/Dockerfile -t app-eval .`
  and `harbor run -p .agents/evals/tasks ...`.

### Fixed

- A form whose schema cannot be loaded (a lost chunk request) says so in an alert instead of doing nothing.

### Upgrade notes

- Point your template remote at the new name:
  `git remote set-url template https://github.com/TiagoGranelli/slopproof.git`. Your app's own name in
  `package.json` and `src/config/app.ts` does not change.
- `verify:app` takes no arguments: instead of a filter or `--no-db`, `--no-integration`, `--no-e2e`, run that
  runner (`pnpm test:db`, `pnpm test`, `pnpm test:e2e`, each with a filter). `--edge` is `TEST_EDGE=1`.
  `VERIFY_PORT` and `TEST_DATABASE_URL` are gone: every run uses free ports and its own database.
- Image scan exceptions move from `security/image-allowlist.json` to `ignore` rules in `.config/grype.yaml`, with
  the reason and a review date in `reason`; nothing enforces the date any more.
- Move your copies of `lefthook.yml`, `.gitleaks.toml`, `.gitleaksignore`, `.grype.yaml` and `.squawk.toml` into
  `.config/` under the names above, and `renovate.json` into `.github/`. A personal `lefthook-local.yml` stays at
  the root.
- Move any snapshot you fetched into `repos/` to `.repos/` (`mv repos/* .repos/ && rm -r repos`). Once
  `repos/.gitignore` is gone, git and the linters would see what is left in `repos/`.

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
