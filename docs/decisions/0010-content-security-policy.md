# 0010: Content-Security-Policy without 'unsafe-inline'; Trusted Types deferred

Status: Accepted (2026-09-27)

## Context

The app renders HTML two ways: per request (SSR, including not-found and error pages) and once at build
time (`/about`, [ADR 0004](0004-prerender-via-nitro.md)). Both contain inline scripts that TanStack
Router emits for hydration. The previous setup created a nonce in a request middleware, passed it to the
Nitro plugin in a private response header, and allowed `'unsafe-inline'` for prerendered pages and for all
styles.

Trusted Types (`require-trusted-types-for 'script'`) would additionally stop DOM XSS through sinks such as
`innerHTML` and `script.src`, which matters with `'strict-dynamic'`, because that keyword trusts scripts
created by trusted scripts.

## Decision

1. **SSR:** the documented Start pattern (TanStack/router `e2e/react-start/csp`). `getRouter` creates a
   128-bit nonce per request with `createIsomorphicFn().server()` and passes it as `ssr.nonce`; the root
   route's `headers({ ssr })` sends `script-src 'self' 'nonce-…' 'strict-dynamic'` and
   `style-src 'self' 'nonce-…'`. Production only, because Vite's dev server injects CSS without the nonce.
2. **Prerendered pages:** Nitro's `prerender:generate` hook parses each page with parse5 8.0.1 (a
   WHATWG-conformant parser, pinned; a regex or a lenient parser could hash different text than the
   browser does), hashes every inline script and style with sha256, and writes the policy as a route rule
   header. An inline `style` or `on*` attribute fails the build. No `'strict-dynamic'` there: external
   scripts are allowed by `'self'`.
3. **Other responses** get `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
4. **Trusted Types: not enabled yet.** The evaluation ran the flows (home, about, login, sign-in,
   dashboard, publish, sign-out, the prerendered page, not-found) in Chromium and Firefox 155 with
   `require-trusted-types-for 'script'; trusted-types 'none'` in report-only mode: zero reports from the
   app, while a deliberate `innerHTML` write was reported in both engines. Enforcing it, however, made
   Playwright's Firefox intermittently never fire `load` on a document (5 of 6 runs of 24 navigations had
   1 to 3 timeouts); with the header in report-only mode 2 of 9 runs did, without it 0 of 8. Chromium was
   unaffected. A header that makes the E2E gate flaky cannot ship, and report-only without a reporting
   endpoint gives no signal in production.

## Evidence

- `tests/integration/csp.test.ts`: SSR pages (`/`, `/login`, `/dashboard`, a 404) carry a fresh nonce on
  every script and style tag, `/about` carries exactly the hashes of its inline scripts, non-documents get
  the locked-down policy, and no policy contains `'unsafe-inline'`, `'unsafe-eval'` or a host.
- `tests/integration/db-failure.test.ts`: the error page carries the nonce policy.
- `tests/e2e/fixtures.ts` fails every E2E test (all browser projects) on a `securitypolicyviolation`
  event; `tests/e2e/csp.spec.ts` proves the collector sees injected markup and navigates every route kind,
  which shows that module imports and route chunks load under `'strict-dynamic'`.

## Consequences

No inline event handlers or `style` attributes in server-rendered markup (the prerender build fails on
them; the SSR check in `csp.test.ts` too). CSS-in-JS that injects `<style>` without the nonce would be
blocked. SSR pages cannot be cached by shared caches (the nonce is per response); they already are
`private`.

Two inline pieces the UI needs follow the same rules. The theme script (`src/lib/theme.ts`) goes through the
root route's `head()`: SSR pages give it the nonce, and the prerender hook hashes it like any inline script
(`tests/e2e/appearance.spec.ts` runs it with the app's modules blocked on both kinds of page). Radix dialogs lock
page scroll with a `<style>` element they inject at runtime (react-remove-scroll-bar); `src/components/ui/alert-dialog.tsx`
hands it the page's nonce through `get-nonce`. A document that began as a prerendered page has no nonce, so if
the visitor navigates from it to the dashboard and opens a dialog, that one style is blocked and reported: the
dialog works, the page behind it can still scroll. Revisit if a second runtime style appears, or by loading
pages reached from a prerendered one as documents of their own.

## Revisit when

- Trusted Types: when a Playwright Firefox release no longer stalls `load` with the directive (rerun the
  `csp.spec.ts` suite with `--repeat-each 8` on Firefox), or when the app gets a CSP reporting endpoint.
  To enable, add `require-trusted-types-for 'script'` and `trusted-types 'none'` to `documentHeaders` in
  `src/lib/content-security-policy.ts` and an E2E test that a plain-string `innerHTML` write throws.
- TanStack Router renders the `csp-nonce` meta tag with a `nonce` attribute (Vite's convention); then
  Vite's dev CSS injection gets the nonce and the policy can apply in dev too.
