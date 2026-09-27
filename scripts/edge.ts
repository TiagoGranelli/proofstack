// Starts the reference edge (Caddy with deploy/Caddyfile) in front of an app on this machine, for
// `pnpm lighthouse` and `pnpm verify:app --edge`. Two ways to run it (EDGE_RUNTIME):
//   docker (default)  the pinned Caddy image with --network host, so it reaches the app on 127.0.0.1 and
//                     listens on a host port (Linux; Docker Desktop's host networking differs).
//   binary            a `caddy` executable (CADDY_BIN, default `caddy` on PATH); the ci:local runner image
//                     ships the pinned one.
// With `tls`, the edge serves https://localhost:<port> with a certificate from Caddy's internal CA, over
// HTTP/2 and HTTP/3 as production does with a public certificate. This process then trusts that CA for its
// own requests, and `certificateSpki` lets a browser trust exactly the served key.
import { spawn, spawnSync } from 'node:child_process'
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
  const env = {
    EDGE_ADDRESS: options.tls ? `https://localhost:${options.port}` : `:${options.port}`,
    EDGE_UPSTREAM: `127.0.0.1:${options.upstreamPort}`,
    EDGE_TRUSTED_PROXIES: options.trustedProxies ?? '',
    EDGE_HTTP_PORT: options.tls?.httpPort ?? '80',
  }
  const runtime = process.env.EDGE_RUNTIME ?? 'docker'
  const name = `${dockerPrefix()}-edge-${process.pid}-${options.port}`
  // The binary keeps its CA and certificates here (XDG_DATA_HOME); the container in its /data tmpfs.
  const dataHome = runtime === 'binary' ? mkdtempSync(join(tmpdir(), 'proofstack-edge-')) : undefined
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
  const child = spawn(command, args, {
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      ...env,
      ...(dataHome ? { XDG_DATA_HOME: join(dataHome, 'data'), XDG_CONFIG_HOME: join(dataHome, 'config') } : {}),
    },
  })
  closeSync(log)
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  child.once('error', () => {})
  // A crash of this process must not leave the container or the CA behind.
  const cleanUp = () => {
    if (runtime === 'docker') spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' })
    if (dataHome) rmSync(dataHome, { recursive: true, force: true })
  }
  process.once('exit', cleanUp)

  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      if (runtime === 'docker') spawnSync('docker', ['stop', '--timeout', '5', name], { stdio: 'ignore' })
      else child.kill('SIGTERM')
      const killer = setTimeout(() => child.kill('SIGKILL'), 10_000)
      await exited
      clearTimeout(killer)
    }
    cleanUp()
    process.off('exit', cleanUp)
  }

  const url = options.tls ? `https://localhost:${options.port}` : `http://localhost:${options.port}`
  let certificateSpki: string | undefined
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`the edge (${command}) exited with ${child.exitCode ?? child.signalCode}; see ${options.logFile}`)
    try {
      if (options.tls && !certificateSpki) {
        trustCertificateAuthority(readRootCertificate(name, dataHome))
        certificateSpki = await servedCertificateSpki(options.port)
      }
      if ((await fetch(`${url}/api/ready`)).ok) return { url, certificateSpki, stop }
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
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
      if (!certificate) return reject(new Error('the edge sent no certificate'))
      resolveSpki(
        createHash('sha256')
          .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
          .digest('base64'),
      )
    }).once('error', reject)
  })
