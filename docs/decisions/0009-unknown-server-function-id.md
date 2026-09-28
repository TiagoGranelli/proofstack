# 0009: An unknown server function id gets Start's own answer until it becomes a 404

Status: Accepted (2026-09-27)

## Context

Server function ids are minted per build. After a deploy, open tabs and crawlers keep calling ids that the
new build does not know. Start's resolver throws a plain `Error("Server function info not found for <id>")`
outside `handleServerAction`'s `try`, so it escapes the handler: h3 prints the error and Nitro answers
`500` with `{"status":500,"unhandled":true,"message":"HTTPError"}`, without the id or a stack.

A request middleware in `src/start.ts` could catch that error by matching the message text and answer 404.
That would depend on the wording of an internal error message, which comes in three variants (production
resolver, server-only function, dev server).

The upstream fix is TanStack/router PR #8246 ("fix(start): return 404 for unknown server function ids",
https://github.com/TanStack/router/pull/8246, open; we commented on it). It flags the resolver's error and
answers 404 without logging.

## Decision

Do not match the message. Keep Start's behavior until #8246 ships. The response already
leaks nothing; the cost is a 500 instead of a 404, and a raw h3 error print in the log per unknown id (see
docs/operations.md, Logs).

## Evidence

`tests/integration/security.test.ts`, test "answers an unknown server function with an error that leaks
nothing": GET and POST to `/_serverFn/does-not-exist` answer at least 400, and the body contains neither
the id, `Server function`, a stack frame, `node_modules` nor `.mjs`. `tests/integration/csp.test.ts` checks
that the response carries the locked-down CSP.

## Consequences

Monitoring sees 5xx for stale clients after a deploy until the upgrade.

## Revisit when

A `@tanstack/react-start` release contains #8246. Then, in that test, replace
`expect(res.status).toBeGreaterThanOrEqual(400)` with `expect(res.status).toBe(404)`, delete the
comment above it, and remove the h3 bullet from docs/operations.md (Logs) and the unknown-id sentence from
Security settings.
