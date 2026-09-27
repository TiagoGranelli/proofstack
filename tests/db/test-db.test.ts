// scripts/test-db.ts drops the per-run databases (`app_<purpose>_<pid>_test`) of runs that are gone
// whenever it creates one: a run stopped with Ctrl-C or killed never reaches the `finally` that drops its own.
import { spawnSync } from 'node:child_process'
import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { dropTestDatabase, emptyTestDatabase, testDatabaseUrl } from '../../scripts/test-db.ts'

const url = testDatabaseUrl('sweep')
const named = (name: string) => Object.assign(new URL(url), { pathname: `/${name}` }).toString()

/** The pid of a process that has already exited. */
const exitedPid = () => {
  const { pid } = spawnSync(process.execPath, ['--eval', ''])
  if (!pid) throw new Error('node --eval did not start')
  return pid
}

const admin = async <T>(work: (client: Client) => Promise<T>) => {
  const client = new Client({ connectionString: named('postgres') })
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.end()
  }
}
const existing = (names: string[]) =>
  admin(async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      'select datname from pg_database where datname = any($1) order by 1',
      [names],
    )
    return rows.map((row) => row.datname)
  })

const abandoned = `app_sweep_${exitedPid()}_test`
// The Vitest process that started this worker: a run that is still going.
const running = `app_sweep_${process.ppid}_test`
// A fixed name (TEST_DATABASE_URL), which carries no pid.
const fixed = 'app_fixed_sweep_test'

afterAll(async () => {
  for (const name of [abandoned, running, fixed, new URL(url).pathname.slice(1)]) await dropTestDatabase(named(name))
})

describe('emptyTestDatabase', () => {
  it("drops the databases of runs that are gone, and nobody else's", async () => {
    await emptyTestDatabase(named(running))
    await emptyTestDatabase(named(fixed))
    // Created without a sweep. Another worker's sweep may drop it at any moment, which is what this checks.
    await admin((client) => client.query(`create database "${abandoned}"`))

    await emptyTestDatabase(url)
    expect(await existing([abandoned, running, fixed])).toEqual([fixed, running].toSorted())
  })
})
