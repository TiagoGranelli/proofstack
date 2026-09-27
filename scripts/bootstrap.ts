// One-command local setup after `pnpm install`: .env with a fresh auth secret, Postgres, Mailpit, migrations.
// Idempotent and non-destructive: an existing .env is never overwritten, only an empty secret is filled in.
// Usage: pnpm bootstrap   (named so because `pnpm setup` is a built-in pnpm command)
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { xSync } from 'tinyexec'

/** Exit code of `command`, or the reason it could not start (tinyexec throws when spawning fails). */
const exitOf = (command: string, args: string[]) => {
  try {
    return xSync(command, args, { nodeOptions: { stdio: 'inherit' } }).exitCode ?? 1
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const step = (label: string, [command, ...args]: [string, ...string[]], hint: string) => {
  console.log(`\n> ${label}`)
  const exit = exitOf(command, args)
  if (exit !== 0) {
    console.error(`\n${label} failed (${typeof exit === 'number' ? `exit ${exit}` : exit}). ${hint}`)
    process.exit(typeof exit === 'number' ? exit : 1)
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
  'docker compose up --detach --wait db mailpit',
  ['docker', 'compose', 'up', '--detach', '--wait', 'db', 'mailpit'],
  'Is Docker running? If a port is taken, set POSTGRES_PORT (and the port in DATABASE_URL), MAILPIT_SMTP_PORT ' +
    '(and the port in SMTP_URL) or MAILPIT_HTTP_PORT in .env.',
)
// The same migrator as deploys (advisory lock, JSON logs with the failing statement's error).
step(
  'node scripts/migrate.ts',
  [process.execPath, 'scripts/migrate.ts'],
  'See the error above; Postgres must have started.',
)

console.log(`
Ready. Next:
  pnpm user:create you@example.com "Your Name"   # password via stdin or CREATE_USER_PASSWORD
  pnpm dev                                       # http://localhost:3000
  pnpm check                                     # format, lint, types, dead code, drift and boundaries`)
