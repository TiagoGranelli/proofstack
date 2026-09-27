---
title: Add a bulk delete endpoint with a typed error
kind: new endpoint and typed error
timeout_minutes: 45
---

Authors want to delete several of their posts at once. Add an endpoint for it to the API contract, with a new
typed error, and wire it through the server, the generated SDK and the tests. No UI is needed.

## Acceptance criteria

- `POST /api/me/posts/bulk-delete`, in the `myPosts` group (signed-in authors only, counted by the same write
  rate limit as the other writes, once per request). Payload: `{ "ids": string[] }` with 1 to 50 ids.
  Success: 200 with `{ "deleted": <number of posts deleted> }`.
- All or nothing: when any id does not name a post of the signed-in author (missing, malformed, or another
  author's), the endpoint deletes nothing and answers 404 with a new tagged error
  `{ "_tag": "PostsNotFound", "ids": [...] }` listing exactly those ids, in request order.
- An empty list or more than 50 ids answers 400 `ValidationError`; no session answers 401 `Unauthorized`.
- The UI's error messages handle the new tag (`src/lib/api-error.ts`).
- Handler tests for every branch, and a query budget for any new repository method.
- `pnpm check` and `pnpm check:drift contract migrations auth` pass, and the generated files are committed with
  their sources.
