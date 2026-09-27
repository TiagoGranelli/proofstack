---
name: add-page
description: Add or change a page (route) in this repo's UI, with its accessibility, keyboard and Lighthouse obligations. Use when creating a file in src/routes, adding a form or a new UI state to a page, or when the routes gate of pnpm check fails.
---

# Add a page

## Steps

1. **Route file** in `src/routes/` (kebab-case; TanStack prefixes such as `_authed/` for signed-in pages). It
   holds the route definition (`loader`, `beforeLoad`, `head`, `headers`, `validateSearch`) and a small page
   component that composes features. Forms, buttons with behavior and lists live in
   `src/features/<name>/components/`, data access in `src/features/<name>/api/`.
2. **Head:** a `<title>` through `head()`. Head scripts and styles also go through `head()` so the router adds
   the CSP nonce. Style with Tailwind classes only: no policy allows `'unsafe-inline'`, so `style` attributes
   and inline event handlers fail the prerender build and are blocked on SSR pages
   ([ADR 0010](../../../docs/decisions/0010-content-security-policy.md)).
3. **Errors:** a route with a loader sets `errorComponent` to `RouteError` with its own `title` and `action`
   (as `/dashboard`, `/account`). A section that can fail on its own is wrapped in `SectionErrorBoundary`, and
   reads its suspense query inside the boundary (`MyPostList`).
4. **Static page:** add its path to `nitro({ prerender: { routes } })` in `vite.config.ts`
   ([ADR 0004](../../../docs/decisions/0004-prerender-via-nitro.md)).
5. **Forms:** `useAppForm` validating with the input's Effect Schema, loaded on first interaction through
   `lazyFormSchema` (see "Forms" in `src/features/AGENTS.md`).
   Every control has a visible label. A button whose action is pending sets `aria-disabled` and ignores
   presses, so it keeps focus (a `disabled` button loses it).
6. **Accessibility tests** (the `routes` gate of `pnpm check` fails without all three):
   - an entry in `STATES` in `tests/e2e/a11y.spec.ts` for the page and each new UI state (axe, WCAG 2.2 AA);
   - a landmark snapshot in its `landmarks` block;
   - a row in the tab-order table of `tests/e2e/keyboard.spec.ts` if the page has controls.
7. **Component tests** for pending, disabled, error and limit states: `renderInApp(ui, { route })` mounts the
   real route file (read `tests/AGENTS.md`).
8. **Lighthouse:** a page users land on goes in `PAGES` in `scripts/lighthouse.ts` (SEO off for noindex
   pages). Accessibility, best practices and SEO must score 100, performance a median of 99; the policy is in
   [docs/agents/gates.md](../../../docs/agents/gates.md#lighthouse-policy).

## Done when

`pnpm check` passes, `pnpm build && pnpm verify:app` passes, and for a page in `PAGES`,
`pnpm build && pnpm lighthouse --page=<name>` passes.
