// scripts/migrate.ts (the deploy migrator, bundled as .output/migrate.mjs) against its own empty database:
// concurrent runs, the retry on a busy table, the bound on waiting for another run, MIGRATION_DATABASE_URL, and
// bookkeeping that Drizzle's own migrator agrees with.
// The same script behind PgBouncer in transaction mode is covered by `pnpm ci:docker` (scripts/docker-smoke.ts).
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import { Client, Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dropTestDatabase, emptyTestDatabase, testDatabaseUrl } from '../../scripts/test-db.ts'

const url = testDatabaseUrl('migrate')
const MIGRATIONS = (JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: unknown[] }).entries
  .length
const LOCK_KEY = '8098991147069224299'

type Run = { code: number; lines: Array<{ msg: string; applied?: number; total?: number; error?: string }> }
/** Runs the migrator with only the given environment (no .env: DATABASE_URL or MIGRATION_DATABASE_URL is set). */
const migrate = (env: Record<string, string>) =>
  new Promise<Run>((resolve) => {
    execFile(
      process.execPath,
      ['scripts/migrate.ts'],
      { env: { PATH: process.env.PATH ?? '', ...env } },
      (error, stdout, stderr) =>
        resolve({
          code: error ? Number(error.code ?? 1) : 0,
          lines: `${stdout}${stderr}`
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Run['lines'][number]),
        }),
    )
  })

/** Opens a transaction on the test database that holds `lock` until the returned release is called. */
const hold = async (lock: string) => {
  const client = new Client({ connectionString: url })
  await client.connect()
  // This session idles in its transaction on purpose, also where the database sets a bound for the app.
  await client.query('set idle_in_transaction_session_timeout = 0')
  await client.query('begin')
  await client.query(lock)
  return async () => {
    await client.query('commit')
    await client.end()
  }
}

/** Every row of the bookkeeping table both migrators read. */
const recorded = async () => {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    return (
      await client.query<{ id: number; hash: string; created_at: string }>(
        'select id, hash, created_at from drizzle.__drizzle_migrations order by id',
      )
    ).rows
  } finally {
    await client.end()
  }
}

beforeEach(() => emptyTestDatabase(url))
afterAll(() => dropTestDatabase(url))

describe('scripts/migrate.ts', () => {
  it('applies every migration exactly once when three runs start together', async () => {
    const runs = await Promise.all([1, 2, 3].map(() => migrate({ DATABASE_URL: url })))
    expect(runs.map((run) => run.code)).toEqual([0, 0, 0])
    const results = runs.map((run) => run.lines.find((line) => line.msg === 'migrations applied'))
    expect(results.map((result) => result?.applied).toSorted((a, b) => (a ?? 0) - (b ?? 0))).toEqual([0, 0, MIGRATIONS])
    expect(results.every((result) => result?.total === MIGRATIONS)).toBe(true)
    // A later run finds nothing to do.
    const again = await migrate({ DATABASE_URL: url })
    expect(again.lines.at(-1)).toMatchObject({ msg: 'migrations applied', applied: 0, total: MIGRATIONS })
  })

  it('rolls back and retries when a table lock takes longer than MIGRATE_DDL_LOCK_TIMEOUT', async () => {
    const table = 'drizzle.__drizzle_migrations'
    await (
      await hold(`create schema drizzle; create table ${table} (id serial primary key, hash text, created_at bigint)`)
    )()
    // A long transaction on a table the migration needs; it ends after a while.
    const release = await hold(`lock table ${table} in access exclusive mode`)
    const released = new Promise((resolve) => setTimeout(resolve, 1_500)).then(release)
    const run = await migrate({ DATABASE_URL: url, MIGRATE_DDL_LOCK_TIMEOUT: '300ms' })
    await released
    expect(run.code).toBe(0)
    expect(run.lines.some((line) => line.msg.includes('retrying'))).toBe(true)
    expect(run.lines.at(-1)).toMatchObject({ msg: 'migrations applied', applied: MIGRATIONS })
  })

  it('gives up without retrying when another run holds the lock longer than MIGRATE_LOCK_TIMEOUT', async () => {
    const release = await hold(`select pg_advisory_xact_lock(${LOCK_KEY})`)
    try {
      const run = await migrate({ DATABASE_URL: url, MIGRATE_LOCK_TIMEOUT: '300ms' })
      expect(run.code).toBe(1)
      expect(run.lines).toEqual([
        expect.objectContaining({
          msg: 'migration failed',
          error: 'another migration run held the lock for longer than 300ms',
        }),
      ])
    } finally {
      await release()
    }
  })

  it('waits for another run and migrates past the timeouts set on the role or database for the app', async () => {
    const admin = new Client({ connectionString: url })
    await admin.connect()
    const database = new URL(url).pathname.slice(1)
    await admin.query(`alter database "${database}" set statement_timeout = '200ms'`)
    await admin.query(`alter database "${database}" set idle_in_transaction_session_timeout = '200ms'`)
    await admin.end()
    const release = await hold(`select pg_advisory_xact_lock(${LOCK_KEY})`)
    const released = new Promise((resolve) => setTimeout(resolve, 1_000)).then(release)
    const run = await migrate({ DATABASE_URL: url })
    await released
    expect(run.code).toBe(0)
    expect(run.lines.at(-1)).toMatchObject({ msg: 'migrations applied', applied: MIGRATIONS })
  })

  it('prefers MIGRATION_DATABASE_URL (a direct connection) over DATABASE_URL (possibly a pooler)', async () => {
    const run = await migrate({ DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none', MIGRATION_DATABASE_URL: url })
    expect(run.code).toBe(0)
    expect(run.lines.at(-1)).toMatchObject({ msg: 'migrations applied', applied: MIGRATIONS })
  })

  // scripts/migrate.ts copies Drizzle's bookkeeping instead of calling Drizzle's migrator, because it takes a
  // transaction-scoped advisory lock inside the migrations' transaction (safe behind a pooler). If the copy drifted
  // from Drizzle's rules, Drizzle's migrator (`drizzle-kit migrate`, resetTestDatabase in scripts/test-db.ts)
  // would apply migrations again on a database this script had already brought up to date.
  it("leaves nothing for Drizzle's own migrator to apply", async () => {
    await migrate({ DATABASE_URL: url })
    const before = await recorded()
    const pool = new Pool({ connectionString: url })
    try {
      await drizzleMigrate(drizzle({ client: pool }), { migrationsFolder: 'drizzle' })
    } finally {
      await pool.end()
    }
    expect(before).toHaveLength(MIGRATIONS)
    expect(await recorded()).toEqual(before)
  })
})
