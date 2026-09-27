// Applies pending Drizzle migrations from drizzle/ for deploys, to MIGRATION_DATABASE_URL if set, else
// DATABASE_URL.
// Safe to start from several instances at once, and behind a connection pooler in transaction mode
// (PgBouncer, Neon's and Supabase's poolers): everything happens in one transaction that first takes a
// transaction-scoped advisory lock, so concurrent runs queue behind each other and each one reads
// drizzle.__drizzle_migrations only once it holds the lock. Migrations already recorded there are skipped, so
// reruns are no-ops. Settings are `SET LOCAL`, which ends with the transaction; nothing is left on a pooled
// server connection.
// Usage: node scripts/migrate.ts   (the Docker image runs the bundled copy: node .output/migrate.mjs)
import { existsSync } from 'node:fs'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { Client } from 'pg'

// Any constant works as long as nothing else in the database uses it. ASCII "proofstk".
const LOCK_KEY = '8098991147069224299'
const LOCK_WAIT = process.env.MIGRATE_LOCK_TIMEOUT ?? '5min'
// Bound for each table lock a migration takes. DDL waiting on a busy table would otherwise queue every
// later query on that table behind it; with the bound it gives up, rolls back and tries again.
const DDL_LOCK_WAIT = process.env.MIGRATE_DDL_LOCK_TIMEOUT ?? '5s'
const DDL_ATTEMPTS = 5
const LOCK_NOT_AVAILABLE = '55P03'
// Drizzle's bookkeeping table, so `drizzle-kit` and this script agree on what has been applied.
const TABLE = 'drizzle.__drizzle_migrations'

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

if (existsSync('.env') && !process.env.MIGRATION_DATABASE_URL && !process.env.DATABASE_URL) process.loadEnvFile('.env')
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!url) {
  log('error', 'MIGRATION_DATABASE_URL or DATABASE_URL is required')
  process.exit(2)
}
const migrationsFolder = process.env.MIGRATIONS_FOLDER ?? 'drizzle'
if (!existsSync(`${migrationsFolder}/meta/_journal.json`)) {
  log('error', 'migrations folder not found', { migrationsFolder })
  process.exit(2)
}
const migrations = readMigrationFiles({ migrationsFolder })

/** Thrown when another run held the lock for longer than MIGRATE_LOCK_TIMEOUT: not retried. */
class LockWaitExceeded extends Error {}

type Migration = (typeof migrations)[number]
type Counts = { applied: number; total: number }

// The role's timeouts are meant for the app (docs/operations.md, "Connection poolers"): they must cut short
// neither the wait for another run nor a long migration. lock_timeout bounds both waits instead.
const relaxTimeouts = async (client: Client) => {
  await client.query('set local statement_timeout = 0')
  await client.query('set local idle_in_transaction_session_timeout = 0')
}

/**
 * Waits for the advisory lock for at most LOCK_WAIT (lock_timeout first bounds this wait, then each lock the DDL
 * takes). The commit or rollback of the transaction releases it.
 */
const takeLock = async (client: Client) => {
  await client.query(`set local lock_timeout = ${setting(LOCK_WAIT)}`)
  await client.query('select pg_advisory_xact_lock($1)', [LOCK_KEY]).catch((error: unknown) => {
    throw codeOf(error) === LOCK_NOT_AVAILABLE
      ? new LockWaitExceeded(`another migration run held the lock for longer than ${LOCK_WAIT}`, { cause: error })
      : error
  })
}

/** A migration is pending when it is newer than the last recorded one, as in Drizzle's migrator. */
const pendingMigrations = async (client: Client): Promise<Migration[]> => {
  const { rows } = await client.query<{ created_at: string | null }>(
    `select created_at from ${TABLE} order by created_at desc limit 1`,
  )
  const last = rows[0]?.created_at
  return migrations.filter((migration) => last == null || Number(last) < migration.folderMillis)
}

const applyMigration = async (client: Client, migration: Migration) => {
  for (const statement of migration.sql) await client.query(statement)
  await client.query(`insert into ${TABLE} (hash, created_at) values ($1, $2)`, [
    migration.hash,
    migration.folderMillis,
  ])
}

/** Applies what is pending, each DDL lock bounded by DDL_LOCK_WAIT. Returns how many it applied and are recorded. */
const applyPending = async (client: Client): Promise<Counts> => {
  await client.query(`set local lock_timeout = ${setting(DDL_LOCK_WAIT)}`)
  await client.query('create schema if not exists drizzle')
  await client.query(
    `create table if not exists ${TABLE} (id serial primary key, hash text not null, created_at bigint)`,
  )
  const pending = await pendingMigrations(client)
  for (const migration of pending) await applyMigration(client, migration)
  const total = (await client.query<{ n: number }>(`select count(*)::int as n from ${TABLE}`)).rows[0]?.n ?? 0
  return { applied: pending.length, total }
}

/** One attempt, in one transaction: wait for the advisory lock, then apply what is pending. */
const attempt = async (client: Client): Promise<Counts> => {
  await client.query('begin')
  try {
    await relaxTimeouts(client)
    await takeLock(client)
    const counts = await applyPending(client)
    await client.query('commit')
    return counts
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  }
}

/** A table-lock timeout is retried up to DDL_ATTEMPTS times; waiting too long for another run is not. */
const retriable = (error: unknown, attemptNumber: number) =>
  !(error instanceof LockWaitExceeded) && codeOf(error) === LOCK_NOT_AVAILABLE && attemptNumber < DDL_ATTEMPTS

// All pending migrations share one transaction, so a table-lock timeout rolls back everything and the next
// attempt starts clean (and waits for the advisory lock again).
const migrateWithRetries = async (client: Client, attemptNumber = 1): Promise<Counts> => {
  try {
    return await attempt(client)
  } catch (error) {
    if (!retriable(error, attemptNumber)) throw error
    const lockTimeout = DDL_LOCK_WAIT
    log('info', 'migration waited too long for a table lock, retrying', { attempt: attemptNumber, lockTimeout })
    await new Promise((resolve) => setTimeout(resolve, 1000 * attemptNumber))
    return migrateWithRetries(client, attemptNumber + 1)
  }
}

const client = new Client({
  connectionString: url,
  application_name: 'app-migrate',
  connectionTimeoutMillis: 10_000,
})
// Postgres NOTICEs ("schema drizzle already exists, skipping") are noise here.
client.on('notice', () => {})
const started = performance.now()
try {
  await client.connect()
  const { applied, total } = await migrateWithRetries(client)
  log('info', 'migrations applied', { applied, total, ms: Math.round(performance.now() - started) })
} catch (error) {
  const cause = error instanceof Error && error.cause !== undefined ? firstLine(error.cause) : undefined
  log('error', 'migration failed', { error: firstLine(error), cause, code: codeOf(error) })
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
