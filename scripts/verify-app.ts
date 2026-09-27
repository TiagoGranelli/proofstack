// Runs the built app against a fresh test database and exercises it end to end: SDK integration tests
// (Vitest, tests/integration), browser flows (Playwright, tests/e2e) and a graceful-shutdown check.
// Both test runners always run; the exit code is non-zero if either (or the shutdown check) fails.
// Server output goes to test-results/app-server.log and is printed only on failure.
// Usage: pnpm build && pnpm verify:app [--no-e2e] [--no-integration] [filter ...]
//   filter: file name filters passed to both runners, e.g. `pnpm verify:app security flows`
// Env: TEST_DATABASE_URL overrides the database (default: proofstack_verify_<pid>_test next to DATABASE_URL,
//      dropped afterwards unless KEEP_TEST_DB=1). ALLOW_STALE_BUILD=1 skips the build freshness check.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { assertChromium, startApp, tail } from './app-server.ts'
import { dropTestDatabase, openConnections, testDatabaseUrl } from './test-db.ts'

const LOG_FILE = 'test-results/app-server.log'
const CLOSED_LOG_FILE = 'test-results/app-server-closed.log'
/** srvx drains requests, then src/server/nitro/shutdown.ts ends the pool; both are quick with no traffic. */
const MAX_SHUTDOWN_MS = 3_000

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const filters = args.filter((a) => !a.startsWith('--'))
const unknown = [...flags].filter((f) => !['--no-e2e', '--no-integration'].includes(f))
if (unknown.length) {
  console.error(
    `unknown option(s): ${unknown.join(', ')}. Usage: pnpm verify:app [--no-e2e] [--no-integration] [filter ...]`,
  )
  process.exit(2)
}
const integration = !flags.has('--no-integration')
const e2e = !flags.has('--no-e2e')

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

let exitCode = 1
try {
  if (e2e) await assertChromium()
  const databaseUrl = testDatabaseUrl('verify', process.env.TEST_DATABASE_URL)
  // Mail goes to Mailpit (`pnpm mail:up`); the E2E tests read the links from its API.
  const mailpit = {
    smtp: `smtp://127.0.0.1:${process.env.MAILPIT_SMTP_PORT || '54325'}`,
    api: `http://127.0.0.1:${process.env.MAILPIT_HTTP_PORT || '54380'}`,
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
    trustedProxies: '127.0.0.1/32,::1/128',
    // Open sign-up, so the E2E tests can create the throwaway accounts the account lifecycle flows consume.
    settings: { AUTH_SIGN_UP: 'open', ...mail },
  })
  // The shipped defaults next to it, on the same database: closed sign-up, and a proxy list that excludes the
  // test process, whose X-Forwarded-For must then be ignored (tests/integration/auth-*.test.ts, tests/e2e).
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
    `app ${app.url} (database ${new URL(databaseUrl).pathname.slice(1)}, log ${LOG_FILE}), closed sign-up ${closed.url} ` +
      `(log ${CLOSED_LOG_FILE}), Mailpit ${mailpit.api}`,
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
    if (integration)
      timed(
        'integration (vitest)',
        'pnpm',
        ['exec', 'vitest', 'run', '--project', 'integration', '--passWithNoTests', ...filters],
        testEnv,
      )
    if (e2e)
      timed('e2e (playwright)', 'pnpm', ['exec', 'playwright', 'test', '--pass-with-no-tests', ...filters], testEnv)
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
  exitCode = results.every((r) => r.ok) ? 0 : 1
} catch (error) {
  console.error(`\nverify:app could not run: ${error instanceof Error ? error.message : String(error)}`)
}

console.log('')
for (const { name, ok, detail } of results) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(22)} ${detail}`)
if (exitCode !== 0 && results.length) console.error(`\nServer log (${LOG_FILE}, last lines):\n${tail(LOG_FILE, 40)}`)
process.exitCode = exitCode
