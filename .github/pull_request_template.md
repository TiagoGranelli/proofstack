## What and why

<!-- What this changes, and the problem it solves. Link the issue. -->

## Gates run

- [ ] `pnpm check`
- [ ] `pnpm check:drift`
- [ ] `pnpm build && pnpm verify:app` (contract, database, auth or UI changes)
- [ ] `pnpm build && pnpm lighthouse` (pages, styles or anything that ships to the browser)

## Checklist

- [ ] Generated files (`openapi.json`, `src/sdk/`, `drizzle/`) are regenerated and committed with their source.
- [ ] Any gate exception is a visible edit next to its reason.
- [ ] CHANGELOG.md has a line under `## [Unreleased]`, with upgrade notes if adopters must act.
