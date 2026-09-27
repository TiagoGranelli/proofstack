// Contract coverage: every status that openapi.json declares for an operation must have been answered at least
// once by the test suites, and every status they saw must be declared. Run by verify:app after a full run (no
// filters, every runner): it reads
// - the app servers' request logs (test-results/app-server*.log: one JSON line per request with method, path
//   and status, from src/server/nitro/http.ts), which the integration and E2E suites produce, and
// - the api layer's responses, which tests/api/harness.ts writes to CONTRACT_OBSERVATIONS when it is set.
// A gap that cannot or should not be tested goes in tests/contract-coverage-allowlist.json with its reason; an
// entry that no longer matches a gap fails too, so the list only shrinks.
// Usage: node scripts/contract-coverage.ts <observations directory> [log file ...]
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

type Operation = { id: string; method: string; pattern: RegExp; declared: Set<number> }
type Observation = { method: string; path: string; status: number }
// `reason` is required, but the file is hand-edited JSON: a missing one is reported, not assumed away.
type AllowEntry = { operation: string; status: number; reason?: string }
type Allowlist = { unobserved: AllowEntry[]; undeclared: AllowEntry[] }

export const ALLOWLIST = 'tests/contract-coverage-allowlist.json'

/** `GET /api/me/posts/{id}` and a pattern matching concrete paths of it. */
export const operations = (spec: {
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>
}): Operation[] =>
  Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      id: `${method.toUpperCase()} ${path}`,
      method: method.toUpperCase(),
      pattern: new RegExp(`^${path.replaceAll(/\{[^}]+\}/g, '[^/]+')}$`),
      declared: new Set(Object.keys(operation.responses).map(Number)),
    })),
  )

/** Requests from Nitro's request log lines; other lines (startup, errors) are skipped. */
export const logObservations = (text: string): Observation[] =>
  text.split('\n').flatMap((line) => {
    if (!line.startsWith('{')) return []
    try {
      const entry = JSON.parse(line) as { msg?: unknown; method?: unknown; path?: unknown; status?: unknown }
      return entry.msg === 'request' &&
        typeof entry.method === 'string' &&
        typeof entry.path === 'string' &&
        typeof entry.status === 'number'
        ? [{ method: entry.method, path: entry.path, status: entry.status }]
        : []
    } catch {
      return []
    }
  })

const matches = (entry: AllowEntry, operation: string, status: number) =>
  (entry.operation === '*' || entry.operation === operation) && entry.status === status

/** Allowlist entries without a reason (the JSON may omit it). */
const unexplained = (entries: AllowEntry[]) =>
  entries
    .filter((entry) => !entry.reason?.trim())
    .map((entry) => `${ALLOWLIST}: ${entry.operation} ${entry.status} needs a reason`)

/** The statuses observed for each operation; a request counts for the first operation whose path it matches. */
const observedStatuses = (ops: Operation[], observed: Observation[]) => {
  const seen = new Map(ops.map((op) => [op, new Set<number>()]))
  for (const { method, path, status } of observed) {
    const op = ops.find((candidate) => candidate.method === method && candidate.pattern.test(path))
    if (op) seen.get(op)?.add(status)
  }
  return seen
}

/** A declared status nobody saw, or a seen status nobody declared, with the allowlist that may excuse it. */
type Gap = { operation: string; status: number; excuses: AllowEntry[]; problem: string }

const gapsOf = (op: Operation, statuses: Set<number>, allowlist: Allowlist): Gap[] => [
  ...[...op.declared]
    .filter((status) => !statuses.has(status))
    .map((status) => ({
      operation: op.id,
      status,
      excuses: allowlist.unobserved,
      problem: `${op.id} declares ${status}, but no test saw it answered`,
    })),
  ...[...statuses]
    .filter((status) => !op.declared.has(status))
    .map((status) => ({
      operation: op.id,
      status,
      excuses: allowlist.undeclared,
      problem: `${op.id} answered ${status}, which openapi.json does not declare`,
    })),
]

/** Problems, one line each; empty when the contract and the observed responses agree. */
export const contractCoverageProblems = (ops: Operation[], observed: Observation[], allowlist: Allowlist): string[] => {
  const entries = [...allowlist.unobserved, ...allowlist.undeclared]
  const used = new Set<AllowEntry>()
  const gaps = [...observedStatuses(ops, observed)].flatMap(([op, statuses]) => gapsOf(op, statuses, allowlist))
  const unexcused = gaps.flatMap(({ operation, status, excuses, problem }) => {
    const entry = excuses.find((candidate) => matches(candidate, operation, status))
    if (entry) used.add(entry)
    return entry ? [] : [problem]
  })
  const stale = entries
    .filter((entry) => !used.has(entry))
    .map((entry) => `${ALLOWLIST}: ${entry.operation} ${entry.status} matches no gap any more; remove it`)
  return [...unexplained(entries), ...unexcused, ...stale]
}

if (import.meta.main) {
  const [observations, ...logs] = process.argv.slice(2)
  if (!observations) {
    console.error('usage: node scripts/contract-coverage.ts <observations directory> [log file ...]')
    process.exit(2)
  }
  const spec = JSON.parse(readFileSync('openapi.json', 'utf8')) as Parameters<typeof operations>[0]
  const fromApp = logs.flatMap((file) => logObservations(readFileSync(file, 'utf8')))
  const observed = [
    ...fromApp,
    ...(existsSync(observations) ? readdirSync(observations) : [])
      .filter((name) => name.endsWith('.jsonl'))
      .flatMap((name) =>
        readFileSync(join(observations, name), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Observation),
      ),
  ]
  const allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as Allowlist
  const ops = operations(spec)
  const problems = contractCoverageProblems(ops, observed, allowlist)
  for (const problem of problems) console.error(problem)
  const pairs = ops.reduce((sum, op) => sum + op.declared.size, 0)
  // For information: declared statuses only the in-memory api layer produced, never the built app.
  const inMemoryOnly = ops.flatMap((op) =>
    [...op.declared]
      .filter(
        (status) => !fromApp.some((o) => o.method === op.method && op.pattern.test(o.path) && o.status === status),
      )
      .map((status) => `${op.id} ${status}`),
  )
  if (inMemoryOnly.length) console.log(`seen only in the api layer, not from the built app: ${inMemoryOnly.join(', ')}`)
  console.log(
    problems.length
      ? `contract coverage: ${problems.length} problem(s)`
      : `contract coverage: all ${pairs} declared operation × status pairs observed (${observed.length} responses)`,
  )
  process.exitCode = problems.length ? 1 : 0
}
