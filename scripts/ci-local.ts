// The faithful local CI: the same `pnpm ci:<job>` scripts as .github/workflows/ci.yml. The container jobs run in
// compose.ci.yaml (the Playwright image with Postgres and Mailpit, CPU, memory and /dev/shm limits), each in a fresh
// `runner` container on one copy of the checkout; the host jobs drive Docker themselves and run here.
// Usage: pnpm ci:local [job ...]   (default: every job, in CI order)
//   Container jobs: static supply-chain drift build verify lighthouse. Host jobs: workflows secrets docker.
//   verify and lighthouse need build, which is added when missing (CI's `needs: build`).
// Env: CI_LOCAL_CPUS (default 4, a GitHub-hosted runner), CI_LOCAL_MEMORY (6g), CI_LOCAL_SHM (2g),
//      CI_DOCKER_PREFIX (default <package name>-ci) names the compose project and the pnpm store volume.
// Reports (test-results, playwright-report, lighthouse-report) land in test-results/ci-local/<job>/.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { xSync } from 'tinyexec'
import { dockerPrefix } from './images.ts'

const ORDER = ['workflows', 'secrets', 'static', 'supply-chain', 'drift', 'build', 'verify', 'lighthouse', 'docker']
const HOST_JOBS = new Set(['workflows', 'secrets', 'docker'])

const requested = process.argv.slice(2)
const unknown = requested.filter((job) => !ORDER.includes(job))
if (unknown.length) {
  console.error(`unknown job(s): ${unknown.join(', ')}; expected ${ORDER.join(' ')}`)
  process.exit(2)
}
const jobs = new Set(requested.length ? requested : ORDER)
if ((jobs.has('verify') || jobs.has('lighthouse')) && !jobs.has('build')) {
  console.log('adding build: verify and lighthouse test the build of this run')
  jobs.add('build')
}
const plan = ORDER.filter((job) => jobs.has(job))

const git = (...args: string[]) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 2 ** 20 }).stdout
const TOP = git('rev-parse', '--show-toplevel').trim()
const RESULTS = resolve('test-results/ci-local')
const PROJECT = `${dockerPrefix()}-local-${process.pid}`
/** What compose.ci.yaml interpolates. */
const env = {
  ...process.env,
  CI_DOCKER_PREFIX: dockerPrefix(),
  PNPM_VERSION: (JSON.parse(readFileSync('package.json', 'utf8')) as { packageManager: string }).packageManager
    .split('@')[1]
    ?.split('+')[0],
  CI_LOCAL_TOP: TOP,
  CI_LOCAL_GIT: resolve(git('rev-parse', '--git-common-dir').trim()),
  CI_LOCAL_RESULTS: RESULTS,
}

/** `docker compose` on this run's project; the exit code, with the terminal attached unless `input` is given. */
const compose = (args: string[], input?: string) =>
  spawnSync('docker', ['compose', '-p', PROJECT, '-f', 'compose.ci.yaml', ...args], {
    env,
    input,
    stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
  }).status ?? 1

/** One step in a fresh runner container: the command, then its peak memory (compose.ci.yaml's entrypoint). */
const inRunner = (step: string, command: string[], input?: string) =>
  compose(
    ['run', '--rm', ...(input === undefined ? [] : ['-T']), '-e', `STEP=${step}`].concat([
      '-e',
      `HOST_UID=${process.getuid?.() ?? 0}`,
      'runner',
      ...command,
    ]),
    input,
  )

/**
 * The checkout CI would get, in the `work` volume: HEAD and its parent (jobs diff against HEAD^), with the files
 * as they are on disk on top (tracked and untracked ones that are not ignored), then a frozen install.
 */
const COPY_CHECKOUT = [
  `git clone --quiet --depth 2 "file://${TOP}" .`,
  'find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +',
  `tar -C "${TOP}" --null -T - -cf - | tar -xf -`,
  'pnpm install --frozen-lockfile --store-dir /pnpm-store --reporter=append-only',
].join(' && ')
const checkoutFiles = () => {
  const deleted = new Set(git('ls-files', '-z', '--deleted').split('\0'))
  return git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
    .split('\0')
    .filter((file) => file !== '' && !deleted.has(file))
}

type Row = { job: string; status: number; seconds: number; peakBytes?: number }
const timed = (job: string, run: () => number): Row => {
  const started = performance.now()
  const status = run()
  const seconds = (performance.now() - started) / 1000
  const peakFile = `${RESULTS}/${job}/memory.peak`
  const peakBytes = existsSync(peakFile) ? Number(readFileSync(peakFile, 'utf8')) : undefined
  return { job, status, seconds, peakBytes }
}

const runContainerJobs = (containerJobs: string[]) => {
  spawnSync('docker', ['volume', 'create', `${dockerPrefix()}-pnpm-store`], { stdio: 'ignore' })
  if (compose(['build', 'runner']) !== 0) return [{ job: 'runner image', status: 1, seconds: 0 }]
  const files = checkoutFiles()
  console.log(`▶ copy ${files.length} files into the runner's checkout; pnpm install --frozen-lockfile`)
  const rows = [timed('setup', () => inRunner('setup', ['sh', '-c', COPY_CHECKOUT], `${files.join('\0')}\0`))]
  if (rows[0]?.status !== 0) return rows
  for (const job of containerJobs) {
    console.log(`\n▶ ci:${job} (container)`)
    rows.push(timed(job, () => inRunner(job, ['pnpm', `ci:${job}`])))
    if (job === 'build' && rows.at(-1)?.status !== 0) {
      console.error('build failed: skipping the jobs that need it')
      break
    }
  }
  return rows
}

const cleanup = () => compose(['down', '--volumes', '--rmi', 'local', '--remove-orphans'])
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    cleanup()
    process.exit(130)
  })

rmSync(RESULTS, { recursive: true, force: true })
mkdirSync(RESULTS, { recursive: true })
const rows: Row[] = []
const containerJobs = plan.filter((job) => !HOST_JOBS.has(job))
try {
  if (containerJobs.length) rows.push(...runContainerJobs(containerJobs))
} finally {
  cleanup()
}
for (const job of plan.filter((j) => HOST_JOBS.has(j))) {
  console.log(`\n▶ ci:${job} (host)`)
  // tinyexec starts pnpm's .cmd shim on Windows too (docs/operations.md, "Development platforms").
  rows.push(timed(job, () => xSync('pnpm', [`ci:${job}`], { nodeOptions: { stdio: 'inherit' } }).exitCode ?? 1))
}

const gib = (bytes: number | undefined) => (bytes === undefined ? 'n/a' : `${(bytes / 1024 ** 3).toFixed(2)} GiB`)
const outcome = (status: number) => (status === 0 ? 'ok' : status === 2 ? 'INCONCLUSIVE' : `FAIL (${status})`)
console.log('\nci:local (reports in test-results/ci-local/)')
console.log('job            result         time   peak memory (cgroup memory.peak, page cache included)')
for (const row of rows)
  console.log(
    `${row.job.padEnd(14)} ${outcome(row.status).padEnd(12)} ${row.seconds.toFixed(0).padStart(5)}s   ${gib(row.peakBytes)}`,
  )
const statuses = rows.map((row) => row.status)
process.exitCode = statuses.some((s) => s !== 0 && s !== 2) ? 1 : statuses.includes(2) ? 2 : 0
