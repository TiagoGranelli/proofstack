## What and why

<!-- What this changes, and the problem it solves. Link the issue. -->

## Gates run

- [ ] `pnpm check`
- [ ] `pnpm test:e2e` (anything a user can see)
- [ ] `pnpm build && pnpm lighthouse` (pages, styles or anything that ships to the browser)

## Checklist

- [ ] `src/routeTree.gen.ts` is regenerated and committed with its routes.
- [ ] Any gate exception is a visible edit next to its reason.
- [ ] A gate change that `main` shares went to `main` first, or says why it only applies here.
