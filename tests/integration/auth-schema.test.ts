// Better Auth against the migrated test database: the Drizzle adapter's runtime schema check (which gates every
// auth request) passes, and the auth tables use timestamptz. Loads the server's auth configuration in-process
// with the environment verify:app gives the app (DATABASE_URL, APP_URL, BETTER_AUTH_SECRET).
import { afterAll, describe, expect, it } from 'vitest'
import { auth } from '#/server/auth.ts'
import { pool } from '#/server/db/client.ts'
import { appUrl } from './helpers.ts'

afterAll(() => pool.end())

describe('auth schema', () => {
  it('passes the Drizzle adapter runtime schema check', async () => {
    const context = await auth.$context
    // Registered by the adapter unless advanced.database.validateSchema is false; never turn it off.
    expect(context.checkSchema).toBeTypeOf('function')
    // Returns a promise on the first call and undefined once the schema is known to be clean.
    await expect(Promise.resolve(context.checkSchema?.())).resolves.toBeUndefined()
  })

  it('lets the running app answer auth requests (the same check runs before each one)', async () => {
    const res = await fetch(`${appUrl}/api/auth/get-session`)
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('stores every auth timestamp as timestamptz', async () => {
    const { rows } = await pool.query<{ table_name: string; column_name: string; data_type: string }>(
      `select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name in ('user', 'session', 'account', 'verification')
          and data_type like 'timestamp%' order by 1, 2`,
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.filter((row) => row.data_type !== 'timestamp with time zone')).toEqual([])
  })
})
