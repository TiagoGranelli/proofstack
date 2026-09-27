// The two servers each test runner tests (the global setups in tests/integration and tests/e2e): the open one,
// with sign-up open and mail to Mailpit, and the shipped defaults next to it on the same database and accounts.
// Each is a startApp (scripts/app-server.ts).
import { LOOPBACK, type RunningApp, startApp } from './app-server.ts'
import { dropTestDatabase, testDatabaseUrl } from './test-db.ts'

type User = RunningApp['user']

/** What a test runner gets from its global setup (Vitest: `inject('servers')`; Playwright: the environment). */
export type TestServers = {
  /** AUTH_SIGN_UP=open, mail to Mailpit, loopback trusted as a proxy: each suite picks its client IP. */
  appUrl: string
  /** The shipped defaults on the same database: closed sign-up, and the test process not a trusted proxy. */
  closedAppUrl: string
  mailpitUrl: string
  databaseUrl: string
  /** The open server's SERVER_SETTINGS. */
  env: Record<string, string>
  user: User
  otherUser: User
}

type StartedTestServers = { servers: TestServers; stop: () => Promise<void> }

type Mail = { api: string; settings: { SMTP_URL: string; MAIL_FROM: string } }

/** Mailpit (`pnpm mail:up`): the open server sends account mail there, and the E2E tests read it back. */
const mailpit = async (): Promise<Mail> => {
  // MAILPIT_HOST is for runners where Mailpit is another container (`pnpm ci:local`).
  const host = process.env.MAILPIT_HOST || '127.0.0.1'
  const api = `http://${host}:${process.env.MAILPIT_HTTP_PORT || '54380'}`
  const ready = await fetch(`${api}/readyz`).catch(() => undefined)
  if (!ready?.ok)
    throw new Error(
      `Mailpit is not reachable at ${api}/readyz (${ready ? `status ${ready.status}` : 'no answer'}; expected 200). ` +
        'Start it with `pnpm mail:up`.',
    )
  const smtp = `smtp://${host}:${process.env.MAILPIT_SMTP_PORT || '54325'}`
  return { api, settings: { SMTP_URL: smtp, MAIL_FROM: 'App <no-reply@example.test>' } }
}

/** What scripts/create-user.ts and in-process server modules need to act on the app's database. */
const SERVER_SETTINGS = ['DATABASE_URL', 'APP_URL', 'BETTER_AUTH_SECRET', 'AUTH_SIGN_UP', 'SMTP_URL', 'MAIL_FROM']

/** Open sign-up, loopback trusted as a proxy; TEST_EDGE=1 puts the reference edge in front. */
const startOpenServer = (runner: string, databaseUrl: string, mail: Mail) =>
  startApp({
    databaseUrl,
    logFile: `test-results/app-server-${runner}.log`,
    trustedProxies: LOOPBACK,
    // Behind the edge the test process is a proxy in front of Caddy instead: Caddy believes its
    // X-Forwarded-For (it connects from loopback) and hands the resolved client IP to the app.
    ...(process.env.TEST_EDGE === '1'
      ? { edge: { trustedProxies: 'private_ranges', logFile: `test-results/edge-${runner}.log` } }
      : {}),
    settings: { AUTH_SIGN_UP: 'open', ...mail.settings },
  })

/** The shipped defaults next to `open`, on its database and accounts: closed sign-up, the tests not a proxy. */
const startClosedServer = (runner: string, open: RunningApp, mail: Mail) =>
  startApp({
    databaseUrl: open.databaseUrl,
    logFile: `test-results/app-server-${runner}-closed.log`,
    trustedProxies: '10.0.0.0/8',
    settings: { AUTH_SIGN_UP: 'closed', ...mail.settings },
    alongside: open,
  })

const handOver = (open: RunningApp, closed: RunningApp, mail: Mail): TestServers => ({
  appUrl: open.url,
  closedAppUrl: closed.url,
  mailpitUrl: mail.api,
  databaseUrl: open.databaseUrl,
  env: Object.fromEntries(SERVER_SETTINGS.map((name) => [name, open.env[name] ?? ''])),
  user: open.user,
  otherUser: open.otherUser,
})

/**
 * The two servers a test runner tests, on a fresh `app_<runner>_<pid>_test` database with two verified authors.
 * `stop` ends both and drops the database (KEEP_TEST_DB=1 keeps it). A run killed before `stop` (Vitest skips
 * its teardown on Ctrl-C) leaves the database behind, and the next run's sweep drops it (scripts/test-db.ts).
 */
export const startTestServers = async (runner: 'integration' | 'e2e'): Promise<StartedTestServers> => {
  const mail = await mailpit()
  const databaseUrl = testDatabaseUrl(runner)
  const running: RunningApp[] = []
  const stop = async () => {
    await Promise.all(running.map((app) => app.stop()))
    if (process.env.KEEP_TEST_DB !== '1') await dropTestDatabase(databaseUrl)
  }
  try {
    const open = await startOpenServer(runner, databaseUrl, mail)
    running.push(open)
    const closed = await startClosedServer(runner, open, mail)
    running.push(closed)
    return { servers: handOver(open, closed, mail), stop }
  } catch (error) {
    await stop()
    throw error
  }
}
