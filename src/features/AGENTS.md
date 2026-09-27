# src/features/AGENTS.md

One folder per feature (`posts`, `auth`): `api/` (query options and mutation hooks), `components/`, `utils/`.
Read this before you add or change a feature. The root `AGENTS.md` still applies.

- A feature imports no other feature, not even `import type` (Fallow `autoDiscover` makes each
  `src/features/<name>` its own zone). Code two features need moves down to `src/components/` or `src/lib/`;
  a page that needs two features composes them in its route.
- Data access goes in `api/<verb>-<noun>.ts`. Queries export `get<Noun>QueryOptions()` bound to
  `client: apiClient()` over `#/sdk/@tanstack/react-query.gen.ts`. Mutations export a
  `use<Verb><Noun>({ mutationConfig })` hook that owns cache updates and invalidation and runs the caller's
  `onSuccess` before invalidating (`useCreatePost`, `useSignIn`, `useSignOut`). Where the user goes afterwards
  is the caller's `onSuccess`, not the hook's. Cache helpers shared by a feature's hooks go in
  `api/<noun>-cache.ts`. Account actions use `useAuthMutation` (`auth/api/auth-action.ts`).
- Components call these hooks, never a generated `*Mutation()` directly, and component files export only
  components.
- Forms, buttons with behavior and lists live in `components/`; pure helpers in `utils/`.
- Every error the UI shows goes through `describeApiError` (`src/lib/api-error.ts`) or
  `describeAuthFailure` (`auth/utils/describe-auth-failure.ts`), so raw server output never reaches the page.
- A button whose action is pending is `aria-disabled` and ignores presses, so it keeps focus.
