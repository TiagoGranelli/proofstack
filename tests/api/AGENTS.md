# tests/api/AGENTS.md

The api layer. [tests/AGENTS.md](../AGENTS.md) still applies.

- **api.** `tests/api/harness.ts`: `apiLayer({ databaseDown?, clockStepMicros? })` provides the real handlers,
  `RequestValidation` and `WriteRateLimit` over a fresh in-memory repository and rate-limit store (the Postgres
  store's rule on a virtual clock, one second per request, so `retryAfter` is computed, not a constant);
  `clientAs('alice' | 'bob' | 'forged' | 'none')` is a typed client with that session (one client per identity:
  the client captures its middleware). The typed client refuses to encode invalid payloads, so send those
  through `webHandler(options?)` as raw `Request`s. `database-down.test.ts` sends every contract operation
  (`operations.ts`) with the database down and expects the 503 it declares or else an empty 500 (`NO_DATABASE`
  lists the few that skip the database), and `public-operations.test.ts` expects 401 without a session unless
  `PUBLIC_OPERATIONS` lists it: a new endpoint needs no edit. List fakes page with `memoryPage` (`memory-keyset.ts`).
  Dummy env values (`vitest.config.ts`) pass the import-time check of `src/server/env.ts`; nothing uses them.
