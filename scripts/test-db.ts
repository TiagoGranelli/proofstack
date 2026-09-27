// Throwaway *_test databases for the test runners, lighthouse and check:drift. Refuses to touch any other name.
// Each run gets its own database (`app_<purpose>_<pid>_test`) because a reset drops the database
// WITH (FORCE): two runs sharing one name would kill each other's connections.
import { existsSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client, Pool } from 'pg'

const assertTestName = (name: string) => {
  if (!/^[a-z0-9_]+_test$/.test(name))
    throw new Error(`refusing to use database "${name}": test database names must match [a-z0-9_]+_test`)
  return name
}

const adminUrl = (url: string) => Object.assign(new URL(url), { pathname: '/postgres' }).toString()

/** The base DATABASE_URL (from the environment or .env), with a message that says how to get one. */
export const baseDatabaseUrl = (): string => {
  if (!process.env.DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env')
  const url = process.env.DATABASE_URL?.trim()
  if (!url)
    throw new Error(
      existsSync('.env')
        ? 'DATABASE_URL is not set in .env. Copy it from .env.example, or run `pnpm bootstrap`.'
        : 'No .env file and no DATABASE_URL. Run `pnpm bootstrap` (creates .env and starts Postgres).',
    )
  return url
}

/**
 * URL of this process's test database: `override` (an env var such as DRIFT_DATABASE_URL) when set, otherwise
 * DATABASE_URL with the database name replaced by `app_<purpose>_<pid>_test`.
 */
export const testDatabaseUrl = (purpose: string, override?: string): string => {
  const url = override?.trim()
    ? new URL(override.trim())
    : Object.assign(new URL(baseDatabaseUrl()), { pathname: `/app_${purpose}_${process.pid}_test` })
  assertTestName(url.pathname.slice(1))
  return url.toString()
}

/** Connects to the server's `postgres` database, turning "connection refused" into a setup hint. */
const connectAdmin = async (url: string) => {
  const admin = new Client({ connectionString: adminUrl(url), connectionTimeoutMillis: 5_000 })
  try {
    await admin.connect()
  } catch (error) {
    const { host } = new URL(url)
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `cannot reach Postgres at ${host} (${reason}). Start it with \`pnpm db:up\` (first time: \`pnpm bootstrap\`).`,
      { cause: error },
    )
  }
  return admin
}

/** Runs `statements(name)` one after the other on the server of the test database `name` in `testUrl`. */
const administer = async (testUrl: string, statements: (name: string) => string[]) => {
  const name = assertTestName(new URL(testUrl).pathname.slice(1))
  const admin = await connectAdmin(testUrl)
  try {
    for (const statement of statements(name)) await admin.query(statement)
  } finally {
    await admin.end()
  }
}

export const dropTestDatabase = (testUrl: string): Promise<void> =>
  administer(testUrl, (name) => [`drop database if exists "${name}" with (force)`])

/** A per-run database name (`testDatabaseUrl`) and the pid of the run that made it. */
const RUN_DATABASE = /^app_[a-z0-9]+_(\d+)_test$/

/** Whether process `pid` still runs here: signal 0 only checks, and EPERM means it runs as another user. */
const isRunning = (pid: number) => {
  try {
    return process.kill(pid, 0)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Whether `name` is a per-run database of another run that is gone. */
const isAbandoned = (name: string) => {
  const pid = Number(RUN_DATABASE.exec(name)?.[1])
  return Boolean(pid) && pid !== process.pid && !isRunning(pid)
}

/**
 * Drops the per-run databases of runs that are gone. A run stopped with Ctrl-C or killed never reaches the
 * `finally` that drops its own, and each one would stay on the server for good.
 */
const dropAbandoned = async (testUrl: string) => {
  const admin = await connectAdmin(testUrl)
  try {
    const { rows } = await admin.query<{ datname: string }>('select datname from pg_database')
    // `if exists`: another run's sweep may drop the same one first.
    for (const name of rows.map(({ datname }) => datname).filter((datname) => isAbandoned(datname)))
      await admin.query(`drop database if exists "${name}" with (force)`)
  } finally {
    await admin.end()
  }
}

/** Recreates the test database, empty, after dropping the ones abandoned by runs that no longer exist. */
export const emptyTestDatabase = async (testUrl: string): Promise<void> => {
  await dropAbandoned(testUrl)
  await administer(testUrl, (name) => [`drop database if exists "${name}" with (force)`, `create database "${name}"`])
}

/** Recreates an empty test database and applies every migration in drizzle/. */
export const resetTestDatabase = async (testUrl: string): Promise<void> => {
  await emptyTestDatabase(testUrl)
  const pool = new Pool({ connectionString: testUrl })
  // Postgres NOTICEs ("schema drizzle already exists, skipping") are noise here.
  pool.on('connect', (client) => client.on('notice', () => {}))
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: 'drizzle' })
  } finally {
    await pool.end()
  }
}

/** Sessions other than our own connected to the test database, e.g. an app that did not close its pool. */
export const openConnections = async (testUrl: string): Promise<{ application_name: string; n: number }[]> => {
  const name = assertTestName(new URL(testUrl).pathname.slice(1))
  const admin = await connectAdmin(testUrl)
  try {
    const { rows } = await admin.query<{ application_name: string; n: number }>(
      `select application_name, count(*)::int as n from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid() group by 1 order by 1`,
      [name],
    )
    return rows
  } finally {
    await admin.end()
  }
}

if (import.meta.main) {
  const url = process.env.TEST_DATABASE_URL
  if (!url)
    throw new Error('TEST_DATABASE_URL is not set; expected a postgres:// URL whose database name ends in _test')
  await resetTestDatabase(url)
  console.log(`reset ${new URL(url).pathname.slice(1)} and applied migrations`)
}
