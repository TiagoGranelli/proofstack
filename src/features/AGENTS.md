# src/features/AGENTS.md

One folder per feature (`posts`, `auth`): `api/` (query options and mutation hooks), `components/`, `utils/`.
Read this before you add or change a feature. The root `AGENTS.md` still applies.

- A feature imports no other feature, not even `import type` (Fallow `autoDiscover` makes each
  `src/features/<name>` its own zone). Code two features need moves down to `src/components/` or `src/lib/`;
  a page that needs two features composes them in its route.
- Data access goes in `api/<verb>-<noun>.ts`. Queries export `get<Noun>QueryOptions()` bound to
  `client: apiClient()` over `#/sdk/@tanstack/react-query.gen.ts`. Mutations export a
  `use<Verb><Noun>({ mutationConfig })` hook that owns cache updates and declares its invalidation in `meta`
  (`invalidates`, `clearsCache`), never by hand: the `MutationCache` in `src/lib/query-client.ts` clears before
  the caller's `onSuccess` and refetches after it (`useCreatePost`, `useSignIn`, `useSignOut`). Where the user
  goes afterwards is the caller's `onSuccess`, not the hook's. Cache helpers shared by a feature's hooks go in
  `api/<noun>-cache.ts`. Account actions use `useAuthMutation` (`auth/api/auth-action.ts`).
- Components call these hooks, never a generated `*Mutation()` directly, and component files export only
  components.
- Forms, buttons with behavior and lists live in `components/`; pure helpers in `utils/`.
- Forms use `useAppForm` (`src/components/form/app-form.ts`) with `validationLogic: revalidateLogic()` and the
  input's Effect Schema, the same one the server validates with (`src/contract/post-input.ts`,
  `src/lib/account-input.ts`), through `lazyFormSchema(() => import(...))` (`src/components/form/lazy-schema.ts`):
  `.validator` in `validators.onDynamic`, `.decode` in `onSubmit`, `loadOnInteraction` on the `<form>` and
  `submitForm` in its `onSubmit` (`AuthForm` does both). Never import `effect` or a schema module statically in
  a form: the Schema runtime would be preloaded on the page (`tests/integration/client-bundle.test.ts`). A `ValidationError` issue goes next to the
  field its path names (`fieldIssue` in `src/lib/api-error.ts`); any other failure under the form.
- Every error the UI shows goes through `describeApiError` (`src/lib/api-error.ts`) or
  `describeAuthFailure` (`auth/utils/describe-auth-failure.ts`), so raw server output never reaches the page.
- A button whose action is pending is `aria-disabled` and ignores presses, so it keeps focus.
