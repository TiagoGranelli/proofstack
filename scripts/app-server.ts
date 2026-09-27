// Boots the built app (.output) against a fresh, migrated test database with two author accounts. Shared by the
// test runners' global setups (startTestServers), the integration tests that need a server of their own, and
// scripts/lighthouse.ts. Server output goes to a log file.
// With `edge`, the app sits behind the reference edge (deploy/Caddyfile, scripts/edge.ts) as in production:
// the returned url and APP_URL are the edge's, and the Node server trusts X-Forwarded-For only from the edge.
import { type ChildProcess, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { edgePeers, type RunningEdge, startEdge } from './edge.ts'
import { dropTestDatabase, resetTestDatabase, testDatabaseUrl } from './test-db.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

type User = { email: string; name: string; password: string }

export type RunningApp = {
  /** The public origin (APP_URL): the edge's when there is one, otherwise the Node server's. */
  url: string
  /** The Node server itself, bypassing the edge. */
  directUrl: string
  /** With `edge.tls`: the SPKI hash of the edge's certificate, for Chrome (see scripts/edge.ts). */
  edgeCertificateSpki?: string
  env: NodeJS.ProcessEnv
  databaseUrl: string
  user: User
  otherUser: User
  logFile: string
  /** SIGTERM, then waits for the exit (SIGKILL after 10 s). Resolves with how long the shutdown took. */
  stop: () => Promise<{ ms: number; code: number | null; signal: NodeJS.Signals | null }>
}

/** Where the test runners connect from when no edge sits in front. */
export const LOOPBACK = '127.0.0.1/32,::1/128'

const password = () => `pw-${crypto.randomUUID()}`

const freePort = () =>
  new Promise<string>((resolve, reject) => {
    const probe = createServer().once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(String(port)))
    })
  })

/** Runs a command with its output captured; the output is printed only if it fails. */
const runQuiet = (command: string, args: string[], env: NodeJS.ProcessEnv) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} failed (${code})\n${output.trim()}`)),
    )
  })

/** Last lines of a log file, for failure messages. */
export const tail = (file: string, lines = 60) =>
  existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n') : '(no log)'

// Everything the build reads. drizzle/ is not built in (migrations are applied from the folder).
const BUILD_INPUTS = ['src', 'public', 'vite.config.ts', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json']

const newestInput = (): { path: string; mtime: number } => {
  let newest = { path: '', mtime: 0 }
  const visit = (path: string) => {
    if (!existsSync(path)) return
    const stat = statSync(path)
    if (stat.isDirectory()) for (const entry of readdirSync(path)) visit(join(path, entry))
    else if (stat.mtimeMs > newest.mtime) newest = { path, mtime: stat.mtimeMs }
  }
  for (const input of BUILD_INPUTS) visit(input)
  return newest
}

/** Refuses to test a build older than its sources. ALLOW_STALE_BUILD=1 skips this (CI downloads a fresh one). */
const assertFreshBuild = () => {
  if (!existsSync('.output/server/index.mjs') || !existsSync('.output/nitro.json'))
    throw new Error('No build found in .output. Run `pnpm build` first.')
  if (process.env.ALLOW_STALE_BUILD === '1') return
  const built = statSync('.output/nitro.json').mtimeMs
  const newest = newestInput()
  if (newest.mtime > built)
    throw new Error(
      `.output is older than ${newest.path} (built ${new Date(built).toISOString()}). Run \`pnpm build\` first ` +
        '(or set ALLOW_STALE_BUILD=1 to test the old build anyway).',
    )
}

type StartAppOptions = {
  databaseUrl: string
  logFile: string
  /**
   * TRUSTED_PROXIES for the server: trusting loopback lets each test suite pick its client IP (X-Forwarded-For).
   * Ignored with `edge`: the server then trusts only the edge (`edgePeers`, scripts/edge.ts).
   */
  trustedProxies?: string
  /** More server settings, such as AUTH_SIGN_UP, SMTP_URL and MAIL_FROM. */
  settings?: NodeJS.ProcessEnv
  /** Share this running app's database, accounts and secret instead of resetting the database. */
  alongside?: RunningApp
  /**
   * Put the reference edge in front. `trustedProxies` becomes the edge's EDGE_TRUSTED_PROXIES: the test
   * runners send their own X-Forwarded-For per suite, so they pass `private_ranges`. The edge replaces
   * X-Forwarded-For with the client IP it resolved, and the server trusts only the edge (`edgePeers`).
   */
  edge?: {
    trustedProxies?: string
    logFile: string
    /** HTTPS with HTTP/2 and HTTP/3, as in production (Caddy's internal CA; see scripts/edge.ts). */
    tls?: boolean
  }
}

/** The two authors, new ones with random passwords unless the app shares another one's accounts. */
const accounts = (alongside: RunningApp | undefined) => ({
  user: alongside?.user ?? { email: 'author@example.test', name: 'Test Author', password: password() },
  otherUser: alongside?.otherUser ?? { email: 'other@example.test', name: 'Other Author', password: password() },
})

/** Resets the test database (migrations included) and creates the accounts, verified. */
const seedDatabase = async (databaseUrl: string, env: NodeJS.ProcessEnv, users: User[]) => {
  await resetTestDatabase(databaseUrl)
  await Promise.all(
    users.map((u) =>
      runQuiet('node', ['scripts/create-user.ts', u.email, u.name], { ...env, CREATE_USER_PASSWORD: u.password }),
    ),
  )
}

/**
 * The production image's flags (Dockerfile CMD, docs/decisions/0012-node-permission-model.md), so every test runs
 * the server under Node's permission model: it may read its bundle and use the network, nothing else.
 */
const SERVER_FLAGS = [
  '--permission',
  `--allow-fs-read=${resolvePath('.output')}`,
  '--allow-net',
  '--disable-warning=ExperimentalWarning',
]

/** Starts the built server, logging to `logFile`. `stop` ends it (SIGKILL after 10 s) and says how it exited. */
const spawnServer = (env: NodeJS.ProcessEnv, logFile: string) => {
  mkdirSync(dirname(logFile), { recursive: true })
  const log = openSync(logFile, 'w')
  // srvx skips its graceful shutdown (drain, then Nitro's close hook) when CI or TEST is set, and GitHub
  // Actions sets CI=true. The server runs as it would in production; the test runners keep both variables.
  const { CI: _ci, TEST: _test, ...serverEnv } = env
  const server = spawn(process.execPath, [...SERVER_FLAGS, '.output/server/index.mjs'], {
    stdio: ['ignore', log, log],
    env: serverEnv,
  })
  closeSync(log)
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    server.once('exit', (code, signal) => resolve({ code, signal })),
  )
  const stop = async () => {
    const started = performance.now()
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM')
      const killer = setTimeout(() => server.kill('SIGKILL'), 10_000)
      await exited
      clearTimeout(killer)
    }
    return { ms: Math.round(performance.now() - started), ...(await exited) }
  }
  return { server, stop }
}

/** Polls /api/ready for up to 30 s; fails at once, with the log's tail, if the server exits. */
const waitForServer = async (server: ChildProcess, directUrl: string, logFile: string) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`server exited with ${server.exitCode}. Log (${logFile}):\n${tail(logFile)}`)
    try {
      if ((await fetch(`${directUrl}/api/ready`)).ok) return
    } catch {
      // Not listening yet: try again below.
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`server did not become ready in 30 s. Log (${logFile}):\n${tail(logFile)}`)
}

/**
 * Starts the built server on a free port against `databaseUrl`, which must name a *_test database: it is
 * dropped and recreated. Two accounts are created: `user` (the author the tests act as) and `otherUser`
 * (a second author for isolation checks). With `alongside`, the server shares that one's database, accounts
 * and secret instead, so a run can test two configurations (for example both sign-up policies) at once.
 */
export const startApp = async (options: StartAppOptions): Promise<RunningApp> => {
  assertFreshBuild()
  const appPort = await freePort()
  const directUrl = `http://localhost:${appPort}`
  const edgePort = options.edge ? await freePort() : undefined
  const url = edgePort ? `${options.edge?.tls ? 'https' : 'http'}://localhost:${edgePort}` : directUrl
  const { databaseUrl } = options
  const { user, otherUser } = accounts(options.alongside)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    APP_URL: url,
    PORT: appPort,
    NODE_ENV: 'production',
    BETTER_AUTH_SECRET:
      options.alongside?.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET || crypto.randomUUID().repeat(2),
    TRUSTED_PROXIES: options.edge ? edgePeers() : (options.trustedProxies ?? ''),
    ...options.settings,
  }
  if (!options.alongside) await seedDatabase(databaseUrl, env, [user, otherUser])

  const server = spawnServer(env, options.logFile)
  let edge: RunningEdge | undefined
  const stop = async () => {
    await edge?.stop()
    return server.stop()
  }
  try {
    await waitForServer(server.server, directUrl, options.logFile)
    if (options.edge && edgePort) {
      edge = await startEdge({
        port: edgePort,
        upstreamPort: appPort,
        trustedProxies: options.edge.trustedProxies,
        ...(options.edge.tls ? { tls: { httpPort: await freePort() } } : {}),
        logFile: options.edge.logFile,
      })
    }
  } catch (error) {
    await stop()
    throw error
  }
  const edgeCertificateSpki = edge?.certificateSpki
  return { url, directUrl, edgeCertificateSpki, env, databaseUrl, user, otherUser, logFile: options.logFile, stop }
}

/** Playwright's Chromium, or a clear instruction to install it. */
export const assertChromium = async () => {
  const { chromium } = await import('@playwright/test')
  const path = process.env.CHROME_PATH ?? chromium.executablePath()
  if (!existsSync(path))
    throw new Error(`Chromium for Playwright is not installed (${path}). Run: pnpm exec playwright install chromium`)
  return path
}

/** Mailpit (`pnpm mail:up`): the open server sends account mail there, and the E2E tests read it back. */
const mailpit = async () => {
  // MAILPIT_HOST is for runners where Mailpit is another container (`pnpm ci:local`).
  const host = process.env.MAILPIT_HOST || '127.0.0.1'
  const api = `http://${host}:${process.env.MAILPIT_HTTP_PORT || '54380'}`
  const ready = await fetch(`${api}/readyz`).catch(() => undefined)
  if (!ready?.ok) throw new Error(`Mailpit is not reachable at ${api}/readyz. Start it with \`pnpm mail:up\`.`)
  const smtp = `smtp://${host}:${process.env.MAILPIT_SMTP_PORT || '54325'}`
  return { api, settings: { SMTP_URL: smtp, MAIL_FROM: 'App <no-reply@example.test>' } }
}

/** What scripts/create-user.ts and in-process server modules need to act on the app's database. */
const SERVER_SETTINGS = ['DATABASE_URL', 'APP_URL', 'BETTER_AUTH_SECRET', 'AUTH_SIGN_UP', 'SMTP_URL', 'MAIL_FROM']

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

type Mail = Awaited<ReturnType<typeof mailpit>>

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
export const startTestServers = async (runner: 'integration' | 'e2e') => {
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
