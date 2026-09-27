# 0014: The login form works before hydration and without JavaScript

Status: Accepted (2026-09-27)

## Context

Every account form kept its button disabled until hydration, because a native submit would post the fields,
passwords included, to the page itself. On a slow device the login page is visible and useless for as long as
the scripts take, and without JavaScript it never works. TanStack Start server functions accept `FormData`
(urlencoded or multipart) on POST and expose their path as `.url`, so a form can post to one directly.

## Decision

- The login form's `action` is `signInFromForm.url` (`src/lib/auth.functions.ts`), a server function that takes
  the form's own `FormData` (`SignInFormPost` in `src/lib/account-input.ts`: the same email and password
  checks as the script's `SignInInput`, plus the hidden `redirect`). Its button is enabled from the first paint;
  before hydration the browser's own validation (`required`, `type="email"`) runs, after it the schema's.
- It signs in through `callAuthEndpoint` like `signIn` and answers `303` to `/login`, with the session cookie on
  it: `?redirect=<target>` on success, where the existing guard sends the signed-in visitor on to the validated
  target; `?error=<code>` (and `retryAfter`) on failure, which `/login` shows with `describeAuthFailure` after
  checking the code is one of ours (`failureFromSearch`).
- Once hydrated, the script still calls `signIn` and handles the answer in place. A separate server function,
  because Start types a POST validator's input as `FormData` or as serializable data, not both.
- The other account forms keep waiting for hydration.

## Evidence

- `tests/e2e/login-without-js.spec.ts`, with `javaScriptEnabled: false` on Chromium and Firefox: from
  `/dashboard` to `/login`, sign in, land on the dashboard; a wrong password comes back as the same alert,
  describing the form.
- `tests/integration/login-form-post.test.ts`: a urlencoded post from the app's origin answers 303 with the
  session cookie and `/login` then redirects to the target; a wrong password answers 303 with
  `error=INVALID_EMAIL_OR_PASSWORD` and no cookie; the same post from another origin answers 403 from the CSRF
  middleware in `src/start.ts` (`Sec-Fetch-Site`/`Origin`), before Better Auth runs.
- `tests/component/auth.test.tsx`: the server-rendered form posts to `signInFromForm` with `email`, `password`
  and `redirect`, validates natively until hydration, and shows a failure from the URL until the next attempt.

## Consequences

- Two hops after a form post (the 303 to `/login`, then its guard's redirect), and one server function more.
- The email is not kept after a failed post: putting it in the URL would put it in history and logs.
- The action's path holds the build's server function id: a page left open across a deploy and submitted
  without JavaScript gets Start's answer for an unknown id (ADR 0009) instead of a sign-in.
- The same pattern would work for sign-up and the password forms; adopt it there when one of them needs it.

## Revisit when

Start types server functions that take both FormData and JSON, or ships a form-action helper that answers
redirects for native posts itself.
