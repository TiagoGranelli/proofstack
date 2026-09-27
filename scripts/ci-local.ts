// The faithful local CI: runs the same `pnpm ci:<job>` scripts as .github/workflows/ci.yml inside the
// official Playwright Ubuntu image (all five browser projects work there, WebKit included), next to a
// Postgres 18.6 container and Mailpit on a private Docker network, with CPU, memory and /dev/shm limits.
// Usage: pnpm ci:local [job ...]   (default: every job, in CI order)
//   Container jobs: static drift build verify lighthouse. Host jobs (they drive Docker): workflows docker.
//   verify and lighthouse need build, which is added when missing (CI's `needs: build`).
// Env: CI_LOCAL_CPUS (default 4, a GitHub-hosted runner), CI_LOCAL_MEMORY (6g), CI_LOCAL_SHM (2g),
//      PROOFSTACK_DOCKER_PREFIX (default proofstack-ci) names every container, network, image and volume.
//
// The repository is mounted read-only. The container gets a copy of what a CI checkout would contain
// (tracked files plus untracked, non-ignored ones, as they are on disk) and installs its own node_modules
// with `pnpm install --frozen-lockfile`, so the host's node_modules and .output are never touched. The
// pnpm store is a named volume (<prefix>-pnpm-store) that persists between runs. Reports (test-results,
// playwright-report, lighthouse-report) are copied to test-results/ci-local/<job>/.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { dockerPrefix, IMAGES } from './images.ts'

const ORDER = ['workflows', 'static', 'drift', 'build', 'verify', 'lighthouse', 'docker'] as const
type Job = (typeof ORDER)[number]
const HOST_JOBS = new Set<Job>(['workflows', 'docker'])

const requested = process.argv.slice(2)
const unknown = requested.filter((job) => !ORDER.includes(job as Job))
if (unknown.length) {
  console.error(`unknown job(s): ${unknown.join(', ')}; expected ${ORDER.join(' ')}`)
  process.exit(2)
}
const jobs = new Set<Job>(requested.length ? (requested as Job[]) : ORDER)
if ((jobs.has('verify') || jobs.has('lighthouse')) && !jobs.has('build')) {
  console.log('adding build: verify and lighthouse test the build of this run')
  jobs.add('build')
}
const plan = ORDER.filter((job) => jobs.has(job))

const cpus = process.env.CI_LOCAL_CPUS || '4'
const memory = process.env.CI_LOCAL_MEMORY || '6g'
const shm = process.env.CI_LOCAL_SHM || '2g'
const prefix = dockerPrefix()
const id = `${prefix}-local-${process.pid}`
const NETWORK = id
const DB = `${id}-db`
const MAIL = `${id}-mailpit`
const RUNNER = `${id}-runner`
const STORE = `${prefix}-pnpm-store`
const RESULTS = resolve('test-results/ci-local')
const pnpmVersion = (
  JSON.parse(readFileSync('package.json', 'utf8')) as { packageManager: string }
).packageManager.split('@')[1]

// Node from the official image (the Playwright image ships an older one), pnpm from package.json, and the
// pinned Caddy binary for the edge (EDGE_RUNTIME=binary: no Docker inside the container).
const DOCKERFILE = `
FROM ${IMAGES.node} AS node
FROM ${IMAGES.caddy} AS caddy
FROM ${IMAGES.playwright}
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN /usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js install --global --no-fund --no-audit pnpm@${pnpmVersion} \\
 && /usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js cache clean --force
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
ENV EDGE_RUNTIME=binary
`
const RUNNER_IMAGE = `${prefix}-runner:${createHash('sha256').update(DOCKERFILE).digest('hex').slice(0, 12)}`

const docker = (args: string[], options: { input?: string; quiet?: boolean; allowFailure?: boolean } = {}) => {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input: options.input,
    stdio: [options.input === undefined ? 'ignore' : 'pipe', options.quiet ? 'pipe' : 'inherit', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.status !== 0 && !options.allowFailure)
    throw new Error(`docker ${args.slice(0, 3).join(' ')} failed (${result.status ?? result.signal})\n${result.stderr}`)
  return (result.stdout ?? '').trim()
}

/** Runs a command, sampling the runner container's cgroup memory while it runs. */
const measured = async (command: string, args: string[], cgroup: string | undefined) => {
  const started = performance.now()
  let peak = 0
  let peakAnon = 0
  const sample = () => {
    if (!cgroup) return
    try {
      peak = Math.max(peak, Number(readFileSync(`${cgroup}/memory.current`, 'utf8')))
      const anon = /^anon (\d+)$/m.exec(readFileSync(`${cgroup}/memory.stat`, 'utf8'))?.[1]
      peakAnon = Math.max(peakAnon, Number(anon ?? 0))
    } catch {}
  }
  const timer = setInterval(sample, 250)
  const status = await new Promise<number>((done) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.once('exit', (code, signal) => done(code ?? (signal ? 128 : 1)))
    child.once('error', () => done(1))
  })
  clearInterval(timer)
  sample()
  return {
    status,
    seconds: (performance.now() - started) / 1000,
    peakBytes: cgroup ? peak : undefined,
    peakAnonBytes: cgroup ? peakAnon : undefined,
  }
}

/** The container's cgroup v2 directory on the host (systemd or cgroupfs driver), if readable. */
const cgroupOf = (container: string) => {
  const fullId = docker(['inspect', '--format', '{{.Id}}', container], { quiet: true })
  return [`/sys/fs/cgroup/system.slice/docker-${fullId}.scope`, `/sys/fs/cgroup/docker/${fullId}`].find((dir) =>
    existsSync(`${dir}/memory.current`),
  )
}

const gitFiles = (args: string[]) =>
  spawnSync('git', ['ls-files', '-z', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout.split('\0')

const cleanup = () => {
  docker(['rm', '--force', '--volumes', RUNNER, DB, MAIL], { quiet: true, allowFailure: true })
  docker(['network', 'rm', NETWORK], { quiet: true, allowFailure: true })
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    cleanup()
    process.exit(130)
  })

const gib = (bytes: number | undefined) => (bytes === undefined ? 'n/a' : `${(bytes / 1024 ** 3).toFixed(2)} GiB`)
type Row = { job: string; status: number; seconds: number; peakBytes?: number; peakAnonBytes?: number }
const rows: Row[] = []

const containerJobs = plan.filter((job) => !HOST_JOBS.has(job))
try {
  if (containerJobs.length) {
    const setupStarted = performance.now()
    console.log(`▶ runner image ${RUNNER_IMAGE}`)
    docker(['build', '--quiet', '--tag', RUNNER_IMAGE, '-'], { input: DOCKERFILE, quiet: true })
    docker(['network', 'create', NETWORK], { quiet: true })
    // Same database and credentials as the CI service; the data lives in memory and goes with the container.
    docker(
      ['run', '--detach', '--name', DB, '--network', NETWORK, '--network-alias', 'postgres', '--memory', '1g']
        .concat(['--tmpfs', '/var/lib/postgresql:size=512m', '--env', 'POSTGRES_USER=proofstack'])
        .concat(['--env', 'POSTGRES_PASSWORD=proofstack-ci', '--env', 'POSTGRES_DB=proofstack', IMAGES.postgres]),
      { quiet: true },
    )
    // verify:app sends account emails here and the E2E tests read them back (the CI service `mailpit`).
    docker(
      [
        'run',
        '--detach',
        '--name',
        MAIL,
        '--network',
        NETWORK,
        '--network-alias',
        'mailpit',
        '--memory',
        '128m',
      ].concat([IMAGES.mailpit]),
      { quiet: true },
    )
    rmSync(RESULTS, { recursive: true, force: true })
    mkdirSync(RESULTS, { recursive: true })
    docker(
      ['run', '--detach', '--init', '--name', RUNNER, '--network', NETWORK, '--cpus', cpus, '--memory', memory]
        .concat(['--memory-swap', memory, '--shm-size', shm, '--workdir', '/work'])
        .concat([
          '--volume',
          `${process.cwd()}:/repo:ro`,
          '--volume',
          `${STORE}:/cache`,
          '--volume',
          `${RESULTS}:/results`,
        ])
        .concat([
          '--env',
          'CI=true',
          '--env',
          'DATABASE_URL=postgres://proofstack:proofstack-ci@postgres:5432/proofstack',
          '--env',
          'MAILPIT_HOST=mailpit',
          '--env',
          'MAILPIT_SMTP_PORT=1025',
          '--env',
          'MAILPIT_HTTP_PORT=8025',
        ])
        .concat([RUNNER_IMAGE, 'sleep', 'infinity']),
      { quiet: true },
    )
    const cgroup = cgroupOf(RUNNER)

    // The checkout: tracked and untracked-but-not-ignored files, minus deleted ones, as they are on disk.
    const deleted = new Set(gitFiles(['--deleted']))
    const files = gitFiles(['--cached', '--others', '--exclude-standard']).filter((f) => f && !deleted.has(f))
    docker(['exec', '-i', RUNNER, 'sh', '-c', 'tar -C /repo --null -T - -cf - | tar -C /work -xf -'], {
      input: `${files.join('\0')}\0`,
      quiet: true,
    })
    for (let i = 0; i < 60; i++) {
      const ready = spawnSync('docker', ['exec', DB, 'pg_isready', '-h', '127.0.0.1', '-U', 'proofstack'], {
        stdio: 'ignore',
      })
      if (ready.status === 0) break
      if (i === 59) throw new Error('Postgres did not become ready in 30 s')
      await new Promise((r) => setTimeout(r, 500))
    }
    console.log(`▶ copied ${files.length} files; pnpm install --frozen-lockfile`)
    const install = await measured(
      'docker',
      [
        'exec',
        RUNNER,
        'pnpm',
        'install',
        '--frozen-lockfile',
        '--store-dir',
        '/cache/pnpm-store',
        '--reporter=append-only',
      ],
      cgroup,
    )
    rows.push({ ...install, job: 'setup', seconds: (performance.now() - setupStarted) / 1000 })
    if (install.status !== 0) throw new Error('pnpm install failed in the runner')

    for (const job of containerJobs) {
      console.log(`\n▶ ci:${job} (container: ${cpus} CPUs, ${memory} memory, ${shm} /dev/shm)`)
      const result = await measured('docker', ['exec', RUNNER, 'pnpm', `ci:${job}`], cgroup)
      rows.push({ job, ...result })
      const uid = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`
      docker(
        ['exec', RUNNER, 'sh', '-c'].concat([
          `mkdir -p /results/${job} && for d in test-results playwright-report lighthouse-report; do ` +
            `[ -e "$d" ] && cp -r "$d" /results/${job}/; done; chown -R ${uid} /results`,
        ]),
        { quiet: true, allowFailure: true },
      )
      if (job === 'build' && result.status !== 0) {
        console.error('build failed: skipping the jobs that need it')
        break
      }
    }
    const peak = cgroup ? Number(readFileSync(`${cgroup}/memory.peak`, 'utf8')) : undefined
    rows.push({ job: 'container total (memory.peak)', status: 0, seconds: 0, peakBytes: peak })
  }
  for (const job of plan.filter((j) => HOST_JOBS.has(j))) {
    console.log(`\n▶ ci:${job} (host)`)
    rows.push({ job, ...(await measured('pnpm', [`ci:${job}`], undefined)) })
  }
} catch (error) {
  console.error(`\nci:local could not run: ${error instanceof Error ? error.message : String(error)}`)
  rows.push({ job: 'ci:local', status: 1, seconds: 0 })
} finally {
  cleanup()
}

console.log(`\nci:local (${RUNNER_IMAGE}; reports in test-results/ci-local/)`)
console.log('job                            result        time   peak memory: total (incl. page cache) / anon')
for (const row of rows) {
  const result = row.status === 0 ? 'ok' : row.status === 2 ? 'INCONCLUSIVE' : `FAIL (${row.status})`
  console.log(
    `${row.job.padEnd(30)} ${result.padEnd(12)} ${row.seconds ? `${row.seconds.toFixed(0).padStart(5)}s` : '      '}   ${gib(row.peakBytes)}${row.peakAnonBytes ? ` / ${gib(row.peakAnonBytes)}` : ''}`,
  )
}
const statuses = rows.map((r) => r.status)
process.exitCode = statuses.some((s) => s !== 0 && s !== 2) ? 1 : statuses.includes(2) ? 2 : 0
