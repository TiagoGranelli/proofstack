# 0004: Static pages are prerendered by Nitro, not by TanStack Start

Status: Accepted (2026-09-26)

## Context

`/about` is finite and static, and should be served as a file. TanStack Start has its own prerender
option, but with the Nitro 3 `node-server` preset its output is not served (TanStack/router#7473, open).

## Decision

List static routes in `nitro({ prerender: { routes: ['/about'], crawlLinks: false, failOnError: true } })`
in `vite.config.ts`. With `failOnError`, a page that cannot be prerendered (for example, because the
build lacks the environment variables it needs) fails the build instead of shipping without its static
copy. Dynamic pages such as `/` are server-rendered on every request.

## Evidence

`tests/integration/assets.test.ts` ("serves the prerendered page as a static file") expects an `etag`
on `/about` from the built server.

## Consequences

Add each new static page to that list by hand, because crawling is off. Start's `prerender` option
stays unused.

## Revisit when

TanStack/router#7473 is fixed. Then consider moving to Start's prerender with crawling.
