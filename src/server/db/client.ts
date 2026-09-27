import '@tanstack/react-start/server-only'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Context, Layer } from 'effect'
import { Pool } from 'pg'
import { env } from '../env.ts'
import { onShutdown } from '../lifecycle.ts'
import { log } from '../log.ts'
import * as schema from './schema/index.ts'

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: env.databasePoolMax,
  idleTimeoutMillis: 10_000,
  // Fail fast instead of queueing forever when Postgres is unreachable or the pool is exhausted,
  // so /api/ready reports 503 promptly and requests do not pile up.
  connectionTimeoutMillis: 5_000,
  // Server-side cap for a single statement; nothing in this app should come close.
  statement_timeout: 15_000,
  application_name: 'proofstack',
})
pool.on('error', (error) => log('error', 'postgres pool error', { error }))
onShutdown('postgres-pool', () => pool.end())

export const db = drizzle({ client: pool, schema })

/** The Drizzle client as an Effect service, so repositories can be built against another database in tests. */
export class Database extends Context.Service<Database, typeof db>()('proofstack/Database') {
  static readonly layer = Layer.succeed(Database, db)
}
