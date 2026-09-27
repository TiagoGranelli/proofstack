// Starts the reference edge (Caddy with deploy/Caddyfile) in front of an app on this machine, for
// `pnpm lighthouse` and `pnpm verify:app --edge`. Two ways to run it (EDGE_RUNTIME):
//   docker (default)  the pinned Caddy image with --network host, so it reaches the app on 127.0.0.1 and
//                     listens on a host port (Linux; Docker Desktop's host networking differs).
//   binary            a `caddy` executable (CADDY_BIN, default `caddy` on PATH); the ci:local runner image
//                     ships the pinned one.
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { dockerPrefix, IMAGES } from './images.ts'

export type RunningEdge = { url: string; stop: () => Promise<void> }

const CADDYFILE = resolve('deploy/Caddyfile')

export const startEdge = async (options: {
  /** Port the edge listens on (all interfaces, like the app). */
  port: string
  /** Port of the app on 127.0.0.1. */
  upstreamPort: string
  /** EDGE_TRUSTED_PROXIES, e.g. `private_ranges` when the test runner sends its own X-Forwarded-For. */
  trustedProxies?: string
  logFile: string
}): Promise<RunningEdge> => {
  const env = {
    EDGE_ADDRESS: `:${options.port}`,
    EDGE_UPSTREAM: `127.0.0.1:${options.upstreamPort}`,
    EDGE_TRUSTED_PROXIES: options.trustedProxies ?? '',
  }
  const runtime = process.env.EDGE_RUNTIME ?? 'docker'
  const name = `${dockerPrefix()}-edge-${process.pid}-${options.port}`
  let command: string
  let args: string[]
  if (runtime === 'binary') {
    command = process.env.CADDY_BIN || 'caddy'
    args = ['run', '--adapter', 'caddyfile', '--config', CADDYFILE]
  } else if (runtime === 'docker') {
    command = 'docker'
    args = [
      'run',
      '--rm',
      '--name',
      name,
      '--network',
      'host',
      '--memory',
      '256m',
      '--read-only',
      '--tmpfs',
      '/data',
      '--tmpfs',
      '/config',
      ...Object.keys(env).flatMap((key) => ['--env', key]),
      '--volume',
      `${CADDYFILE}:/etc/caddy/Caddyfile:ro`,
      IMAGES.caddy,
      'caddy',
      'run',
      '--adapter',
      'caddyfile',
      '--config',
      '/etc/caddy/Caddyfile',
    ]
  } else throw new Error(`EDGE_RUNTIME must be docker or binary, not ${runtime}`)

  if (runtime === 'docker' && spawnSync('docker', ['image', 'inspect', IMAGES.caddy], { stdio: 'ignore' }).status !== 0)
    spawnSync('docker', ['pull', '--quiet', IMAGES.caddy], { stdio: 'inherit' })
  mkdirSync(dirname(options.logFile), { recursive: true })
  const log = openSync(options.logFile, 'w')
  const child = spawn(command, args, { stdio: ['ignore', log, log], env: { ...process.env, ...env } })
  closeSync(log)
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  child.once('error', () => {})
  // A crash of this process must not leave the container behind.
  const removeContainer = () => spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' })
  if (runtime === 'docker') process.once('exit', removeContainer)

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    if (runtime === 'docker') spawnSync('docker', ['stop', '--timeout', '5', name], { stdio: 'ignore' })
    else child.kill('SIGTERM')
    const killer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    await exited
    clearTimeout(killer)
    process.off('exit', removeContainer)
  }

  const url = `http://localhost:${options.port}`
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`the edge (${command}) exited with ${child.exitCode ?? child.signalCode}; see ${options.logFile}`)
    try {
      if ((await fetch(`${url}/api/ready`)).ok) return { url, stop }
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  await stop()
  throw new Error(`the edge did not answer /api/ready in 30 s; see ${options.logFile}`)
}
