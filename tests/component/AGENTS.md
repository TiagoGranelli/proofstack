# tests/component/AGENTS.md

The component layer. [tests/AGENTS.md](../AGENTS.md) still applies.

- **component.** Render with `renderInApp(ui, { url })` from `tests/component/test-utils.tsx` (memory
  router with the app's paths, fresh `QueryClient`; returns `router` and `queryClient`); `route: { path,
  route }` mounts a real `src/routes` file route there (search validation, loader, component). Mock the
  network per test with `worker.use(...)` from `tests/component/api-mocks.ts`: `api.<operation>({ body })`
  (handlers generated from `openapi.json` by Hey API's `msw` plugin into `src/sdk/msw.gen.ts`),
  `apiError(operation, status, body)` (only statuses and bodies the operation declares), `apiFailure`
  (network error or non-JSON body), `held()` (a response that waits, for pending states), and
  `authFunction(name, answer)` with the shortcuts `auth.signIn`/`auth.signOut` for the account server
  functions (outside the contract; `answer` is their typed `AuthOutcome`, `'network'`, `'thrown'` or
  `held()`, or `{ ...held(), answer }` to fail after release); `authCalls(name)` records the `data` each call
  sends. A button whose action is pending is `aria-disabled` and ignores presses, never `disabled` (a disabled
  button loses focus when the browser renders); `pressAndKeepFocus(button)` (test-utils.tsx) presses it with
  the keyboard and checks focus stays after two rendered frames. A test that starts a request must wait for its
  handler (for example `authCalls`) before it ends. A request to `/api` or `/_serverFn`
  without a handler fails the test. `#/lib/api-client.ts` is aliased to its browser branch
  (`tests/component/stubs/api-client.ts`), and `#/lib/auth.functions.ts` to a stub that posts each call to
  `/_serverFn/auth/<name>` (`tests/component/stubs/auth-functions.ts`).
