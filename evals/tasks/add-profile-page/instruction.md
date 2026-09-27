Signed-in users want to change the name other people see on their posts. Add a profile page with a form for it.
The name is Better Auth's `user.name`, changed through its `POST /update-user` endpoint.

## Acceptance criteria

- A page at `/profile` for signed-in users only (`src/routes/_authed/profile.tsx`), titled
  `pageTitle('Profile')` (`src/config/app.ts`), not indexed by search engines, with the heading "Profile". The site header or the
  account page links to it.
- The form is the component `ProfileNameForm` exported from
  `src/features/auth/components/profile-name-form.tsx`, with the prop `name` (the current display name):
  - a text field labelled "Display name", filled with the current name;
  - a button "Save name", disabled while the trimmed name is empty;
  - saving sends the trimmed name through a new server function `updateName` in `src/lib/auth.functions.ts`
    with the data `{ name }`;
  - on success the form shows the status "Name saved."; on failure an alert with the message
    `describeAuthFailure` gives for the error.
- The account action follows the repo's rules for account actions (input validation, endpoint allowlist, hook in
  `src/features/auth/api/`), and the component tests' stub of `auth.functions.ts` knows the new function.
- The page meets the accessibility obligations for a new page (axe state, landmark snapshot, tab order).
- `pnpm check` passes.
