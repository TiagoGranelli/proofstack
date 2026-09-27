// Boots the built app (.output) against a fresh, migrated test database with two author accounts.
// Shared by scripts/verify-app.ts and scripts/lighthouse.ts. Server output goes to a log file.
// With `edge`, the app sits behind the reference edge (deploy/Caddyfile, scripts/edge.ts) as in production:
// the returned url and APP_URL are the edge's, and the Node server trusts X-Forwarded-For only from the edge.
import { type ChildProcess, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { connect, createServer, type Socket } from 'node:net'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { edgePeers, type RunningEdge, startEdge } from './edge.ts'
import { resetTestDatabase } from './test-db.ts'

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
  port?: string
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
  const appPort = options.port ?? (await freePort())
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A raw HTTP/1.1 connection to the Node server, so a test controls when each byte of a request leaves. */
const rawConnection = async (directUrl: string) => {
  const socket: Socket = connect(Number(new URL(directUrl).port), '127.0.0.1')
  await new Promise((resolve, reject) => socket.once('connect', resolve).once('error', reject))
  let received = ''
  socket.on('data', (chunk: Buffer) => (received += chunk.toString()))
  const closed = new Promise<string>((resolve) => socket.once('close', () => resolve(received)))
  socket.on('error', () => {})
  return { socket, closed }
}

/**
 * Stops the server with SIGTERM while two requests show what a drain must handle, and returns how it stopped
 * with the problems found:
 * - A load balancer's request that arrives on an open connection right at SIGTERM: `/api/ready` must answer 503
 *   with `Connection: close`, so the balancer stops routing here and does not reuse the connection.
 * - A sign-in whose client disconnects just before SIGTERM: srvx's drain does not wait for its handler, which
 *   still hashes the password and writes a session. It must finish, logged as 499, before the pool closes.
 */
export const stopWhileDraining = async (app: RunningApp) => {
  const ready = await rawConnection(app.directUrl)
  // Headers begun but not ended: the connection is busy, so the drain does not close it as idle.
  ready.socket.write('GET /api/ready HTTP/1.1\r\nHost: localhost\r\n')
  const abandoned = await rawConnection(app.directUrl)
  const body = JSON.stringify({ email: app.user.email, password: app.user.password })
  abandoned.socket.write(
    [
      'POST /api/auth/sign-in/email HTTP/1.1',
      'Host: localhost',
      `Origin: ${app.url}`,
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(body)}`,
      // Its own rate-limit bucket (the server trusts this process, or the edge, as a proxy).
      'X-Forwarded-For: 198.51.100.99',
      '',
      body,
    ].join('\r\n'),
  )
  await sleep(10)
  abandoned.socket.destroy()
  const stopping = app.stop()
  // With an edge in front, stop() ends the edge first: wait until the server itself has the signal.
  for (let i = 0; i < 1000 && !readFileSync(app.logFile, 'utf8').includes('"msg":"draining"'); i++) await sleep(10)
  ready.socket.write('\r\n')
  const [response, stopped] = await Promise.all([ready.closed, stopping])
  const log = readFileSync(app.logFile, 'utf8').split('\n')
  const complete = log.findIndex((line) => line.includes('"shutdown complete"'))
  const signIn = log.findIndex((line) => line.includes('"/api/auth/sign-in/email"') && line.includes('"aborted":true'))
  const problems = [
    response.startsWith('HTTP/1.1 503 ')
      ? ''
      : `/api/ready during the drain answered ${JSON.stringify(response.split('\r\n', 1)[0])}, expected 503`,
    /^connection: close\r$/im.test(response) ? '' : '/api/ready during the drain did not close its connection',
    signIn !== -1 && signIn < complete
      ? ''
      : 'the abandoned sign-in was not logged (499, aborted) before "shutdown complete"',
    ...log
      .filter((line) => /Failed query|Cannot use a pool after calling end/.test(line))
      .map((line) => `during shutdown: ${line.slice(0, 200)}`),
  ].filter(Boolean)
  return { stopped, problems }
}
