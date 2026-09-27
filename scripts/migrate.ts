// Applies pending Drizzle migrations from drizzle/ to DATABASE_URL, for deploys.
// Safe to start from several instances at once: a Postgres advisory lock serializes the runs and
// migrations already recorded in drizzle.__drizzle_migrations are skipped, so reruns are no-ops.
// Usage: node scripts/migrate.ts   (the Docker image runs the bundled copy: node .output/migrate.mjs)
import { existsSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

// Any constant works as long as nothing else in the database uses it. ASCII "proofstk".
const LOCK_KEY = '8098991147069224299'
const LOCK_WAIT = process.env.MIGRATE_LOCK_TIMEOUT ?? '5min'
// Bound for each table lock a migration takes. DDL waiting on a busy table would otherwise queue every
// later query on that table behind it; with the bound it gives up, rolls back and tries again.
const DDL_LOCK_WAIT = process.env.MIGRATE_DDL_LOCK_TIMEOUT ?? '5s'
const DDL_ATTEMPTS = 5
const LOCK_NOT_AVAILABLE = '55P03'

const setting = (value: string) => `'${value.replaceAll("'", '')}'`
const codeOf = (error: unknown): unknown => {
  const { code, cause } = (error ?? {}) as { code?: unknown; cause?: unknown }
  return code ?? (cause === undefined ? undefined : codeOf(cause))
}
const firstLine = (error: unknown) => (error instanceof Error ? error.message.split('\n', 1)[0] : String(error))

const log = (level: 'info' | 'error', msg: string, fields: Record<string, unknown> = {}) =>
  (level === 'error' ? process.stderr : process.stdout).write(
    `${JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })}\n`,
  )

if (existsSync('.env') && !process.env.DATABASE_URL) process.loadEnvFile('.env')
const url = process.env.DATABASE_URL
if (!url) {
  log('error', 'DATABASE_URL is required')
  process.exit(2)
}
const migrationsFolder = process.env.MIGRATIONS_FOLDER ?? 'drizzle'
if (!existsSync(`${migrationsFolder}/meta/_journal.json`)) {
  log('error', 'migrations folder not found', { migrationsFolder })
  process.exit(2)
}

const client = new Client({
  connectionString: url,
  application_name: 'proofstack-migrate',
  connectionTimeoutMillis: 10_000,
})
const started = performance.now()
try {
  await client.connect()
  // lock_timeout first bounds the wait for another instance's run, then each lock the DDL takes.
  await client.query(`set lock_timeout = ${setting(LOCK_WAIT)}`)
  await client.query('select pg_advisory_lock($1)', [LOCK_KEY])
  await client.query(`set lock_timeout = ${setting(DDL_LOCK_WAIT)}`)
  const count = async () => {
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables where table_schema = 'drizzle' and table_name = '__drizzle_migrations'`,
    )
    if ((rows[0]?.n ?? 0) === 0) return 0
    return (
      (await client.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations')).rows[0]?.n ?? 0
    )
  }
  const before = await count()
  // Drizzle applies all pending migrations in one transaction, so a lock timeout rolls back everything
  // and the next attempt starts clean.
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate(drizzle({ client }), { migrationsFolder })
      break
    } catch (error) {
      if (codeOf(error) !== LOCK_NOT_AVAILABLE || attempt === DDL_ATTEMPTS) throw error
      log('info', 'migration waited too long for a table lock, retrying', { attempt, lockTimeout: DDL_LOCK_WAIT })
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
    }
  }
  const after = await count()
  log('info', 'migrations applied', {
    applied: after - before,
    total: after,
    ms: Math.round(performance.now() - started),
  })
} catch (error) {
  const cause = error instanceof Error && error.cause !== undefined ? firstLine(error.cause) : undefined
  log('error', 'migration failed', { error: firstLine(error), cause, code: codeOf(error) })
  process.exitCode = 1
} finally {
  // Ending the session also releases the advisory lock.
  await client.end().catch(() => {})
}
