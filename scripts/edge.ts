// Starts the reference edge (Caddy with deploy/Caddyfile) in front of an app on this machine, for
// `pnpm lighthouse` and `pnpm verify:app --edge`. Two ways to run it (EDGE_RUNTIME):
//   docker (default)  the pinned Caddy image with --network host, so it reaches the app on 127.0.0.1 and
//                     listens on a host port (Linux; Docker Desktop's host networking differs).
//   binary            a `caddy` executable (CADDY_BIN, default `caddy` on PATH); the ci:local runner image
//                     ships the pinned one.
// With `tls`, the edge serves https://localhost:<port> with a certificate from Caddy's internal CA, over
// HTTP/2 and HTTP/3 as production does with a public certificate. This process then trusts that CA for its
// own requests, and `certificateSpki` lets a browser trust exactly the served key.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { connect, getCACertificates, setDefaultCACertificates } from 'node:tls'
import { dockerPrefix, IMAGES } from './images.ts'

export type RunningEdge = {
  url: string
  /**
   * With `tls`: base64 SHA-256 of the served certificate's public key, for Chrome's
   * `--ignore-certificate-errors-spki-list` (trusts that one key, nothing else).
   */
  certificateSpki?: string
  stop: () => Promise<void>
}

const CADDYFILE = resolve('deploy/Caddyfile')
/** Caddy's internal root certificate, relative to its data directory. */
const ROOT_CERTIFICATE = 'caddy/pki/authorities/local/root.crt'

type EdgeEnv = Record<'EDGE_ADDRESS' | 'EDGE_UPSTREAM' | 'EDGE_TRUSTED_PROXIES' | 'EDGE_HTTP_PORT', string>

/** How EDGE_RUNTIME runs Caddy: a local binary, or the pinned image on the host network (pulled if missing). */
const edgeCommand = (runtime: string, container: string, env: EdgeEnv) => {
  if (runtime === 'binary')
    return { command: process.env.CADDY_BIN || 'caddy', args: ['run', '--adapter', 'caddyfile', '--config', CADDYFILE] }
  if (runtime !== 'docker') throw new Error(`EDGE_RUNTIME must be docker or binary, not ${runtime}`)
  if (spawnSync('docker', ['image', 'inspect', IMAGES.caddy], { stdio: 'ignore' }).status !== 0)
    spawnSync('docker', ['pull', '--quiet', IMAGES.caddy], { stdio: 'inherit' })
  const args = [
    'run',
    '--rm',
    '--name',
    container,
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
  return { command: 'docker', args }
}

/**
 * Stops the edge (SIGKILL after 10 s) and removes what it left: the container, or the binary's data directory.
 * The same cleanup runs if this process exits first.
 */
const edgeStopper = (child: ChildProcess, container: string | undefined, dataHome: string | undefined) => {
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  const cleanUp = () => {
    if (container) spawnSync('docker', ['rm', '--force', container], { stdio: 'ignore' })
    if (dataHome) rmSync(dataHome, { recursive: true, force: true })
  }
  process.once('exit', cleanUp)
  return async () => {
    if (child.exitCode === null && child.signalCode === null) {
      if (container) spawnSync('docker', ['stop', '--timeout', '5', container], { stdio: 'ignore' })
      else child.kill('SIGTERM')
      const killer = setTimeout(() => child.kill('SIGKILL'), 10_000)
      await exited
      clearTimeout(killer)
    }
    cleanUp()
    process.off('exit', cleanUp)
  }
}

/**
 * Polls for up to 30 s until the edge answers /api/ready. With `certificateSpki` (TLS), that runs first on every
 * attempt until it succeeds. Throws at once if the edge exits.
 */
const waitForEdge = async (edge: {
  child: ChildProcess
  command: string
  url: string
  logFile: string
  certificateSpki: (() => Promise<string>) | undefined
}) => {
  let certificateSpki: string | undefined
  for (let attempt = 0; attempt < 120; attempt++) {
    if (edge.child.exitCode !== null || edge.child.signalCode !== null)
      throw new Error(
        `the edge (${edge.command}) exited with ${edge.child.exitCode ?? edge.child.signalCode}; see ${edge.logFile}`,
      )
    try {
      certificateSpki ??= await edge.certificateSpki?.()
      if ((await fetch(`${edge.url}/api/ready`)).ok) return { ready: true, certificateSpki }
    } catch {
      // Not listening yet: try again below.
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return { ready: false, certificateSpki }
}

export const startEdge = async (options: {
  /** Port the edge listens on (all interfaces, like the app). */
  port: string
  /** Port of the app on 127.0.0.1. */
  upstreamPort: string
  /** EDGE_TRUSTED_PROXIES, e.g. `private_ranges` when the test runner sends its own X-Forwarded-For. */
  trustedProxies?: string
  /**
   * Serve HTTPS (HTTP/2 and HTTP/3) for localhost with Caddy's internal CA. `httpPort` is where Caddy
   * redirects plain HTTP from (its default, 80, is privileged or taken on a workstation).
   */
  tls?: { httpPort: string }
  logFile: string
}): Promise<RunningEdge> => {
  const env: EdgeEnv = {
    EDGE_ADDRESS: options.tls ? `https://localhost:${options.port}` : `:${options.port}`,
    EDGE_UPSTREAM: `127.0.0.1:${options.upstreamPort}`,
    EDGE_TRUSTED_PROXIES: options.trustedProxies ?? '',
    EDGE_HTTP_PORT: options.tls?.httpPort ?? '80',
  }
  const runtime = process.env.EDGE_RUNTIME ?? 'docker'
  const name = `${dockerPrefix()}-edge-${process.pid}-${options.port}`
  const { command, args } = edgeCommand(runtime, name, env)
  // The binary keeps its CA and certificates here (XDG_DATA_HOME); the container in its /data tmpfs.
  const dataHome = runtime === 'binary' ? mkdtempSync(join(tmpdir(), 'proofstack-edge-')) : undefined

  mkdirSync(dirname(options.logFile), { recursive: true })
  const log = openSync(options.logFile, 'w')
  const child = spawn(command, args, {
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      ...env,
      ...(dataHome ? { XDG_DATA_HOME: join(dataHome, 'data'), XDG_CONFIG_HOME: join(dataHome, 'config') } : {}),
    },
  })
  closeSync(log)
  child.once('error', () => {})
  const stop = edgeStopper(child, runtime === 'docker' ? name : undefined, dataHome)

  const url = options.tls ? `https://localhost:${options.port}` : `http://localhost:${options.port}`
  const { ready, certificateSpki } = await waitForEdge({
    child,
    command,
    url,
    logFile: options.logFile,
    certificateSpki: options.tls
      ? () => {
          trustCertificateAuthority(readRootCertificate(name, dataHome))
          return servedCertificateSpki(options.port)
        }
      : undefined,
  })
  if (ready) return { url, certificateSpki, stop }
  await stop()
  throw new Error(`the edge did not answer /api/ready in 30 s; see ${options.logFile}`)
}

/** Caddy's internal root certificate (PEM). Throws until Caddy has created it. */
const readRootCertificate = (container: string, dataHome: string | undefined) => {
  if (dataHome) {
    const path = join(dataHome, 'data', ROOT_CERTIFICATE)
    if (!existsSync(path)) throw new Error('no root certificate yet')
    return readFileSync(path, 'utf8')
  }
  const result = spawnSync('docker', ['exec', container, 'cat', `/data/${ROOT_CERTIFICATE}`], { encoding: 'utf8' })
  if (result.status !== 0 || !result.stdout.includes('BEGIN CERTIFICATE')) throw new Error('no root certificate yet')
  return result.stdout
}

/** Adds the edge's CA to the ones this process trusts (fetch included), keeping the system's. */
const trustCertificateAuthority = (pem: string) => {
  const current = getCACertificates('default')
  if (!current.includes(pem)) setDefaultCACertificates([...current, pem])
}

/** Base64 SHA-256 of the DER public key of the certificate the edge serves for localhost. */
const servedCertificateSpki = (port: string) =>
  new Promise<string>((resolveSpki, reject) => {
    const socket = connect({ host: '127.0.0.1', port: Number(port), servername: 'localhost' }, () => {
      const certificate = socket.getPeerX509Certificate()
      socket.end()
      if (!certificate) {
        reject(new Error('the edge sent no certificate'))
        return
      }
      resolveSpki(
        createHash('sha256')
          .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
          .digest('base64'),
      )
    }).once('error', reject)
  })
