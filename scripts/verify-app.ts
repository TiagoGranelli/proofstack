// Runs the built app against a fresh test database and exercises it end to end: SDK integration tests
// (Vitest, tests/integration), browser flows (Playwright, tests/e2e) and a graceful-shutdown check.
// Both test runners always run; the exit code is non-zero if either (or the shutdown check) fails.
// Server output goes to test-results/app-server.log and is printed only on failure.
// Usage: pnpm build && pnpm verify:app [--no-e2e] [--no-integration] [--edge] [filter ...]
//   filter: file name filters passed to both runners, e.g. `pnpm verify:app security flows`
//   --edge: run both suites through the reference edge (Caddy, deploy/Caddyfile) as in production; its log
//           is test-results/edge.log. Playwright projects: PW_PROJECTS (see playwright.config.ts).
// Env: TEST_DATABASE_URL overrides the database (default: proofstack_verify_<pid>_test next to DATABASE_URL,
//      dropped afterwards unless KEEP_TEST_DB=1). ALLOW_STALE_BUILD=1 skips the build freshness check.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { assertChromium, startApp, tail } from './app-server.ts'
import { dropTestDatabase, openConnections, testDatabaseUrl } from './test-db.ts'

const LOG_FILE = 'test-results/app-server.log'
/** srvx drains requests, then the close hook from src/server/lifecycle.ts ends the pool; both are quick with no traffic. */
const MAX_SHUTDOWN_MS = 3_000

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const filters = args.filter((a) => !a.startsWith('--'))
const unknown = [...flags].filter((f) => !['--no-e2e', '--no-integration', '--edge'].includes(f))
if (unknown.length) {
  console.error(
    `unknown option(s): ${unknown.join(', ')}. Usage: pnpm verify:app [--no-e2e] [--no-integration] [--edge] [filter ...]`,
  )
  process.exit(2)
}
const integration = !flags.has('--no-integration')
const e2e = !flags.has('--no-e2e')
const edge = flags.has('--edge')

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
  const app = await startApp({
    databaseUrl,
    logFile: LOG_FILE,
    port: process.env.VERIFY_PORT,
    // The test process is the "proxy": each suite sends its own X-Forwarded-For and so gets its own sign-in
    // rate-limit bucket. The server honors the header only from loopback/private peers.
    trustedIpHeader: 'x-forwarded-for',
    // Behind the edge the test process is a proxy in front of Caddy instead: Caddy believes its
    // X-Forwarded-For (it connects from loopback) and hands the resolved client IP to the app.
    ...(edge ? { edge: { trustedProxies: 'private_ranges', logFile: 'test-results/edge.log' } } : {}),
  })
  console.log(
    `app ${app.url}${edge ? ` (edge in front of ${app.directUrl})` : ''} (database ${new URL(databaseUrl).pathname.slice(1)}, log ${LOG_FILE})`,
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
    const stopped = await app.stop()
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
