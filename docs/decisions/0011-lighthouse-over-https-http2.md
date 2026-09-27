# 0011: Lighthouse measures the edge over HTTPS and HTTP/2, with stock head tags

Status: Accepted (2026-09-27)

## Context

With the custom `Head` (no `modulepreload`) and Start's experimental `inlineCss` removed, the mobile
performance score dropped from 100 (FCP about 1.35 s) to 98 on every page (97 on `/dashboard`, FCP 2.10 s),
measured through the Caddy edge over plain HTTP. Both removed pieces were workarounds, so the question was
where the 0.6 s came from and whether a principled change gets it back.

Lighthouse's mobile metrics are simulated (Lantern): it records an unthrottled load, then replays its
requests over a modeled 150 ms RTT, 1.6 Mbps network with 4× CPU. Reading Lantern's source
(`@paulirish/trace_engine` 0.0.65, used by Lighthouse 13.5) and the median reports:

1. **Protocol.** Over HTTP/1.1 Lantern gives each parallel request its own new connection (up to six per
   origin), each paying a handshake and TCP slow start. The page's stylesheet and its 10 to 15 preloaded
   scripts all start together after the HTML, so most pay a cold connection. Over HTTP/2 they reuse the
   document's warm connection. Production always serves the app over TLS, where browsers speak HTTP/2; the
   gate measured plain HTTP/1.1, a topology no user gets.
2. **Scripts count as blocking the first paint.** `FirstContentfulPaint.getFirstPaintBasedGraph` keeps
   every request that finished before the *observed* first paint and has "render-blocking priority";
   `NetworkNode.hasRenderBlockingPriority()` counts a `Script` at `High`, which is the default priority of a
   `modulepreload`. Module evaluation appears in the trace as `v8.evaluateModule` without a URL, so Lantern
   cannot tell that the scripts ran after the paint. On a local server every preload finishes before the
   observed paint, so all ~135 KB (brotli) of JavaScript is simulated as blocking FCP and LCP. With Chrome's
   applied throttling instead, the real FCP of `/` is about 0.53 s.
3. **Not the cause:** the head order of TanStack/router#6749. React 19 hoists stylesheets that carry a
   `precedence` (TanStack's `Asset` sets `precedence="default"`), so the HTML already has the stylesheet
   before every `modulepreload`. Neither are "non-critical" preloads: every generated preload is part of the
   route's static graph, which hydration awaits.

## Decision

- **The gate measures HTTPS with HTTP/2.** `scripts/edge.ts` serves `https://localhost:<port>` from Caddy's
  internal CA (`skip_install_trust` in `deploy/Caddyfile`); the script trusts that CA for its own requests
  and Chrome gets `--ignore-certificate-errors-spki-list` with the SPKI hash of the served certificate, so
  it trusts exactly that key and the page is a secure origin. `--ignore-certificate-errors` was not used: it
  accepts any certificate and leaves the page in a certificate-error state that best-practices audits could
  see. `--edge-protocol=h1|http` measures HTTP/1.1 to compare (docs/operations.md, "Lighthouse through the
  edge").
- **Stock `HeadContent`, default preload priority.** Lowering the preloads to `fetchpriority="low"` (React's
  own policy for its bootstrap scripts; TanStack/router#8212, a draft) was measured: Lantern FCP 1.51 s →
  0.79 s, LCP unchanged at 1.51 s, because the LCP graph keeps every request regardless of priority. Real
  FCP barely moves (the browser paints long before the scripts arrive), while hydration, which every
  preload gates, would start later on slow links, and input before hydration is lost. It would mostly move
  the simulated number, so it is not done; there is no public API for it anyway (only a custom `Head`).
- **Upstream:** TanStack/router#8520 (ours) makes Start preload the transitive static imports of a route:
  with Rolldown the manifest listed only direct imports, so `useBaseQuery-*.js` (under `/` and `/dashboard`)
  loaded one round trip late, after the other scripts (TanStack/router#8511). Measured with applied
  throttling, the last script arrives ~250 ms earlier and hydration ~80 ms earlier. We commented on #6749
  (React already hoists the stylesheet) and #8212 (the Lantern mechanism above).

## Evidence

Same build, mobile, medians of 3 (docs/operations.md has the table): plain HTTP/1.1 FCP = LCP 1.95 s (score
98; `/dashboard` 2.10 s, 97); HTTPS with HTTP/1.1 2.25 s (96; 2.40 s, 95); HTTPS with HTTP/2 1.50 s (100;
`/dashboard` 1.51 s). `pnpm lighthouse --runs=5` passes with every median at 100 and desktop at 100.

## Consequences

- The mobile score sits one simulated round trip from 99: 1.50 s scores 100, and the LCP audit drops below
  0.995 (score 99) at about 1.52 s. The HTML, stylesheet and JavaScript need five round trips of Lantern's
  congestion window on the shared connection; `/dashboard` would need about 13 KB (brotli) less JavaScript
  and `/` about 8 KB less for four (1.35 s). The CPU part of the simulation is the observed main-thread time
  times four, so a busy machine can push single runs to 1.55 s (99). The policy tolerates one such run per
  page; the `benchmarkIndex` of every run is in `lighthouse-report/summary.json`.
- `pnpm lighthouse` needs no trust-store changes; the local CA lives in the edge's tmpfs (or a temporary
  `XDG_DATA_HOME` with `EDGE_RUNTIME=binary`) and is gone after the run.
- `verify:app --edge` still uses plain HTTP; its tests are about headers and client IPs, not the protocol.

## Revisit when

- TanStack/router#8520 ships: upgrade, check that `/` and `/dashboard` preload `useBaseQuery-*.js`, and
  re-measure (it adds ~3 KB to the simulated first paint; within the same round trip today).
- Start or Router offers an option for preload priority (TanStack/router#8212) and field data shows that
  hydration does not suffer, or Lantern stops counting `modulepreload` as render-blocking.
- The first-load JavaScript grows by roughly 20 KB brotli: the page then needs a sixth simulated round trip
  (FCP about 1.65 s, score 99).
