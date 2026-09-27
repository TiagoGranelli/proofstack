# 0003: Closed public sign-up, with accounts created from the CLI

Status: Accepted (2026-09-26). The owner was not consulted; confirm or reverse.

## Context

The example app has one role: an author who manages posts. Open sign-up on a template deployed as-is
invites spam accounts and would need email verification, rate-limit tuning, and abuse handling that the
example does not need.

## Decision

- Better Auth email and password auth, with `disabledPaths: ['/sign-up/email']`. The HTTP route returns
  404.
- On top of that, `src/server/http/auth-handler.ts` exposes only `POST /api/auth/sign-in/email`,
  `POST /api/auth/sign-out`, and `GET /api/auth/get-session` over HTTP. Every other Better Auth endpoint
  returns 404. A repo guard in `pnpm check` (`scripts/check.ts`) fails if `disabledPaths` in
  `src/server/auth.ts` loses `'/sign-up/email'`, so sign-up stays closed even if the allowlist changes.
- Accounts are created with `pnpm user:create <email> <name>`. The password comes from stdin or
  `PROOFSTACK_USER_PASSWORD`, never from argv. The script calls `auth.api.signUpEmail` in-process, which
  `disabledPaths` does not block.
- `signUpEmail` reports success for an existing email (protection against account enumeration), so the
  CLI checks for the email first and fails loudly.

## Evidence

`tests/integration/api.test.ts` ("keeps public sign-up closed") expects 404, and
`tests/integration/security.test.ts` expects 404 from endpoints outside the allowlist.
`scripts/app-server.ts`, which `pnpm verify:app` and `pnpm lighthouse` use to start the app, creates
both test users by running `scripts/create-user.ts`, the same path as `pnpm user:create`.

## Consequences

No self-service registration and no email flows. Adding either means reopening the path, adding email
verification, and revisiting rate limits. `minPasswordLength` is 12, and rate limiting is on in
production.

## Revisit when

The example needs self-service accounts, invitations, or OAuth providers.
