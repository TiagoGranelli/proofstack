// The production path end to end with Docker only, through the adopters' own recipe: deploy/compose.production.yaml
// plus compose.smoke.yaml (PgBouncer in transaction mode, the image built here, ephemeral ports). It builds the image
// (prerender included), scans it with grype, runs the bundled migrator three times at once through the pooler
// (exactly one run applies the migrations) and once directly (it must apply nothing), creates the first account with
// the bundled create-user, brings the stack up, checks it through the edge (pages, then signing in as that account)
// and stops the app gracefully. `down -v` removes everything it started, except grype's database volume.
// CI's `docker` job and `pnpm ci:docker`.
// Usage: node scripts/docker-smoke.ts   (env: CI_DOCKER_PREFIX, KEEP_SMOKE_IMAGE=1)
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { dockerPrefix, IMAGES } from './images.ts'

const PROJECT = `${dockerPrefix()}-smoke-${process.pid}`
const IMAGE = `${PROJECT}-app:smoke`
/** grype's vulnerability database, kept between runs (about 200 MB; `docker volume rm` to reclaim). */
const GRYPE_DB = `${dockerPrefix()}-grype-db`
/** APP_URL in compose.smoke.yaml: the origin the checks send, whatever port Docker published. */
const ORIGIN = 'http://localhost:8080'
const MIGRATIONS = (JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: unknown[] }).entries
  .length
/**
 * Below Docker's default stop timeout (10 s), after which a stop is a kill. srvx drains in-flight requests for up
 * to 5 s (SERVER_SHUTDOWN_TIMEOUT) and then exits even if a timer is still pending. One is, today: rendering a
 * form page on the server starts the connect loop of TanStack Form's devtools event client
 * (@tanstack/devtools-event-client, `startConnectLoop`), which outlives the shutdown, so the stop takes about 5 s
 * instead of 1 s after /login has been served. The client ships in production builds (TanStack/form#2132); once it
 * no longer does, lower this bound to about 2 s so a slower shutdown shows.
 */
const MAX_STOP_MS = 8_000

const secret = () => randomBytes(24).toString('hex')
/** What compose.production.yaml interpolates (deploy.env on a real server). */
const env = {
  ...process.env,
  APP_IMAGE: IMAGE,
  DOMAIN: 'localhost',
  POSTGRES_PASSWORD: secret(),
  APP_DB_PASSWORD: secret(),
  BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
}
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'deploy/compose.production.yaml', '-f', 'compose.smoke.yaml']

/** `docker compose <args>` on the smoke project; returns stdout, throws with stderr when it fails. */
const compose = (args: string[], input?: string) => {
  const run = spawnSync('docker', [...COMPOSE, ...args], { env, input, encoding: 'utf8', maxBuffer: 64 * 2 ** 20 })
  if (run.status !== 0)
    throw new Error(
      `docker compose ${args.join(' ')} failed (exit ${run.status ?? run.signal}, expected 0)\n${run.stderr}`,
    )
  return run.stdout.trim()
}

/** `docker compose <args>` without blocking, for runs that must overlap. Resolves with stdout. */
const composeAsync = (args: string[]) =>
  new Promise<string>((done, reject) => {
    const child = spawn('docker', [...COMPOSE, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let [stdout, stderr] = ['', '']
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? done(stdout.trim())
        : reject(new Error(`docker compose ${args.join(' ')} failed (exit ${code}, expected 0)\n${stderr}`)),
    )
  })

const step = async <T>(name: string, run: () => T | Promise<T>): Promise<T> => {
  const started = performance.now()
  console.log(`\n▶ ${name}`)
  const value = await run()
  console.log(`  done in ${((performance.now() - started) / 1000).toFixed(1)}s`)
  return value
}

/**
 * grype over the built image, from the Docker daemon: a high or critical vulnerability with a released fix
 * fails, unless an ignore rule in .grype.yaml gives the reason it does not apply. Returns grype's exit code.
 */
const scanImage = () =>
  spawnSync(
    'docker',
    ['run', '--rm', '--memory', '2g', '--volume', '/var/run/docker.sock:/var/run/docker.sock']
      .concat(['--volume', `${GRYPE_DB}:/grype-db`, '--env', 'GRYPE_DB_CACHE_DIR=/grype-db'])
      .concat(['--volume', `${resolve('.grype.yaml')}:/grype.yaml:ro`, IMAGES.grype, `docker:${IMAGE}`])
      .concat(['--only-fixed', '--fail-on', 'high', '--config', '/grype.yaml']),
    { stdio: 'inherit' },
  ).status

/** The `applied` count of the migrator's last log line. */
const appliedBy = (output: string) => {
  const last = JSON.parse(output.split('\n').at(-1) ?? '{}') as { msg?: string; applied?: number }
  if (last.msg !== 'migrations applied')
    throw new Error(`the migrator's last log line is not {"msg":"migrations applied",...}. Its output:\n${output}`)
  return last.applied
}

/** One run of the image's migrator (the `migrate` service), with `env` (NAME=value) on top of its own. */
const migrateOnce = (...overrides: string[]) =>
  composeAsync(['run', '--rm', '--no-deps', ...overrides.flatMap((e) => ['--env', e]), 'migrate'])

/** Three runs at once through the pooler: exactly one applies the migrations. */
const migrateConcurrently = async () => {
  const outputs = await Promise.all([1, 2, 3].map(() => migrateOnce()))
  for (const output of outputs) console.log(`  pooled: ${output}`)
  const applied = outputs.map((output) => appliedBy(output)).toSorted((a, b) => (a ?? 0) - (b ?? 0))
  if (applied.join() !== `0,0,${MIGRATIONS}`)
    throw new Error(`expected one run to apply ${MIGRATIONS} migrations and two to apply none, got ${applied.join()}`)
}

/** MIGRATION_DATABASE_URL (direct) wins over DATABASE_URL (the pooler), and finds nothing to do. */
const migrateDirectly = async () => {
  const direct = await migrateOnce(`MIGRATION_DATABASE_URL=postgres://app:${env.APP_DB_PASSWORD}@db:5432/app`)
  console.log(`  direct: ${direct}`)
  const applied = appliedBy(direct)
  if (applied !== 0) throw new Error(`the direct run applied ${applied} migration(s), expected 0`)
  const query = "select count(*) from pg_locks where locktype = 'advisory'"
  const locks = compose(['exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'app', '-Atc', query])
  if (locks !== '0') throw new Error(`${locks} advisory lock(s) left behind on the pooler's server connections`)
}

const account = { email: 'first@example.test', password: randomBytes(18).toString('base64url') }

/** The bundled create-user in the app's container, through the pooler, the password on stdin. */
const createFirstAccount = () => {
  const command = ['node', '.output/create-user.mjs', account.email, 'First User']
  console.log(`  ${compose(['run', '--rm', '--no-deps', '-T', 'app', ...command], `${account.password}\n`)}`)
}

const checkPages = async (base: string) => {
  const problems: string[] = []
  for (const path of ['/', '/about', '/login', '/api/health']) {
    const res = await fetch(base + path, { headers: { 'accept-encoding': 'gzip' } })
    await res.arrayBuffer()
    if (!res.ok) problems.push(`${path}: ${res.status}`)
  }
  const home = await fetch(base, { headers: { 'accept-encoding': 'gzip' } })
  await home.arrayBuffer()
  const encoding = home.headers.get('content-encoding')
  if (encoding !== 'gzip')
    problems.push(`/ is not compressed by the edge (Content-Encoding ${encoding}, expected gzip)`)
  if (home.headers.get('cache-control') !== 'private, no-cache')
    problems.push(
      `/ Cache-Control changed on the way: ${home.headers.get('cache-control')}, expected private, no-cache`,
    )
  if (problems.length) throw new Error(problems.join('; '))
}

const signInAndReadPosts = async (base: string) => {
  const signIn = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(account),
  })
  await signIn.arrayBuffer()
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(';', 1)[0])
    .join('; ')
  if (!signIn.ok || !cookie)
    throw new Error(`sign-in answered ${signIn.status} ${cookie ? 'with' : 'without'} a cookie, expected 200 with one`)
  const posts = await fetch(`${base}/api/me/posts`, { headers: { cookie } })
  const body = (await posts.json()) as { items?: unknown[] }
  if (!posts.ok || !Array.isArray(body.items))
    throw new Error(`GET /api/me/posts answered ${posts.status}, expected 200 with an \`items\` array`)
}

const checkPermissionModel = () => {
  const logs = compose(['logs', '--no-log-prefix', 'app'])
  if (logs.includes('"permissionModel":true')) return
  const starting = logs.split('\n').find((line) => line.includes('"msg":"starting"')) ?? '(no such line)'
  throw new Error(`the "starting" log line does not say "permissionModel":true: ${starting}`)
}

const stopGracefully = () => {
  const started = performance.now()
  compose(['stop', 'app'])
  const ms = Math.round(performance.now() - started)
  const code = compose(['ps', '--all', '--format', '{{.ExitCode}}', 'app'])
  console.log(`  docker compose stop took ${ms} ms, exit code ${code}`)
  if (code !== '0' || ms >= MAX_STOP_MS) throw new Error(`graceful stop failed: exit ${code} after ${ms} ms`)
}

const cleanup = () => {
  spawnSync('docker', [...COMPOSE, 'down', '--volumes', '--remove-orphans'], { env, stdio: 'ignore' })
  if (process.env.KEEP_SMOKE_IMAGE !== '1') spawnSync('docker', ['image', 'rm', IMAGE], { stdio: 'ignore' })
}
process.once('SIGINT', () => {
  cleanup()
  process.exit(130)
})

let failed = false
let scanStatus: number | null = 0
try {
  await step(`build ${IMAGE}`, () => compose(['build', 'migrate']))
  // Reported now, failed at the end: the rest of the smoke test still runs.
  scanStatus = await step('scan the image for fixable vulnerabilities (grype)', scanImage)
  await step('start Postgres and PgBouncer (transaction mode)', () => compose(['up', '--detach', '--wait', 'pooler']))
  await step('migrate: three runs at once through the pooler', migrateConcurrently)
  await step('migrate: one direct run, which applies nothing', migrateDirectly)
  await step('create the first account with the bundled create-user', createFirstAccount)
  await step('bring the stack up (migrate, app, edge)', () => compose(['up', '--detach', '--wait']))
  const base = `http://${compose(['port', 'edge', '8080'])}`
  await step(`check pages through the edge at ${base}`, () => checkPages(base))
  await step('sign in as the first account through the edge and read its posts', () => signInAndReadPosts(base))
  await step("check that the server runs under Node's permission model", checkPermissionModel)
  await step('stop the app gracefully', stopGracefully)
} catch (error) {
  failed = true
  console.error(`\nFAIL ${error instanceof Error ? error.message : String(error)}`)
} finally {
  const logs = spawnSync('docker', [...COMPOSE, 'logs', '--no-color', ...(failed ? [] : ['app'])], {
    env,
    encoding: 'utf8',
  })
  console.log(`\n--- ${failed ? 'every service' : 'app'} logs ---\n${`${logs.stdout}${logs.stderr}`.trim()}`)
  cleanup()
}
if (scanStatus !== 0) {
  failed = true
  console.error(
    `\nFAIL image scan (grype exit ${scanStatus}). Move to a base image digest with the fix (Renovate proposes it; ` +
      'by hand, the digest in scripts/images.ts and every copy `pnpm ci:workflows` lists), or add an ignore rule ' +
      'with its reason and a review date to .grype.yaml.',
  )
}
console.log(failed ? '\ndocker smoke test failed' : '\ndocker smoke test passed')
process.exitCode = failed ? 1 : 0
