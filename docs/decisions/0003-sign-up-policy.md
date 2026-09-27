# 0003: Configurable sign-up, closed by default, with the full account lifecycle in both modes

Status: Accepted (2026-09-27, owner decision). Replaces the first version of this ADR (closed sign-up only,
2026-09-26), which was decided on the owner's behalf.

## Context

The example app has one role: an author who manages posts. A template deployed as-is should not invite
spam accounts, but a real product built on it usually needs self-service accounts. Either way, people
forget passwords, change them, lose devices and leave, so the account lifecycle is needed whichever way
accounts are created.

## Decision

- `AUTH_SIGN_UP` chooses the policy: `closed` (the default) or `open`. Anything else stops the server at
  startup.
  - `closed`: accounts come from `pnpm user:create <email> <name>` (password from stdin or
    `PROOFSTACK_USER_PASSWORD`, never argv). The script writes through Better Auth's internal adapter
    (`createUser` and `linkAccount` with Better Auth's password hash) and marks the address verified,
    because the operator vouches for it; no confirmation mail is sent. Over HTTP, `/sign-up/email` is in
    `disabledPaths` (404 before rate limiting) and outside the endpoint allowlist; the `/sign-up` page answers
    404 and no page links to it. A repo guard in `pnpm check` keeps
    `disabledPaths: env.authSignUp === 'open' ? [] : ['/sign-up/email']`.
  - `open`: anyone can create an account at `/sign-up`. The server refuses to start without `SMTP_URL`
    and `MAIL_FROM`, because every new account must verify its address.
- In both modes, `requireEmailVerification` is on: no session before the address is verified. A sign-in
  with the right password but an unverified address sends a fresh link. Sign-up answers the same for new
  and existing addresses (no enumeration); the owner of an existing address gets a heads-up mail instead.
- The lifecycle is the same in both modes: email verification, forgotten password (the link works once, for
  an hour, and the reset ends every session), change password (always ending the other sessions), the
  session list with per-session revoke, sign-out of the other sessions and everywhere, and account
  deletion behind the password and an explicit confirmation (posts go with the account).
- Mail links point at the app's own pages (`/verify-email`, `/reset-password`), which call Better Auth.
  Senders only schedule delivery through `advanced.backgroundTasks`, so response times do not reveal
  whether an account exists; shutdown drains pending sends.
- The UI calls these endpoints through server functions (`src/lib/auth.functions.ts`) that dispatch into
  Better Auth's router in-process, so the endpoint allowlist, the rate limits and the origin check apply to
  them exactly as to `/api/auth/*`. The browser bundle has no Better Auth client.

## Evidence

- `tests/integration/auth-sign-up.test.ts`: with `closed`, `POST /api/auth/sign-up/email` and `/sign-up`
  answer 404 and `/login` has no sign-up link; with `open`, an unverified account gets 403
  `EMAIL_NOT_VERIFIED`, and an existing address gets the same answer as a new one.
- `tests/e2e/auth-lifecycle.spec.ts` (links read from Mailpit) and `tests/e2e/auth-closed.spec.ts`.
- `pnpm verify:app` runs a server in each mode on one database. `scripts/app-server.ts` creates the two test
  authors with `scripts/create-user.ts`, the same path as `pnpm user:create`.

## Consequences

- Mail is part of the deployment. Without `SMTP_URL`, mail is only logged (`closed` only), so users
  cannot reset passwords; in production the log holds the subject but never the link.
- `open` needs abuse handling beyond verification and per-IP rate limits (3 sign-ups per 10 s) if the app
  attracts spam: CAPTCHA, invitations or a domain allowlist (`user.validateUserInfo`).
- `minPasswordLength` is 12, `maxPasswordLength` 128 (`src/contract/limits.ts`, shared with the forms).

## Revisit when

The app needs invitations, roles, OAuth providers, or email changes (`changeEmail`, not enabled).
