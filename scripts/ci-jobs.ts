// Every CI job's logic, one function per job. .github/workflows/ci.yml only installs tooling, starts
// services and calls `pnpm ci:<job>`; `pnpm ci:local` runs the same commands in the Playwright Ubuntu image.
// Usage: node scripts/ci-jobs.ts <job> [args for the job's script]
//   workflows   actionlint + zizmor on .github, image pins (compose files, ci.yml, Dockerfile) consistent with
//               scripts/images.ts, and the deploy recipes in deploy/ valid (Docker)
//   static      pnpm check against the parent commit, without its drift job (the drift job runs every drift check)
//   supply-chain registry signatures of every installed package, and the vulnerability gate (`pnpm audit:check`)
//   secrets     gitleaks over every commit of HEAD's history (.gitleaks.toml; Docker, a full clone)
//   drift       every drift check, including the database one (DATABASE_URL)
//   build       the production build, with placeholder configuration
//   verify      verify:app on all five Playwright projects (DATABASE_URL, the build)
//   lighthouse  the Lighthouse gate through the edge, 5 runs (DATABASE_URL, the build, Docker or caddy)
//   docker      the Docker image end to end (scripts/docker-smoke.ts; Docker)
import { spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { xSync } from 'tinyexec'
import { pinProblems } from './image-pins.ts'
import { IMAGES } from './images.ts'

/** Exit code of `command` with `env` on top of this process's; 1 when it cannot start (for example, no Docker). */
const run = (command: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) => {
  try {
    return xSync(command, args, { nodeOptions: { stdio: 'inherit', env } }).exitCode ?? 1
  } catch (error) {
    console.error(`${command} did not start: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

// GitHub Actions tests the build job's artifact, built from this commit by another job (its .output/build-inputs.json
// should match the checkout, so this override may go once a CI run confirms it: scripts/build-freshness.ts).
const downloadedBuild = process.env.GITHUB_ACTIONS === 'true' ? { ALLOW_STALE_BUILD: '1' } : {}

/** Runs every step even after a failure, so one run shows every problem. */
const sequence = (steps: [string, () => number][]) => {
  const failed = steps.filter(([name, step]) => {
    console.log(`\n▶ ${name}`)
    const status = step()
    console.log(status === 0 ? `ok    ${name}` : `FAIL  ${name}`)
    return status !== 0
  })
  return failed.length ? 1 : 0
}

/** `docker run` options for a linter: no network, and this checkout read-only in /repo. */
const OFFLINE = ['--rm', '--network', 'none', '--memory', '512m']
const CHECKOUT_READ_ONLY = ['--volume', `${process.cwd()}:/repo:ro`, '--workdir', '/repo']
const ZIZMOR = [IMAGES.zizmor, '--offline', '--config', '.github/zizmor.yml', '.']

/** actionlint (with shellcheck) and zizmor from their pinned images, offline and read-only. */
const workflows = () =>
  sequence([
    ['actionlint', () => run('docker', ['run', ...OFFLINE, ...CHECKOUT_READ_ONLY, IMAGES.actionlint, '-color'])],
    ['zizmor', () => run('docker', ['run', ...OFFLINE, ...CHECKOUT_READ_ONLY, ...ZIZMOR])],
    ['image pins', imagePins],
    ['deploy recipes', deployRecipes],
  ])

const EXAMPLE_DEPLOY = ['-f', 'deploy/compose.production.yaml', '--env-file', 'deploy/deploy.env.example']
const DEPLOY_READ_ONLY = ['--volume', `${process.cwd()}/deploy:/deploy:ro`]
const KUBERNETES_1_33 = ['-strict', '-summary', '-kubernetes-version', '1.33.0', '/deploy/kubernetes.yaml']

/**
 * The production compose file resolves with the example settings, and the Kubernetes manifests match the
 * Kubernetes 1.33 schemas (kubeconform, strict: an unknown field fails). kubeconform downloads the schemas.
 */
const deployRecipes = () =>
  sequence([
    ['compose.production.yaml', () => run('docker', ['compose', ...EXAMPLE_DEPLOY, 'config', '--quiet'])],
    [
      'kubernetes.yaml',
      () =>
        run('docker', ['run', '--rm', '--memory', '256m', ...DEPLOY_READ_ONLY, IMAGES.kubeconform, ...KUBERNETES_1_33]),
    ],
  ])

/**
 * gitleaks from its pinned image, offline and read-only, over every commit reachable from HEAD: a secret that
 * was committed and removed later is still in the history. Default rules plus the project's (.gitleaks.toml).
 * Findings are printed with the secret redacted.
 */
const git = (...gitArgs: string[]) => spawnSync('git', gitArgs, { encoding: 'utf8' }).stdout.trim()
const secrets = (args: string[]) => {
  if (git('rev-parse', '--is-shallow-repository') !== 'false') {
    console.error('secrets: needs the full history (a clone that is not shallow; actions/checkout `fetch-depth: 0`)')
    return 1
  }
  const top = git('rev-parse', '--show-toplevel')
  // In a linked worktree, .git points into the main repository's git directory: mount both at their own paths.
  const common = resolve(git('rev-parse', '--git-common-dir'))
  const dirs = relative(top, common).startsWith('..') ? [top, common] : [top]
  const user = process.getuid ? ['--user', `${process.getuid()}:${process.getgid?.() ?? 0}`] : []
  // git refuses a repository whose owner differs from the process's ("dubious ownership"), as it can in a
  // container; the mount is read-only anyway.
  const safeDirectory = ['GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=safe.directory', 'GIT_CONFIG_VALUE_0=*']
  return run(
    'docker',
    ['run', '--rm', '--network', 'none', '--memory', '512m', ...user]
      .concat(safeDirectory.flatMap((setting) => ['--env', setting]))
      .concat(dirs.flatMap((dir) => ['--volume', `${dir}:${dir}:ro`]))
      .concat(['--workdir', top, IMAGES.gitleaks, 'git', '--config', '.gitleaks.toml', '--log-opts=HEAD'])
      .concat(['--redact', '--verbose', '--no-banner', ...args, '.']),
  )
}

/** Every reference to an image from scripts/images.ts in compose.yaml, ci.yml and the Dockerfile is the same pin. */
const imagePins = () => {
  const problems = pinProblems()
  for (const problem of problems) console.error(problem)
  if (problems.length) console.error('Copy the pin from scripts/images.ts into each file listed.')
  return problems.length ? 1 : 0
}

const JOBS: Record<string, (args: string[]) => number> = {
  workflows,
  // The commit under test against its parent (the checkout fetches two commits). The drift job runs every drift check.
  static: (args) =>
    run('pnpm', ['check', ...args], {
      CHECK_BASE_REF: process.env.CHECK_BASE_REF ?? 'HEAD^',
      LEFTHOOK_EXCLUDE: 'drift',
    }),
  // The install before it already verified the lockfile against minimumReleaseAge and trustPolicy.
  'supply-chain': () =>
    sequence([
      ['registry signatures', () => run('pnpm', ['audit', 'signatures'])],
      ['vulnerabilities', () => run('pnpm', ['audit:check'])],
    ]),
  secrets,
  drift: (args) => run('node', ['scripts/check-drift.ts', ...args]),
  // Nitro prerenders /about during the build, which loads the server configuration. The placeholders only
  // satisfy its validation (the same ones as the Dockerfile); nothing connects, nothing lands in .output.
  build: (args) =>
    run('pnpm', ['build', ...args], {
      DATABASE_URL: 'postgres://build:build@127.0.0.1:1/build',
      APP_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'ci-build-placeholder-secret-not-used-at-runtime',
    }),
  verify: (args) =>
    run('node', ['scripts/verify-app.ts', ...args], {
      PW_PROJECTS: process.env.PW_PROJECTS || 'all',
      ...downloadedBuild,
    }),
  lighthouse: (args) =>
    run(
      'node',
      ['scripts/lighthouse.ts', ...(args.some((a) => a.startsWith('--runs=')) ? [] : ['--runs=5']), ...args],
      {
        ...downloadedBuild,
      },
    ),
  docker: (args) => run('node', ['scripts/docker-smoke.ts', ...args]),
}

const [job, ...args] = process.argv.slice(2)
const selected = job ? JOBS[job] : undefined
if (!selected) {
  console.error(`usage: node scripts/ci-jobs.ts <${Object.keys(JOBS).join('|')}> [args]`)
  process.exit(2)
}
process.exitCode = selected(args)
