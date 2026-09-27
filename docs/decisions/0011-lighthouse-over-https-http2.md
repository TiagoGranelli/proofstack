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
   cannot tell that the scripts ran after the paint, although Chrome's own trace marks every preload
   `renderBlocking: "non_blocking"`. The LCP graph keeps every request before the observed LCP, whatever its
   priority. On the local edge the race is lost by a few milliseconds: in the trace of `/` the stylesheet
   arrives at 32 ms, the first layout and paint run at 32–44 ms, the preloads finish at 45–48 ms and the
   frame is presented (observed FCP) at 50 ms. So all ~135 KB (brotli) of JavaScript is simulated as
   blocking FCP and LCP. Over a real network the scripts would arrive after that first frame. With Chrome's
   applied throttling instead of the simulation, the real FCP of `/` is about 0.53 s. This is the Lantern
   limitation reported in GoogleChrome/lighthouse#16539 (acknowledged, a fix for the LCP side in progress).
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
  0.995 (score 99) at about 1.52 s. The document, with its connection, takes five simulated round trips, and
  the preloaded JavaScript five more of Lantern's congestion window on the same connection. Replaying Lantern with changed
  sizes: a round trip less (1.35 s) needs about 10 KB (brotli) less first-load JavaScript on `/`, 8 KB on
  `/about`, 24 KB on `/login` and 32 KB on `/dashboard`; `/dashboard` loses a round trip (1.66 s, 99) with
  1 KB more, `/login` with 8 KB, `/` and `/about` with about 20 KB. Main-thread time counts four times, and one
  task decides whether a host scores 100 or 99 (next section). The policy tolerates one 99 run per page; every
  run's `benchmarkIndex` and preload task are in `lighthouse-report/summary.json`. Run the gate on an otherwise
  idle machine.
- `pnpm lighthouse` needs no trust-store changes; the local CA lives in the edge's tmpfs (or a temporary
  `XDG_DATA_HOME` with `EDGE_RUNTIME=binary`) and is gone after the run.
- The test servers behind the edge (`TEST_EDGE=1`) still use plain HTTP; their tests are about headers and client IPs, not the protocol.

## The preload task, and why CI scored 99

CI run 36349657322 (GitHub's `ubuntu-24.04`, 2 vCPUs for a private repository) scored 99 on 19 of 20 mobile
runs, FCP = LCP 1.62–1.79 s, with the build that scores 100 (1.50 s) on the laptop; desktop was 100. Replaying
Lantern (`@paulirish/trace_engine` 0.0.65) on saved traces (`lighthouse -GA`) shows why:

- Chrome requests the stylesheet and every `modulepreload` inside the navigation-commit task
  (`DocumentLoader::CommitNavigation` → `HTMLDocumentParser::MaybeFetchQueuedPreloads`): the whole document is
  buffered when the renderer commits. Most of that task creates the page's JavaScript contexts; handling the
  13 KB of HTML takes about 3 ms of it.
- Lantern drops a task shorter than 10 ms that has a single dependency (`SIGNIFICANT_DUR_THRESHOLD_MS`) and
  makes every Script, XHR or Fetch request sent inside a kept task wait for it, times the CPU slowdown. The
  stylesheet is not linked. On the laptop the task lasts 5–10 ms and costs nothing; on the runner it lasted
  26–68 ms, so every preloaded script started 105–270 ms later, one more round trip. Stretching only that task
  in a laptop trace: 9.9 ms gives 1.504 s, 10.1 ms 1.544 s, 33 ms 1.636 s.
- It is CPU contention, which `benchmarkIndex` does not see. `/` on mobile with the whole gate pinned by
  `taskset`: 2 fast cores (benchmarkIndex 4560–4630) 12–22 ms and 99; 2 slow cores (2400–2590, the runner's
  range) 16–31 ms and 99; 4 slow cores 12–19 ms and 99; 8 slow cores 9–10 ms and 100. Lighthouse asks for
  "minimum 2 dedicated cores (4 recommended)" and no concurrent load (its docs/variability.md); the runner's two
  vCPUs also run the app server, the Caddy container and Postgres. Measuring only the performance category
  does not shorten the task.
- Not the cause: the network, the request order (the stylesheet precedes every preload), the server's response
  time (4–45 ms, inside the same round trip).

Where the laptop's 1.50 s go on `/`: the document with its connection 0.75 s, the preloaded JavaScript
(about 130 KB brotli) 0.75 s, the stylesheet 0 (it arrives in the document's round trip), no fonts, main-thread
work 0 (it overlaps the downloads). Without the scripts in the graph (#16539 fixed) FCP would be 0.78 s
(`/dashboard` 0.82 s, the 2-core host 0.95 s).

Measured and rejected, in Lantern replays of the laptop and 2-core traces:

- Smaller, inlined or `fetchpriority` stylesheet, another head order or streaming, a higher HTML compression
  level: 0 ms. The stylesheet and the 3–6 KB document already share the document's round trip, and the
  stylesheet already comes first at `VeryHigh` priority. Inlined CSS would also need a nonce or hash (ADR 0010).
- `cn`'s build-time tables (`cn build`): 1.8 KB less, 0 ms. Nothing else in the first-load JavaScript can go
  without touching components: React DOM is 54 KB of the 89 KB entry chunk, TanStack Router 22 KB, Start's
  serializer and client 10 KB.
- 103 Early Hints (sent from the Nitro plugin through Caddy for `/`, on the 2-core host): FCP 0.96 s, only
  because Lighthouse does not see the early-hints fetches. The report counted 8 KiB in total and 0 bytes for
  every script, so it would hide the JavaScript from the gate, not load less of it.
- Calibrating `cpuSlowdownMultiplier` from `benchmarkIndex`: Lighthouse's guidance (docs/throttling.md and its
  CPU throttling calculator, 3 + (benchmarkIndex − 1300) / 233 above 1300) raises it on faster hosts, to 7–8×
  on the runner and 16–17× on the laptop. That is stricter, not a fix, and the cause is contention the index
  does not measure. The gate keeps Lighthouse's default 4×, as PageSpeed Insights does.

So the application does not change; the fix is upstream. The follow-up planned in GoogleChrome/lighthouse#16539
("ignore modulepreloads when computing FCP and LCP", after #16782) takes the scripts, and with them this task, out
of the first-paint graph. Meanwhile `lighthouse-report/summary.json` records each run's preload task
(`perRun[].preloadTaskMs`) and the host's CPU count, and `summary.md` says when a run reached 10 ms. A 99 with
the preload task under 10 ms points at the page; with it above, the host added the round trip.

### CI's bar (owner decision, 2026-09-27)

On the first GitHub run every mobile page scored 99 in four or five of five runs for the reason above. CI now
judges performance with `--bar=ci` (`POLICY.performance.ci`): it fails only when a run scores below 95. The
deterministic categories stay at 100 on every run, the metric budgets still apply, and `pnpm lighthouse` locally
keeps the `target` bar. Back to `target` on CI once Lighthouse stops counting modulepreloads in FCP.

## Revisit when

- TanStack/router#8520 ships: upgrade, check that `/` and `/dashboard` preload `useBaseQuery-*.js`, and
  re-measure. It adds 2.7 KB to the simulated first paint: free on `/`, a round trip on `/dashboard` (1.51 →
  1.66 s, 99) unless about 1 KB leaves its first-load JavaScript first.
- Start or Router offers an option for preload priority (TanStack/router#8212) and field data shows that
  hydration does not suffer, or Lantern stops counting `modulepreload` as render-blocking.
- The first-load JavaScript grows (see Consequences for each page's room): the page then needs a sixth
  simulated round trip (FCP about 1.65 s, score 99).
- GoogleChrome/lighthouse#16539 is fixed, or the CI job runs on a host where the preload task stays under 10 ms
  (8 cores in the measurements above): CI should then match the laptop.
