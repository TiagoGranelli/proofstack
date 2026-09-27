// Boots the built app (.output) against a fresh, migrated test database with two author accounts. Shared by the
// test runners' global setups (startTestServers, scripts/test-servers.ts), the integration tests that need a
// server of their own, and scripts/lighthouse.ts. Server output goes to a log file.
// With `edge`, the app sits behind the reference edge (deploy/Caddyfile, scripts/edge.ts) as in production:
// the returned url and APP_URL are the edge's, and the Node server trusts X-Forwarded-For only from the edge.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { assertFreshBuild } from './build-freshness.ts'
import { edgePeers, type RunningEdge, startEdge } from './edge.ts'
import { type ServerProcess, spawnServer, waitForServer } from './server-process.ts'
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
  /** Stops the edge, then the server (ServerProcess.stop), and says how the server exited. */
  stop: ServerProcess['stop']
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
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(' ')} failed (exit ${code}, expected 0)\n${output.trim()}`)),
    )
  })

type EdgeOptions = {
  trustedProxies?: string
  logFile: string
  /** HTTPS with HTTP/2 and HTTP/3, as in production (Caddy's internal CA; see scripts/edge.ts). */
  tls?: boolean
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
  edge?: EdgeOptions
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

/** Where the app listens, and where its users reach it: the edge's port when there is one. */
type Ports = { app: string; edge?: string; url: string; directUrl: string }

const choosePorts = async (edge: EdgeOptions | undefined): Promise<Ports> => {
  const app = await freePort()
  const directUrl = `http://localhost:${app}`
  if (!edge) return { app, url: directUrl, directUrl }
  const port = await freePort()
  return { app, edge: port, url: `${edge.tls ? 'https' : 'http'}://localhost:${port}`, directUrl }
}

/** The server's environment: this process's, the app's origin and database, and `settings` last. */
const serverEnv = (options: StartAppOptions, ports: Ports): NodeJS.ProcessEnv => ({
  ...process.env,
  DATABASE_URL: options.databaseUrl,
  APP_URL: ports.url,
  PORT: ports.app,
  NODE_ENV: 'production',
  BETTER_AUTH_SECRET:
    options.alongside?.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET || crypto.randomUUID().repeat(2),
  TRUSTED_PROXIES: options.edge ? edgePeers() : (options.trustedProxies ?? ''),
  ...options.settings,
})

/** Starts the edge on `ports.edge` in front of the app, once the app is ready. */
const startEdgeInFront = async (edge: EdgeOptions, ports: Ports & { edge: string }): Promise<RunningEdge> =>
  startEdge({
    port: ports.edge,
    upstreamPort: ports.app,
    trustedProxies: edge.trustedProxies,
    ...(edge.tls ? { tls: { httpPort: await freePort() } } : {}),
    logFile: edge.logFile,
  })

/** Waits for the server, then starts the edge if asked; stops whatever started if either fails. */
const startServing = async (options: StartAppOptions, ports: Ports, server: ServerProcess) => {
  let edge: RunningEdge | undefined
  const stop = async () => {
    await edge?.stop()
    return server.stop()
  }
  try {
    await waitForServer(server.child, ports.directUrl, options.logFile)
    if (options.edge && ports.edge) edge = await startEdgeInFront(options.edge, { ...ports, edge: ports.edge })
  } catch (error) {
    await stop()
    throw error
  }
  return { edgeCertificateSpki: edge?.certificateSpki, stop }
}

/**
 * Starts the built server on a free port against `databaseUrl`, which must name a *_test database: it is
 * dropped and recreated. Two accounts are created: `user` (the author the tests act as) and `otherUser`
 * (a second author for isolation checks). With `alongside`, the server shares that one's database, accounts
 * and secret instead, so a run can test two configurations (for example both sign-up policies) at once.
 */
export const startApp = async (options: StartAppOptions): Promise<RunningApp> => {
  assertFreshBuild()
  const ports = await choosePorts(options.edge)
  const { user, otherUser } = accounts(options.alongside)
  const env = serverEnv(options, ports)
  if (!options.alongside) await seedDatabase(options.databaseUrl, env, [user, otherUser])
  const { edgeCertificateSpki, stop } = await startServing(options, ports, spawnServer(env, options.logFile))
  const { url, directUrl } = ports
  const { databaseUrl, logFile } = options
  return { url, directUrl, edgeCertificateSpki, env, databaseUrl, user, otherUser, logFile, stop }
}
