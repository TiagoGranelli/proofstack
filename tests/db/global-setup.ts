// Vitest global setup of the `db` project: a fresh, migrated `proofstack_db_<pid>_test` database next to
// DATABASE_URL (from the environment or .env), dropped afterwards. Test workers inherit the DATABASE_URL set
// here, so src/server/db/client.ts connects to it.
import { dropTestDatabase, resetTestDatabase, testDatabaseUrl } from '../../scripts/test-db.ts'

export default async function setup() {
  const url = testDatabaseUrl('db')
  await resetTestDatabase(url)
  process.env.DATABASE_URL = url
  return async () => {
    if (process.env.KEEP_TEST_DB !== '1') await dropTestDatabase(url)
  }
}
