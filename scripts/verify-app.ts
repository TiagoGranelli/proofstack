// Runs the built app against a fresh test database and exercises it end to end: SDK integration tests
// (Vitest, tests/integration), browser flows (Playwright, tests/e2e) and a graceful-shutdown check. Before the
// app starts, the `db` Vitest project (tests/db: the rate-limit storage and query budgets) runs against its own
// fresh database. Every runner always runs; the exit code is non-zero if any (or the shutdown check) fails.
// Two servers share the database: APP_URL with AUTH_SIGN_UP=open, and CLOSED_APP_URL with the shipped defaults
// (closed sign-up, the test process not a trusted proxy). Mail goes to Mailpit, which must be running
// (`pnpm mail:up`). Server output goes to test-results/app-server*.log and is printed only on failure.
// After a full run (every runner, no filter) the contract-coverage check (scripts/contract-coverage.ts) compares
// the statuses openapi.json declares with those the suites saw: the app servers' request logs and the api layer,
// which runs once more with its recorder on.
// Usage: pnpm build && pnpm verify:app [--no-db] [--no-e2e] [--no-integration] [--edge] [filter ...]
//   filter: file name filters passed to both runners, e.g. `pnpm verify:app security flows`. A filter that
//           matches no test in any selected runner is an error (a typo must not pass as a green run); a runner
//           that none of the filters match is skipped. Without filters every selected runner must find tests.
//   --edge: run both suites through the reference edge (Caddy, deploy/Caddyfile) as in production; its log
//           is test-results/edge.log. Playwright projects: PW_PROJECTS (see playwright.config.ts).
// Env: TEST_DATABASE_URL overrides the database (default: proofstack_verify_<pid>_test next to DATABASE_URL,
//      dropped afterwards unless KEEP_TEST_DB=1). ALLOW_STALE_BUILD=1 skips the build freshness check.
//      MAILPIT_HOST (default 127.0.0.1), MAILPIT_SMTP_PORT and MAILPIT_HTTP_PORT locate Mailpit.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { assertChromium, LOOPBACK, startApp, tail } from './app-server.ts'
import { dropTestDatabase, openConnections, testDatabaseUrl } from './test-db.ts'

const LOG_FILE = 'test-results/app-server.log'
/** Where tests/api/harness.ts records the api layer's responses for scripts/contract-coverage.ts. */
const CONTRACT_OBSERVATIONS = 'test-results/contract-observations'
const CLOSED_LOG_FILE = 'test-results/app-server-closed.log'
/** srvx drains requests, then the close hook from src/server/lifecycle.ts ends the pool; both are quick with no traffic. */
const MAX_SHUTDOWN_MS = 3_000

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const filters = args.filter((a) => !a.startsWith('--'))
const unknown = [...flags].filter((f) => !['--no-db', '--no-e2e', '--no-integration', '--edge'].includes(f))
if (unknown.length) {
  console.error(
    `unknown option(s): ${unknown.join(', ')}. Usage: pnpm verify:app [--no-db] [--no-e2e] [--no-integration] [--edge] [filter ...]`,
  )
  process.exit(2)
}
const dbTests = !flags.has('--no-db')
const integration = !flags.has('--no-integration')
const e2e = !flags.has('--no-e2e')
const edge = flags.has('--edge')

const listed = (command: string[], line: RegExp) => {
  const { status, stdout, stderr } = spawnSync('pnpm', ['exec', ...command], { encoding: 'utf8' })
  // Vitest lists nothing and exits 0 when nothing matches, Playwright exits 1 with "No tests found"; any other
  // failure is a broken config or test file.
  if (status !== 0 && !/^Error: No tests found\./m.test(`${stdout}${stderr}`)) {
    console.error(`${command.join(' ')} failed:\n${stdout}${stderr}`)
    process.exit(2)
  }
  return stdout.split('\n').filter((l) => line.test(l)).length
}
/** How many test files (db, integration) or tests outside the seed project (e2e) each runner would run for `filter`. */
const RUNNERS = {
  db: (filter: string) => listed(['vitest', 'list', '--project', 'db', '--filesOnly', filter], /^\[db\] /),
  integration: (filter: string) =>
    listed(['vitest', 'list', '--project', 'integration', '--filesOnly', filter], /^\[integration\] /),
  e2e: (filter: string) => listed(['playwright', 'test', '--list', filter], /^\s+\[(?!seed\])[^\]]+\] › /),
}
const selectedRunners = (Object.keys(RUNNERS) as Array<keyof typeof RUNNERS>).filter(
  (runner) => ({ db: dbTests, integration, e2e })[runner],
)
/** Which runners have work: every selected one without filters, otherwise those that some filter matches. */
const runs = new Set(selectedRunners)
if (filters.length) {
  const matched = filters.map((filter) => ({
    filter,
    runners: selectedRunners.filter((runner) => RUNNERS[runner](filter) > 0),
  }))
  const unmatched = matched.filter((m) => m.runners.length === 0).map((m) => m.filter)
  if (unmatched.length) {
    console.error(`filter(s) matching no test in ${selectedRunners.join(' or ')}: ${unmatched.join(', ')}`)
    process.exit(2)
  }
  for (const runner of selectedRunners) if (!matched.some((m) => m.runners.includes(runner))) runs.delete(runner)
}

type Result = { name: string; ok: boolean; detail: string }
const results: Result[] = []
const timed = (name: string, command: string, commandArgs: string[], env: NodeJS.ProcessEnv) => {
  const started = performance.now()
  const { status, signal } = spawnSync(command, commandArgs, { stdio: 'inherit', env })
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  results.push({
    name,
    ok: status === 0,
    detail: status === 0 ? `${seconds}s` : `exit ${status ?? signal}, ${seconds}s`,
  })
}

/**
 * Contract coverage needs every response of a whole run: every runner, no filter. The api layer runs here
 * again, recording (it needs no app), and the check reads that and every app server's request log at the end.
 */
const contractCoverage = !filters.length && dbTests && integration && e2e

let exitCode = 1
try {
  if (e2e) await assertChromium()
  if (contractCoverage) {
    rmSync(CONTRACT_OBSERVATIONS, { recursive: true, force: true })
    timed('api (vitest, recorded)', 'pnpm', ['exec', 'vitest', 'run', '--project', 'api'], {
      ...process.env,
      CONTRACT_OBSERVATIONS,
    })
  }
  // No app needed: the project creates and drops its own database (tests/db/global-setup.ts).
  if (runs.has('db'))
    timed('db (vitest)', 'pnpm', ['exec', 'vitest', 'run', '--project', 'db', ...filters], process.env)
  else if (dbTests) results.push({ name: 'db (vitest)', ok: true, detail: 'skipped: no file matches' })
  const databaseUrl = testDatabaseUrl('verify', process.env.TEST_DATABASE_URL)
  // Mail goes to Mailpit (`pnpm mail:up`); the E2E tests read the links from its API. MAILPIT_HOST is for
  // runners where it is another container (`pnpm ci:local`).
  const mailpitHost = process.env.MAILPIT_HOST || '127.0.0.1'
  const mailpit = {
    smtp: `smtp://${mailpitHost}:${process.env.MAILPIT_SMTP_PORT || '54325'}`,
    api: `http://${mailpitHost}:${process.env.MAILPIT_HTTP_PORT || '54380'}`,
  }
  const ready = await fetch(`${mailpit.api}/readyz`).catch(() => undefined)
  if (!ready?.ok) throw new Error(`Mailpit is not reachable at ${mailpit.api}. Start it with \`pnpm mail:up\`.`)
  const mail = { SMTP_URL: mailpit.smtp, MAIL_FROM: 'ProofStack <no-reply@example.test>' }
  const app = await startApp({
    databaseUrl,
    logFile: LOG_FILE,
    port: process.env.VERIFY_PORT,
    // The test process is the "proxy": each suite sends its own X-Forwarded-For and so gets its own sign-in
    // rate-limit bucket. The server believes the header only from these peers.
    trustedProxies: LOOPBACK,
    // Behind the edge the test process is a proxy in front of Caddy instead: Caddy believes its
    // X-Forwarded-For (it connects from loopback) and hands the resolved client IP to the app.
    ...(edge ? { edge: { trustedProxies: 'private_ranges', logFile: 'test-results/edge.log' } } : {}),
    // Open sign-up, so the E2E tests can create the throwaway accounts the account lifecycle flows consume.
    settings: { AUTH_SIGN_UP: 'open', ...mail },
  })
  // The shipped defaults next to it, on the same database and never behind the edge: closed sign-up, and a
  // proxy list that excludes the test process, whose X-Forwarded-For must then be ignored
  // (tests/integration/auth-*.test.ts, tests/e2e/auth-closed.spec.ts).
  const closed = await startApp({
    databaseUrl,
    logFile: CLOSED_LOG_FILE,
    trustedProxies: '10.0.0.0/8',
    settings: { AUTH_SIGN_UP: 'closed', ...mail },
    alongside: app,
  }).catch(async (error: unknown) => {
    await app.stop()
    throw error
  })
  console.log(
    `app ${app.url}${edge ? ` (edge in front of ${app.directUrl})` : ''} (database ${new URL(databaseUrl).pathname.slice(1)}, ` +
      `log ${LOG_FILE}), closed sign-up ${closed.url} (log ${CLOSED_LOG_FILE}), Mailpit ${mailpit.api}`,
  )
  try {
    const testEnv = {
      ...app.env,
      TEST_USER_EMAIL: app.user.email,
      TEST_USER_PASSWORD: app.user.password,
      TEST_USER_NAME: app.user.name,
      TEST_OTHER_USER_EMAIL: app.otherUser.email,
      TEST_OTHER_USER_PASSWORD: app.otherUser.password,
      TEST_OTHER_USER_NAME: app.otherUser.name,
      CLOSED_APP_URL: closed.url,
      MAILPIT_URL: mailpit.api,
    }
    // Neither runner may pass with no tests: every runner started here has matching tests (see `runs`).
    if (runs.has('integration'))
      timed('integration (vitest)', 'pnpm', ['exec', 'vitest', 'run', '--project', 'integration', ...filters], testEnv)
    else if (integration) results.push({ name: 'integration (vitest)', ok: true, detail: 'skipped: no file matches' })
    if (runs.has('e2e')) timed('e2e (playwright)', 'pnpm', ['exec', 'playwright', 'test', ...filters], testEnv)
    else if (e2e) results.push({ name: 'e2e (playwright)', ok: true, detail: 'skipped: no test matches' })
  } finally {
    const [stopped] = await Promise.all([app.stop(), closed.stop()])
    // The process exited, so its sockets are gone; Postgres may take a moment to reap the backends.
    let leftover = await openConnections(databaseUrl)
    for (let i = 0; i < 10 && leftover.length; i++) {
      await new Promise((r) => setTimeout(r, 100))
      leftover = await openConnections(databaseUrl)
    }
    const log = readFileSync(LOG_FILE, 'utf8')
    const closedPool = log
      .split('\n')
      .some((line) => line.includes('"shutdown complete"') && line.includes('postgres-pool'))
    const problems = [
      stopped.ms > MAX_SHUTDOWN_MS ? `took ${stopped.ms} ms (max ${MAX_SHUTDOWN_MS})` : '',
      stopped.code === 0 ? '' : `exit ${stopped.code ?? stopped.signal}`,
      closedPool ? '' : 'no "shutdown complete" log line listing postgres-pool',
      leftover.length
        ? `connections left: ${leftover.map((r) => `${r.application_name || '?'}×${r.n}`).join(', ')}`
        : '',
    ].filter(Boolean)
    results.push({
      name: 'graceful shutdown',
      ok: problems.length === 0,
      detail: problems.join('; ') || `${stopped.ms} ms`,
    })
    if (process.env.KEEP_TEST_DB !== '1' && !process.env.TEST_DATABASE_URL) await dropTestDatabase(databaseUrl)
  }
  if (contractCoverage) {
    const logs = readdirSync('test-results')
      .filter((name) => /^app-server.*\.log$/.test(name))
      .map((name) => `test-results/${name}`)
    timed('contract coverage', 'node', ['scripts/contract-coverage.ts', CONTRACT_OBSERVATIONS, ...logs], process.env)
  } else results.push({ name: 'contract coverage', ok: true, detail: 'skipped: needs a full run' })
  exitCode = results.every((r) => r.ok) ? 0 : 1
} catch (error) {
  console.error(`\nverify:app could not run: ${error instanceof Error ? error.message : String(error)}`)
}

console.log('')
for (const { name, ok, detail } of results) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(22)} ${detail}`)
if (exitCode !== 0 && results.length) console.error(`\nServer log (${LOG_FILE}, last lines):\n${tail(LOG_FILE, 40)}`)
process.exitCode = exitCode
