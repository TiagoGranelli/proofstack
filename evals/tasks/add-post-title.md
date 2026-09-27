---
title: Add an optional title to posts, end to end
kind: feature across database, API and UI
timeout_minutes: 45
---

Authors want to give a post an optional title. Add it end to end: database, API contract, server, generated
SDK, UI and tests.

## Acceptance criteria

- A post has an optional title of 1 to 80 characters, trimmed, like the body's rules. Export the limit as
  `POST_TITLE_MAX_LENGTH = 80` from `src/contract/limits.ts`.
- API: `Post` has `title` (a string, or `null` for a post without one) in every response that returns posts.
  `PostInput` (create and update) takes an optional `title`; an update without `title` removes the title. A
  title that is empty, untrimmed or over 80 characters answers 400 `ValidationError`.
- Database: a nullable `title` column on `post`, added by a new migration generated with Drizzle.
- UI: the post composer and the post editor have a "Title (optional)" field; a post with a title shows it as a
  heading above the body, in the public list and on the dashboard.
- Tests at the cheapest layer that can observe each behavior, and the accessibility obligations for any new UI
  state.
- `pnpm check` and `pnpm check:drift contract migrations auth` pass, and the generated files are committed with
  their sources.
