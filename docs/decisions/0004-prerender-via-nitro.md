# 0004: Static pages are prerendered by Nitro, the deployment layer

Status: Accepted (2026-09-26)

## Context

`/about` is finite and static, and should be served as a file. TanStack Start builds and deploys through
Vite and Nitro: its deployment guide puts `nitro()` next to `tanstackStart()` for Node, Docker, Vercel and
Railway, and the production server is Nitro's `node-server` output. Prerendering is a documented Nitro
feature ("Render routes at build time and serve them as static assets", `nitro/dist/docs/0.docs/13.prerendering.md`):
`prerender.routes` lists the pages, Nitro fetches them from a build of the app and writes them to
`.output/public`, and its static handler serves them with the route rules that apply to the path.

Start also has its own `prerender` option. With the Nitro 3 `node-server` preset its output is written but
not served (TanStack/router#7473, open).

## Decision

Static routes are listed in `nitro({ prerender: { routes: ['/about'], crawlLinks: false, failOnError: true } })`
in `vite.config.ts`, which uses the prerendering of the layer that serves the files. The page is rendered by
the same SSR code, and Nitro owns everything about serving it (file, `ETag`,
precompressed copies, route-rule headers). Nitro's build-time hooks are used the same way: the
`prerender:generate` hook writes the page's hash-based Content-Security-Policy as a route rule header
([ADR 0010](0010-content-security-policy.md)).

With `failOnError`, a page that cannot be prerendered (for example, because the build lacks the environment
variables it needs) fails the build instead of shipping without its static copy. Dynamic pages such as `/`
are server-rendered on every request.

## Evidence

- `tests/integration/assets.test.ts` ("serves the prerendered page as a static file") expects an `etag` on
  `/about` from the built server, which only Nitro's static handler sets.
- `tests/integration/csp.test.ts` checks that `/about` carries exactly the sha256 hashes of its own inline
  scripts, set by the route rule the prerender hook wrote.

## Consequences

Add each new static page to that list by hand, because crawling is off. Start's `prerender` option stays
unused.

## Revisit when

TanStack/router#7473 is fixed and Start's prerender offers something Nitro's does not (for example,
crawling from the route tree).
