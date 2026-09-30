# 0011: Lighthouse measures the production build over HTTPS and HTTP/2

Status: Accepted (2026-09-27; amended for the `minimal` branch 2026-09-30)

## Context

Lighthouse's mobile metrics are simulated (Lantern): it records an unthrottled load, then replays its requests over
a modeled 150 ms RTT, 1.6 Mbps network with 4× CPU. Over HTTP/1.1, Lantern gives each parallel request its own new
connection, each paying a handshake and TCP slow start; over HTTP/2 they share the document's warm connection.
Static hosts serve over TLS, where browsers speak HTTP/2, so a gate that measures plain HTTP/1.1 measures a setup no
user gets. On `main` the difference was 1.95 s against 1.50 s of FCP on mobile, and a score of 98 against 100 for the
same build (main's ADR 0011 has the measurements).

On `main` the gate goes through the Caddy edge that production uses. The `minimal` branch ships a static build and
no server of its own.

## Decision

- `scripts/lighthouse.ts` serves `dist/` with Vite's own preview server, over HTTPS with
  `@vitejs/plugin-basic-ssl`'s self-signed certificate. Vite's preview server speaks HTTP/2 whenever it has a
  certificate, and it compresses responses with gzip.
- Chrome gets `--ignore-certificate-errors-spki-list` with the SHA-256 of that certificate's public key, so it trusts
  exactly that key and the page is a secure origin. The gate avoids `--ignore-certificate-errors`, which accepts any
  certificate and leaves the page in a certificate-error state that best-practices audits could see.
- `--protocol=h1|http` measures HTTP/1.1 over HTTPS or plain HTTP, to compare.
- CI judges performance with `--bar=ci`, which fails only on a run below 95. On GitHub's 2-vCPU runners a
  main-thread task in Chrome's navigation commit passes Lantern's 10 ms cutoff, and every preloaded script then
  starts one simulated round trip later: `main` scored 99 on most mobile runs in CI with a build that scores 100 on
  a development machine (GoogleChrome/lighthouse#16539). The deterministic categories stay at 100 on every run and
  the budgets still apply. `lighthouse-report/summary.json` records each run's preload task (`preloadTaskMs`).

## Evidence (2026-09-30)

`pnpm lighthouse --runs=1` on a development machine: every page scores 100 in performance, accessibility, best
practices and SEO, mobile and desktop; FCP = LCP 1.35 s on mobile and 0.33 s on desktop, 100 KB transferred.

## Consequences

- The numbers are those of `vite preview`, not of the host the app ends up on. A host adds its own headers, cache
  policy and compression level (brotli would shave some of the 100 KB). Measure the deployed site as well.
- `pnpm lighthouse` needs no trust-store changes: the certificate lives in `node_modules/.vite/basic-ssl` and only
  Chrome's command line trusts it.

## Revisit when

- GoogleChrome/lighthouse#16539 is fixed, or CI runs on a host where the preload task stays under 10 ms: CI should
  then use the `target` bar.
- The first-load JavaScript grows past what one more simulated round trip allows (the mobile score drops to 99).
