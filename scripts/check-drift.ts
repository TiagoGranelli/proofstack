// Fails when a generated artifact no longer matches its source.
//   contract   src/contract -> openapi.json -> src/sdk: `pnpm codegen` in place, then `git diff` (a drift is left
//              regenerated in the working tree, ready to review and commit)
//   migrations src/server/db/schema -> drizzle/ (`drizzle-kit generate` into a copy adds nothing, and
//              `drizzle-kit check` passes)
//   auth       src/server/db/schema/auth.ts holds what src/server/auth.ts writes (Better Auth `auth check schema`)
//   database   drizzle/*.sql applied to an empty database == the Drizzle schema (`drizzle-kit push` changes nothing)
// Usage: pnpm check:drift [contract] [migrations] [auth] [database]   (default: all; database needs Postgres)
// `pnpm check` runs the first three. The database check uses DRIFT_DATABASE_URL if set, otherwise a
// throwaway app_drift_<pid>_test next to DATABASE_URL.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { Client } from 'pg'
import { xSync } from 'tinyexec'
import { dropTestDatabase, resetTestDatabase, testDatabaseUrl } from './test-db.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

const SCHEMA = './src/server/db/schema/index.ts'
const MIGRATIONS = 'drizzle'

/** `pnpm <args>` with its output captured; throws with the output when it fails. */
const pnpm = (args: string[]) => {
  // A drizzle-kit rename prompt cannot be answered without a TTY; it ends here as a failure or a timeout
  // (tinyexec throws ETIMEDOUT).
  const result = xSync('pnpm', args, { timeout: 120_000, nodeOptions: { stdio: ['ignore', 'pipe', 'pipe'] } })
  const output = `${result.stdout}${result.stderr}`
  if (result.exitCode !== 0)
    throw new Error(`pnpm ${args.join(' ')} failed (${result.exitCode ?? result.signalCode})\n${output}`)
  return output
}

const git = (args: string[]) => spawnSync('git', args, { encoding: 'utf8' })

const checks = {
  async contract() {
    // The baseline is the working tree as it is, so a `pnpm codegen` output not staged yet is not drift.
    // `git stash create` stores it as a commit without touching the tree or the stash list (nothing when clean).
    const before = git(['stash', 'create']).stdout.trim() || 'HEAD'
    pnpm(['codegen'])
    const diff = git(['diff', '--exit-code', '--stat', before, '--', 'openapi.json', 'src/sdk'])
    if (diff.status === 0) return []
    return [`\`pnpm codegen\` changed these files; review and commit them:\n${diff.stdout.trimEnd()}${diff.stderr}`]
  },

  async migrations() {
    // drizzle-kit writes a new migration when the schema changed, so it runs on a copy of drizzle/.
    const dir = join(mkdtempSync(join(tmpdir(), 'check-drift-')), 'drizzle')
    try {
      cpSync(MIGRATIONS, dir, { recursive: true })
      // drizzle-kit prefixes --out with './', so an absolute path breaks; a relative one reaches the temp dir.
      const out = relative(process.cwd(), dir)
      pnpm(['exec', 'drizzle-kit', 'generate', '--dialect=postgresql', `--schema=${SCHEMA}`, `--out=${out}`])
      pnpm(['exec', 'drizzle-kit', 'check', '--dialect=postgresql', `--out=${MIGRATIONS}`])
      const added = readdirSync(dir).filter((file) => !existsSync(join(MIGRATIONS, file)))
      return added.map((file) => `the schema needs ${file}: run \`pnpm db:generate --name <slug>\``)
    } finally {
      rmSync(join(dir, '..'), { recursive: true, force: true })
    }
  },

  async auth() {
    // Better Auth's own check: every table, column, nullability and default the configuration writes exists in
    // the Drizzle schema (src/server/db/schema/auth.ts is application code, not generated). It only loads the
    // config, so placeholders let it run without a local .env.
    const result = xSync('pnpm', ['exec', 'auth', 'check', 'schema', '--config', 'src/server/auth.ts'], {
      timeout: 120_000,
      nodeOptions: {
        env: {
          DATABASE_URL: process.env.DATABASE_URL || 'postgres://unused@127.0.0.1:1/unused',
          APP_URL: process.env.APP_URL || 'http://localhost:3000',
          BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'check-drift-placeholder-secret-0123456789',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    })
    if (result.exitCode === 0) return []
    const report = `${result.stdout}${result.stderr}`.trim()
    return [`src/server/db/schema/auth.ts does not hold what src/server/auth.ts writes:\n${report}`]
  },

  async database() {
    const url = testDatabaseUrl('drift', process.env.DRIFT_DATABASE_URL)
    await resetTestDatabase(url)
    try {
      const before = await fingerprint(url)
      // Without --strict, push applies whatever the schema needs; on a fresh migrated database that must be nothing.
      const output = pnpm([
        'exec',
        'drizzle-kit',
        'push',
        '--dialect=postgresql',
        `--schema=${SCHEMA}`,
        `--url=${url}`,
        '--force',
      ])
      if (before === (await fingerprint(url))) return []
      return [
        `migrations in ${MIGRATIONS}/ do not produce the Drizzle schema; drizzle-kit push had to change:\n${output.trim()}`,
      ]
    } finally {
      if (!process.env.DRIFT_DATABASE_URL) await dropTestDatabase(url)
    }
  },
}

// Everything drizzle-kit push can change in the public schema, in a stable order.
const fingerprint = async (url: string) => {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const queries = [
      `select table_name, column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length
         from information_schema.columns where table_schema = 'public' order by 1, 2`,
      `select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint
         where connamespace = 'public'::regnamespace order by 1, 2`,
      `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`,
      `select t.typname, e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid order by 1, e.enumsortorder`,
      // Drizzle cannot declare UNLOGGED (rate_limit, drizzle/0006): a push that re-creates the table would lose it.
      `select relname, relpersistence from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
         order by 1`,
    ]
    const results = []
    for (const query of queries) results.push((await client.query({ text: query, rowMode: 'array' })).rows)
    return JSON.stringify(results)
  } finally {
    await client.end()
  }
}

type CheckName = keyof typeof checks
const requested = process.argv.slice(2) as CheckName[]
const unknown = requested.filter((name) => !(name in checks))
if (unknown.length)
  throw new Error(`unknown check(s): ${unknown.join(', ')}; expected ${Object.keys(checks).join(', ')}`)

let failed = false
for (const name of requested.length ? requested : (Object.keys(checks) as CheckName[])) {
  try {
    const problems = await checks[name]()
    if (problems.length === 0) console.log(`ok    ${name}`)
    else {
      failed = true
      console.error(`DRIFT ${name}\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    }
  } catch (error) {
    failed = true
    console.error(`ERROR ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
process.exitCode = failed ? 1 : 0
