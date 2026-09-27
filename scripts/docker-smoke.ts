// The production path end to end, with Docker only: builds the image (prerender included), runs the bundled
// migrator twice against a real Postgres (the second run must apply nothing), serves the app behind the
// reference edge (deploy/Caddyfile) on a private network, checks it through the edge, and stops it
// gracefully. Everything it starts is removed afterwards. CI's `docker` job and `pnpm ci:docker`.
// Usage: node scripts/docker-smoke.ts   (env: PROOFSTACK_DOCKER_PREFIX, KEEP_SMOKE_IMAGE=1)
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { dockerPrefix, IMAGES } from './images.ts'

const prefix = `${dockerPrefix()}-smoke-${process.pid}`
const IMAGE = `${dockerPrefix()}-app:smoke`
const NETWORK = prefix
const [DB, APP, EDGE] = ['db', 'app', 'edge'].map((role) => `${prefix}-${role}`) as [string, string, string]
const DATABASE_URL = 'postgres://proofstack:proofstack-smoke@db:5432/proofstack'
/** srvx drains in-flight requests for up to 5 s (SERVER_SHUTDOWN_TIMEOUT); an idle server stops at once. */
const MAX_STOP_MS = 5_000

const docker = (args: string[], options: { quiet?: boolean; allowFailure?: boolean } = {}) => {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0 && !options.allowFailure)
    throw new Error(
      `docker ${args.slice(0, 2).join(' ')} failed (${result.status ?? result.signal})\n${result.stderr ?? ''}`,
    )
  return (result.stdout ?? '').trim()
}

const step = async <T>(name: string, run: () => T | Promise<T>): Promise<T> => {
  const started = performance.now()
  console.log(`\n▶ ${name}`)
  const value = await run()
  console.log(`  done in ${((performance.now() - started) / 1000).toFixed(1)}s`)
  return value
}

const freePort = () =>
  new Promise<number>((done, reject) => {
    const probe = createServer().once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => done(port))
    })
  })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const running = (name: string) =>
  docker(['inspect', '--format', '{{.State.Running}}', name], { quiet: true }) === 'true'

const cleanup = () => {
  docker(['rm', '--force', '--volumes', APP, EDGE, DB], { quiet: true, allowFailure: true })
  docker(['network', 'rm', NETWORK], { quiet: true, allowFailure: true })
  if (process.env.KEEP_SMOKE_IMAGE !== '1') docker(['image', 'rm', IMAGE], { quiet: true, allowFailure: true })
}
process.once('SIGINT', () => {
  cleanup()
  process.exit(130)
})

let failed = false
try {
  await step(`build ${IMAGE}`, () =>
    spawnSync('docker', ['build', '--tag', IMAGE, '.'], { stdio: 'inherit' }).status === 0
      ? undefined
      : Promise.reject(new Error('docker build failed')),
  )

  await step('start Postgres', async () => {
    docker(['network', 'create', NETWORK], { quiet: true })
    docker(
      ['run', '--detach', '--name', DB, '--network', NETWORK, '--network-alias', 'db', '--memory', '512m']
        .concat(['--env', 'POSTGRES_USER=proofstack', '--env', 'POSTGRES_PASSWORD=proofstack-smoke'])
        .concat(['--env', 'POSTGRES_DB=proofstack', IMAGES.postgres]),
      { quiet: true },
    )
    for (let i = 0; i < 60; i++) {
      // -h forces TCP: the image's init phase answers on the socket before the real server is up.
      const ready = spawnSync('docker', ['exec', DB, 'pg_isready', '-h', '127.0.0.1', '-U', 'proofstack'], {
        stdio: 'ignore',
      })
      if (ready.status === 0) return
      await sleep(500)
    }
    throw new Error('Postgres did not become ready in 30 s')
  })

  await step('migrate twice (the second run must apply nothing)', () => {
    for (const run of [1, 2]) {
      const output = docker(
        ['run', '--rm', '--network', NETWORK, '--memory', '512m', '--env', `DATABASE_URL=${DATABASE_URL}`].concat([
          IMAGE,
          'node',
          '.output/migrate.mjs',
        ]),
        { quiet: true },
      )
      console.log(`  run ${run}: ${output}`)
      if (run === 2 && !output.includes('"applied":0')) throw new Error('the second migration run applied something')
    }
  })

  const port = await freePort()
  const origin = `http://localhost:${port}`
  await step(`serve behind the edge at ${origin}`, async () => {
    docker(
      ['run', '--detach', '--name', APP, '--network', NETWORK, '--network-alias', 'app', '--memory', '512m']
        .concat(['--env', `DATABASE_URL=${DATABASE_URL}`, '--env', `APP_URL=${origin}`])
        .concat(['--env', `BETTER_AUTH_SECRET=${randomBytes(32).toString('base64')}`])
        .concat(['--env', 'TRUSTED_IP_HEADER=x-real-ip', IMAGE]),
      { quiet: true },
    )
    docker(
      ['run', '--detach', '--name', EDGE, '--network', NETWORK, '--memory', '128m', '--read-only']
        .concat(['--tmpfs', '/data', '--tmpfs', '/config', '--publish', `127.0.0.1:${port}:8080`])
        .concat(['--volume', `${resolve('deploy/Caddyfile')}:/etc/caddy/Caddyfile:ro`, IMAGES.caddy]),
      { quiet: true },
    )
    for (let i = 0; i < 120; i++) {
      if (!running(APP)) throw new Error('the app container exited')
      if (!running(EDGE)) throw new Error('the edge container exited')
      const res = await fetch(`${origin}/api/ready`).catch(() => null)
      if (res?.ok) return
      await sleep(500)
    }
    throw new Error('the app did not become ready through the edge in 60 s')
  })

  await step('check pages through the edge', async () => {
    const problems: string[] = []
    for (const path of ['/', '/about', '/login', '/api/health']) {
      const res = await fetch(origin + path, { headers: { 'accept-encoding': 'gzip' } })
      await res.arrayBuffer()
      if (!res.ok) problems.push(`${path}: ${res.status}`)
    }
    const home = await fetch(origin, { headers: { 'accept-encoding': 'gzip' } })
    await home.arrayBuffer()
    if (home.headers.get('content-encoding') !== 'gzip') problems.push('/ is not compressed by the edge')
    if (home.headers.get('cache-control') !== 'private, no-cache')
      problems.push(`/ Cache-Control changed on the way: ${home.headers.get('cache-control')}`)
    if (problems.length) throw new Error(problems.join('; '))
  })

  await step('stop gracefully', () => {
    const started = performance.now()
    docker(['stop', APP], { quiet: true })
    const ms = Math.round(performance.now() - started)
    const code = docker(['inspect', '--format', '{{.State.ExitCode}}', APP], { quiet: true })
    console.log(`  docker stop took ${ms} ms, exit code ${code}`)
    if (code !== '0' || ms >= MAX_STOP_MS) throw new Error(`graceful stop failed: exit ${code} after ${ms} ms`)
  })
} catch (error) {
  failed = true
  console.error(`\nFAIL ${error instanceof Error ? error.message : String(error)}`)
} finally {
  for (const name of [APP, EDGE]) {
    const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8' })
    if (logs.status === 0 && (failed || name === APP))
      console.log(`\n--- ${name} logs ---\n${`${logs.stdout}${logs.stderr}`.trim()}`)
  }
  cleanup()
}
console.log(failed ? '\ndocker smoke test failed' : '\ndocker smoke test passed')
process.exitCode = failed ? 1 : 0
