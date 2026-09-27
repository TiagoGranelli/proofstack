// Every CI job's logic, one function per job. .github/workflows/ci.yml only installs tooling, starts
// services and calls `pnpm ci:<job>`; `pnpm ci:local` runs the same commands in the Playwright Ubuntu image.
// Usage: node scripts/ci-jobs.ts <job> [args for the job's script]
//   workflows   actionlint + zizmor on .github, and image pins consistent with scripts/images.ts (Docker)
//   static      pnpm check without its drift gate (the drift job runs every drift check)
//   drift       every drift check, including the database one (DATABASE_URL)
//   build       the production build, with placeholder configuration
//   verify      verify:app on all five Playwright projects (DATABASE_URL, the build)
//   lighthouse  the Lighthouse gate through the edge, 5 runs (DATABASE_URL, the build, Docker or caddy)
//   docker      the Docker image end to end (scripts/docker-smoke.ts; Docker)
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { IMAGES } from './images.ts'

const run = (command: string, args: string[], env: NodeJS.ProcessEnv = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } })
  return result.status ?? 1
}

// GitHub Actions tests the build job's artifact: its file times say nothing about the checkout's.
const downloadedBuild = process.env.GITHUB_ACTIONS === 'true' ? { ALLOW_STALE_BUILD: '1' } : {}

/** actionlint (with shellcheck) and zizmor from their pinned images, offline and read-only. */
const workflows = () => {
  const mount = ['--rm', '--network', 'none', '--memory', '512m', '--volume', `${process.cwd()}:/repo:ro`]
  const steps: [string, () => number][] = [
    ['actionlint', () => run('docker', ['run', ...mount, '--workdir', '/repo', IMAGES.actionlint, '-color'])],
    [
      'zizmor',
      () =>
        run('docker', [
          'run',
          ...mount,
          '--workdir',
          '/repo',
          IMAGES.zizmor,
          '--offline',
          '--config',
          '.github/zizmor.yml',
          '.',
        ]),
    ],
    ['image pins', imagePins],
  ]
  const failed = steps.filter(([name, step]) => {
    console.log(`\n▶ ${name}`)
    const status = step()
    console.log(status === 0 ? `ok    ${name}` : `FAIL  ${name}`)
    return status !== 0
  })
  return failed.length ? 1 : 0
}

/** Every reference to an image from scripts/images.ts in these files must be the same pinned reference. */
const PINNED_COPIES = ['compose.yaml', '.github/workflows/ci.yml']
const imagePins = () => {
  const problems: string[] = []
  for (const file of PINNED_COPIES) {
    const text = readFileSync(file, 'utf8')
    for (const ref of Object.values(IMAGES)) {
      const name = ref.slice(0, ref.lastIndexOf(':', ref.indexOf('@')))
      const pattern = new RegExp(
        `(?<![\\w./-])${name.replaceAll(/[.*+?^${}()|[\]\\/]/g, '\\$&')}:[\\w.-]+(@sha256:[0-9a-f]{64})?`,
        'g',
      )
      for (const match of text.matchAll(pattern))
        if (match[0] !== ref) problems.push(`${file}: ${match[0]} (scripts/images.ts has ${ref})`)
    }
  }
  for (const problem of problems) console.error(problem)
  return problems.length ? 1 : 0
}

const JOBS: Record<string, (args: string[]) => number> = {
  workflows,
  static: (args) => run('node', ['scripts/check.ts', '--skip=drift', ...args]),
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
