// One-command local setup after `pnpm install`: .env with a fresh auth secret, Postgres, migrations.
// Idempotent and non-destructive: an existing .env is never overwritten, only an empty secret is filled in.
// Usage: pnpm bootstrap   (named so because `pnpm setup` is a built-in pnpm command)
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

const step = (label: string, command: string, args: string[], hint: string) => {
  console.log(`\n> ${label}`)
  const { status, error } = spawnSync(command, args, { stdio: 'inherit' })
  if (status !== 0) {
    console.error(`\n${label} failed (${error?.message ?? `exit ${status}`}). ${hint}`)
    process.exit(status || 1)
  }
}

if (existsSync('.env')) console.log('.env exists, keeping it')
else {
  copyFileSync('.env.example', '.env')
  console.log('created .env from .env.example')
}

const EMPTY_SECRET = /^BETTER_AUTH_SECRET=[ \t]*$/m
const text = readFileSync('.env', 'utf8')
if (EMPTY_SECRET.test(text)) {
  writeFileSync('.env', text.replace(EMPTY_SECRET, `BETTER_AUTH_SECRET=${randomBytes(32).toString('base64')}`))
  console.log('generated BETTER_AUTH_SECRET in .env')
}

// compose.yaml publishes Postgres on POSTGRES_PORT; DATABASE_URL has to point at the same port.
process.loadEnvFile('.env')
const port = process.env.POSTGRES_PORT || '54329'
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined
if (!url) {
  console.error('DATABASE_URL is missing from .env; copy it from .env.example.')
  process.exit(1)
}
if (['127.0.0.1', 'localhost'].includes(url.hostname) && url.port !== port)
  console.warn(
    `warning: DATABASE_URL uses port ${url.port || 5432} but compose.yaml publishes Postgres on ${port} (POSTGRES_PORT).`,
  )

step(
  'pnpm db:up',
  'pnpm',
  ['run', '--silent', 'db:up'],
  'Is Docker running? If the port is taken, set POSTGRES_PORT (and the port in DATABASE_URL) in .env.',
)
// The same migrator as deploys (advisory lock, JSON logs with the failing statement's error).
step(
  'node scripts/migrate.ts',
  'node',
  ['scripts/migrate.ts'],
  'See the error above; `pnpm db:up` must have succeeded.',
)

console.log(`
Ready. Next:
  pnpm user:create you@example.com "Your Name"   # password via stdin or PROOFSTACK_USER_PASSWORD
  pnpm dev                                       # http://localhost:3000
  pnpm check                                     # format, lint, types, dead code, drift and boundaries`)
