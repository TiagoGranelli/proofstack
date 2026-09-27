// Boots the built app (.output) against a fresh, migrated test database with two author accounts.
// Shared by scripts/verify-app.ts and scripts/lighthouse.ts. Server output goes to a log file.
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { resetTestDatabase } from './test-db.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

type User = { email: string; name: string; password: string }

export type RunningApp = {
  url: string
  env: NodeJS.ProcessEnv
  databaseUrl: string
  user: User
  otherUser: User
  logFile: string
  /** SIGTERM, then waits for the exit (SIGKILL after 10 s). Resolves with how long the shutdown took. */
  stop: () => Promise<{ ms: number; code: number | null; signal: NodeJS.Signals | null }>
}

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
    child.stdout.on('data', (chunk: Buffer) => (output += chunk))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk))
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

/**
 * Starts the built server on a free port against `databaseUrl`, which must name a *_test database: it is
 * dropped and recreated. Two accounts are created: `user` (the author the tests act as) and `otherUser`
 * (a second author for isolation checks). With `alongside`, the server shares that one's database, accounts
 * and secret instead, so a run can test two configurations (for example both sign-up policies) at once.
 */
export const startApp = async (options: {
  databaseUrl: string
  logFile: string
  port?: string
  /** TRUSTED_PROXIES for the server: trusting loopback lets each test suite pick its client IP (X-Forwarded-For). */
  trustedProxies?: string
  /** More server settings, such as AUTH_SIGN_UP, SMTP_URL and MAIL_FROM. */
  settings?: NodeJS.ProcessEnv
  alongside?: RunningApp
}): Promise<RunningApp> => {
  assertFreshBuild()
  const appPort = options.port ?? (await freePort())
  const url = `http://localhost:${appPort}`
  const { databaseUrl } = options
  const user = options.alongside?.user ?? { email: 'author@example.test', name: 'Test Author', password: password() }
  const otherUser = options.alongside?.otherUser ?? {
    email: 'other@example.test',
    name: 'Other Author',
    password: password(),
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    APP_URL: url,
    PORT: appPort,
    NODE_ENV: 'production',
    BETTER_AUTH_SECRET:
      options.alongside?.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET || crypto.randomUUID().repeat(2),
    TRUSTED_PROXIES: options.trustedProxies ?? '',
    ...options.settings,
  }

  if (!options.alongside) {
    await resetTestDatabase(databaseUrl)
    await Promise.all(
      [user, otherUser].map((u) =>
        runQuiet('node', ['scripts/create-user.ts', u.email, u.name], { ...env, PROOFSTACK_USER_PASSWORD: u.password }),
      ),
    )
  }

  mkdirSync(dirname(options.logFile), { recursive: true })
  const log = openSync(options.logFile, 'w')
  // srvx skips its graceful shutdown (drain, then Nitro's close hook) when CI or TEST is set, and GitHub
  // Actions sets CI=true. The server runs as it would in production; the test runners keep both variables.
  const { CI: _ci, TEST: _test, ...serverEnv } = env
  const server = spawn('node', ['.output/server/index.mjs'], { stdio: ['ignore', log, log], env: serverEnv })
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

  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`server exited with ${server.exitCode}. Log (${options.logFile}):\n${tail(options.logFile)}`)
    try {
      if ((await fetch(`${url}/api/ready`)).ok)
        return { url, env, databaseUrl, user, otherUser, logFile: options.logFile, stop }
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  await stop()
  throw new Error(`server did not become ready in 30 s. Log (${options.logFile}):\n${tail(options.logFile)}`)
}

/** Playwright's Chromium, or a clear instruction to install it. */
export const assertChromium = async () => {
  const { chromium } = await import('@playwright/test')
  const path = process.env.CHROME_PATH ?? chromium.executablePath()
  if (!existsSync(path))
    throw new Error(`Chromium for Playwright is not installed (${path}). Run: pnpm exec playwright install chromium`)
  return path
}
