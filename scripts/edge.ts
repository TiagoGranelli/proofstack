// Starts the reference edge (Caddy with deploy/Caddyfile) in front of an app on this machine, for
// `pnpm lighthouse` and the test servers with TEST_EDGE=1 (scripts/app-server.ts). Two ways to run it
// (EDGE_RUNTIME):
//   docker (default)  the pinned Caddy image. EDGE_DOCKER_NETWORK chooses how it reaches the app:
//                     host (default on Linux): --network host, so the app is on 127.0.0.1 and the edge listens
//                     on a host port; bridge (default on macOS and Windows, where Docker Desktop's host
//                     networking differs): Docker's default network with the ports published on 127.0.0.1,
//                     reaching the app at host.docker.internal.
//   binary            a `caddy` executable (CADDY_BIN, default `caddy` on PATH); the ci:local runner image
//                     ships the pinned one.
// With `tls`, the edge serves https://localhost:<port> with a certificate from Caddy's internal CA, over
// HTTP/2 and HTTP/3 as production does with a public certificate. This process then trusts that CA for its
// own requests, and `certificateSpki` lets a browser trust exactly the served key (scripts/edge-certificate.ts).
import { type ChildProcess, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readRootCertificate, servedCertificateSpki, trustCertificateAuthority } from './edge-certificate.ts'
import { dockerPrefix, IMAGES } from './images.ts'
import { spawnToLog } from './process-log.ts'
import { answersReady } from './server-process.ts'

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

type EdgeEnv = Record<'EDGE_ADDRESS' | 'EDGE_UPSTREAM' | 'EDGE_TRUSTED_PROXIES' | 'EDGE_HTTP_PORT', string>

const LOOPBACK = '127.0.0.1/32,::1/128'
/** How the edge reaches the app: from this machine (a binary, or a container on the host network), or through
 * Docker's bridge, from a container address the app cannot know in advance. */
type Reach = 'host' | 'bridge'

const reach = (): Reach => {
  if ((process.env.EDGE_RUNTIME ?? 'docker') !== 'docker') return 'host'
  const network = process.env.EDGE_DOCKER_NETWORK || (process.platform === 'linux' ? 'host' : 'bridge')
  if (network !== 'host' && network !== 'bridge')
    throw new Error(`EDGE_DOCKER_NETWORK must be host or bridge, not "${network}"`)
  return network
}

/**
 * TRUSTED_PROXIES for an app behind the edge: where the edge connects from. Loopback, or with the bridge network
 * any private address, because Docker picks the bridge's subnet (and Docker Desktop proxies through its VM).
 */
export const edgePeers = (): string =>
  reach() === 'host' ? LOOPBACK : `${LOOPBACK},10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`

type EdgeOptions = {
  /** Port the edge listens on (all interfaces, like the app). */
  port: string
  /** Port of the app on this machine; it must listen on every interface for the bridge network. */
  upstreamPort: string
  /** EDGE_TRUSTED_PROXIES, e.g. `private_ranges` when the test runner sends its own X-Forwarded-For. */
  trustedProxies?: string
  /**
   * Serve HTTPS (HTTP/2 and HTTP/3) for localhost with Caddy's internal CA. `httpPort` is where Caddy
   * redirects plain HTTP from (its default, 80, is privileged or taken on a workstation).
   */
  tls?: { httpPort: string }
  logFile: string
}

/** What deploy/Caddyfile reads from the environment. */
const edgeEnv = (options: EdgeOptions): EdgeEnv => ({
  EDGE_ADDRESS: options.tls ? `https://localhost:${options.port}` : `:${options.port}`,
  EDGE_UPSTREAM: `${reach() === 'host' ? '127.0.0.1' : 'host.docker.internal'}:${options.upstreamPort}`,
  EDGE_TRUSTED_PROXIES: options.trustedProxies ?? '',
  EDGE_HTTP_PORT: options.tls?.httpPort ?? '80',
})

const publish = (port: string) => [
  '--publish',
  `127.0.0.1:${port}:${port}`,
  '--publish',
  `127.0.0.1:${port}:${port}/udp`,
]

/** The container's network: the host's, or Docker's bridge with `ports` published on 127.0.0.1 (TCP and UDP). */
const containerNetwork = (ports: string[]): string[] => {
  if (reach() === 'host') return ['--network', 'host']
  // host.docker.internal is built into Docker Desktop; Docker Engine on Linux maps it with host-gateway.
  return ['--add-host', 'host.docker.internal:host-gateway', ...ports.flatMap((port) => publish(port))]
}

type CaddyContainer = { name: string; env: EdgeEnv; ports: string[] }

/** `docker run` arguments for the pinned Caddy image (pulled if missing): read-only, the Caddyfile mounted. */
const dockerRunCaddy = ({ name, env, ports }: CaddyContainer): string[] => {
  if (spawnSync('docker', ['image', 'inspect', IMAGES.caddy], { stdio: 'ignore' }).status !== 0)
    spawnSync('docker', ['pull', '--quiet', IMAGES.caddy], { stdio: 'inherit' })
  const sandbox = ['--memory', '256m', '--read-only', '--tmpfs', '/data', '--tmpfs', '/config']
  const envNames = Object.keys(env).flatMap((key) => ['--env', key])
  const caddyfile = ['--volume', `${CADDYFILE}:/etc/caddy/Caddyfile:ro`]
  const caddy = ['caddy', 'run', '--adapter', 'caddyfile', '--config', '/etc/caddy/Caddyfile']
  return ['run', '--rm', '--name', name, ...containerNetwork(ports), ...sandbox, ...envNames, ...caddyfile].concat([
    IMAGES.caddy,
    ...caddy,
  ])
}

/** How EDGE_RUNTIME runs Caddy: a local binary, or the pinned image. */
const edgeCommand = (runtime: string, container: CaddyContainer): { command: string; args: string[] } => {
  if (runtime === 'binary')
    return { command: process.env.CADDY_BIN || 'caddy', args: ['run', '--adapter', 'caddyfile', '--config', CADDYFILE] }
  if (runtime !== 'docker') throw new Error(`EDGE_RUNTIME must be docker or binary, not "${runtime}"`)
  return { command: 'docker', args: dockerRunCaddy(container) }
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

type LaunchedEdge = {
  child: ChildProcess
  command: string
  url: string
  logFile: string
  stop: () => Promise<void>
  /** With TLS: trusts the edge's CA, then hashes the served key. Throws until Caddy has made its certificate. */
  certificateSpki: (() => Promise<string>) | undefined
}

/** Where the binary keeps its CA and certificates (XDG_DATA_HOME); the container keeps them in its /data tmpfs. */
const binaryDirectories = (dataHome: string | undefined) =>
  dataHome ? { XDG_DATA_HOME: join(dataHome, 'data'), XDG_CONFIG_HOME: join(dataHome, 'config') } : {}

/** Trusts the CA of the edge (container `name`, or the binary's `dataHome`), then hashes the key it serves. */
const trustedCertificateSpki = async (name: string, dataHome: string | undefined, port: string) => {
  trustCertificateAuthority(readRootCertificate(name, dataHome))
  return servedCertificateSpki(port)
}

/** Starts Caddy the way EDGE_RUNTIME says, logging to `options.logFile`. It may not be listening yet. */
const launchEdge = (options: EdgeOptions): LaunchedEdge => {
  const runtime = process.env.EDGE_RUNTIME ?? 'docker'
  const name = `${dockerPrefix()}-edge-${process.pid}-${options.port}`
  const env = edgeEnv(options)
  const ports = [options.port, ...(options.tls ? [options.tls.httpPort] : [])]
  const { command, args } = edgeCommand(runtime, { name, env, ports })
  const dataHome = runtime === 'binary' ? mkdtempSync(join(tmpdir(), 'edge-')) : undefined
  const childEnv = { ...process.env, ...env, ...binaryDirectories(dataHome) }
  const child = spawnToLog(command, args, { env: childEnv, logFile: options.logFile })
  child.once('error', () => {})
  return {
    child,
    command,
    url: options.tls ? `https://localhost:${options.port}` : `http://localhost:${options.port}`,
    logFile: options.logFile,
    stop: edgeStopper(child, runtime === 'docker' ? name : undefined, dataHome),
    certificateSpki: options.tls ? () => trustedCertificateSpki(name, dataHome, options.port) : undefined,
  }
}

type EdgePoll = { ready: boolean; certificateSpki: string | undefined }

/** One attempt: with TLS the certificate first (kept once read), then /api/ready. */
const pollEdge = async (edge: LaunchedEdge, known: string | undefined): Promise<EdgePoll> => {
  const certificateSpki = known ?? (await edge.certificateSpki?.().catch(() => undefined))
  if (edge.certificateSpki && !certificateSpki) return { ready: false, certificateSpki }
  return { ready: await answersReady(edge.url), certificateSpki }
}

/** Polls for up to 30 s until the edge answers /api/ready. Throws at once if the edge exits. */
const waitForEdge = async (edge: LaunchedEdge): Promise<EdgePoll> => {
  let poll: EdgePoll = { ready: false, certificateSpki: undefined }
  for (let attempt = 0; attempt < 120; attempt++) {
    const exit = edge.child.exitCode ?? edge.child.signalCode
    if (exit !== null) throw new Error(`the edge (${edge.command}) exited with ${exit}; see ${edge.logFile}`)
    poll = await pollEdge(edge, poll.certificateSpki)
    if (poll.ready) return poll
    await new Promise((r) => setTimeout(r, 250))
  }
  return poll
}

export const startEdge = async (options: EdgeOptions): Promise<RunningEdge> => {
  const edge = launchEdge(options)
  const { ready, certificateSpki } = await waitForEdge(edge)
  if (ready) return { url: edge.url, certificateSpki, stop: edge.stop }
  await edge.stop()
  throw new Error(`the edge did not answer ${edge.url}/api/ready within 30 s; see ${options.logFile}`)
}
