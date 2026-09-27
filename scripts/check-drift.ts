// Fails when a generated artifact no longer matches its source. Nothing in the repository is written:
// every generator runs into a temporary directory and its output is compared byte for byte.
//   contract   src/contract -> openapi.json -> src/sdk (Hey API)
//   migrations src/server/db/schema -> drizzle/ (`drizzle-kit generate` adds nothing, `drizzle-kit check` passes)
//   auth       src/server/auth.ts (Better Auth) -> src/server/db/schema/auth.ts
//   database   drizzle/*.sql applied to an empty database == the Drizzle schema (`drizzle-kit push` changes nothing)
// Usage: pnpm check:drift [contract] [migrations] [auth] [database]   (default: all; database needs Postgres)
// `pnpm check` runs the first three. The database check uses DRIFT_DATABASE_URL if set, otherwise a
// throwaway proofstack_drift_<pid>_test next to DATABASE_URL.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { createClient } from '@hey-api/openapi-ts'
import { Client } from 'pg'
import heyApiConfig from '../openapi-ts.config.ts'
import { renderOpenApi } from './openapi.ts'
import { dropTestDatabase, resetTestDatabase, testDatabaseUrl } from './test-db.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

// One directory per process, outside the repository (the pre-commit hook runs this in a copy of the index
// whose node_modules links to the real one): concurrent runs never touch each other's files.
const SCRATCH = mkdtempSync(join(tmpdir(), 'proofstack-drift-'))
const SCHEMA = './src/server/db/schema/index.ts'
const MIGRATIONS = 'drizzle'

const hashTree = (dir: string): Map<string, string> => {
  const files = new Map<string, string>()
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else files.set(relative(dir, path), createHash('sha256').update(readFileSync(path)).digest('hex'))
    }
  }
  if (existsSync(dir)) walk(dir)
  return files
}

/** Compares the committed directory with freshly generated output, naming each file by its repo path. */
const diffTrees = (committed: string, generated: string): string[] => {
  const [repo, fresh] = [hashTree(committed), hashTree(generated)]
  return [...new Set([...repo.keys(), ...fresh.keys()])].toSorted().flatMap((file) => {
    if (!fresh.has(file)) return [`not generated anymore: ${join(committed, file)}`]
    if (!repo.has(file)) return [`missing from repo: ${join(committed, file)}`]
    return repo.get(file) === fresh.get(file) ? [] : [`differs: ${join(committed, file)}`]
  })
}

const run = (command: string, args: string[], env: NodeJS.ProcessEnv = process.env) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  // A drizzle-kit rename prompt cannot be answered without a TTY; it ends here as a failure or a timeout.
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed (${result.status ?? result.signal})\n${output}`)
  return output
}

const scratch = (name: string) => {
  const dir = join(SCRATCH, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

const checks = {
  async contract() {
    const dir = scratch('contract')
    const openapi = join(dir, 'openapi.json')
    writeFileSync(openapi, renderOpenApi())
    // The SDK is generated from the committed openapi.json, exactly like `pnpm sdk:generate`.
    const config = await heyApiConfig
    const output = typeof config.output === 'object' ? config.output : {}
    await createClient({ ...config, output: { ...output, path: join(dir, 'sdk') }, logs: { level: 'silent' } })
    const problems =
      readFileSync(openapi, 'utf8') === readFileSync('openapi.json', 'utf8')
        ? []
        : ['differs: openapi.json (run `pnpm codegen`)']
    return [...problems, ...diffTrees('src/sdk', join(dir, 'sdk')).map((p) => `${p} (run \`pnpm codegen\`)`)]
  },

  async migrations() {
    const dir = join(scratch('migrations'), 'drizzle')
    cpSync(MIGRATIONS, dir, { recursive: true })
    // drizzle-kit prefixes --out with './', so an absolute path breaks; a relative one reaches the temp dir.
    const out = relative(process.cwd(), dir)
    run('pnpm', ['exec', 'drizzle-kit', 'generate', '--dialect=postgresql', `--schema=${SCHEMA}`, `--out=${out}`])
    run('pnpm', ['exec', 'drizzle-kit', 'check', '--dialect=postgresql', `--out=${MIGRATIONS}`])
    // The generated folder starts as a copy of drizzle/, so a difference is a migration the schema needs.
    return diffTrees(MIGRATIONS, dir).map(
      (p) => `${p} (the schema changed without a migration: run \`pnpm db:generate --name <slug>\`)`,
    )
  },

  async auth() {
    const output = join(scratch('auth'), 'auth.ts')
    // Generation only reads the config; placeholders let it run without a local .env.
    run('pnpm', ['exec', 'auth', 'generate', '--config', 'src/server/auth.ts', '--output', output, '-y'], {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || 'postgres://unused@127.0.0.1:1/unused',
      APP_URL: process.env.APP_URL || 'http://localhost:3000',
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'check-drift-placeholder-secret-0123456789',
    })
    return readFileSync(output, 'utf8') === readFileSync('src/server/db/schema/auth.ts', 'utf8')
      ? []
      : ['differs: src/server/db/schema/auth.ts (run `pnpm auth:generate`)']
  },

  async database() {
    const url = testDatabaseUrl('drift', process.env.DRIFT_DATABASE_URL)
    await resetTestDatabase(url)
    try {
      const before = await fingerprint(url)
      // Without --strict, push applies whatever the schema needs; on a fresh migrated database that must be nothing.
      const output = run('pnpm', [
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
rmSync(SCRATCH, { recursive: true, force: true })
process.exitCode = failed ? 1 : 0
