// Agent eval: runs a coding agent on each task in evals/tasks in a throwaway checkout, then grades the result
// with the repo's own gates and the task's hidden checks (docs/agents/evals.md).
// Usage: pnpm agent-eval [--agent='<shell command>'] [--ref=<git ref>] [--keep] [task ...]   (default: every task)
//        pnpm agent-eval --list
//        pnpm agent-eval --self-test   the harness itself: a known-good patch passes, a no-op and a bad patch fail
// The agent command comes from --agent or EVAL_AGENT_CMD and runs with `sh -c` in the checkout, with
// EVAL_PROMPT_FILE, EVAL_TASK, EVAL_WORKDIR and EVAL_SOURCE set. It reads its credentials from its own
// environment; this script never handles keys. For example:
//   EVAL_AGENT_CMD='claude -p --permission-mode bypassPermissions "$(cat "$EVAL_PROMPT_FILE")"' pnpm agent-eval
//   EVAL_AGENT_CMD='codex exec --sandbox workspace-write - < "$EVAL_PROMPT_FILE"' pnpm agent-eval
// The checkout is a new git repository made from `git archive <ref>` without evals/, outside this repository
// (EVAL_WORKDIR_ROOT, default ~/.cache/proofstack/evals): the agent cannot read the hidden checks, the reference
// solutions or this repository's history. Results go to evals/results/ (ignored by git).
import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const SOURCE = process.cwd()
const EVALS = join(SOURCE, 'evals')
const RESULTS = join(EVALS, 'results')
const WORK_ROOT = process.env.EVAL_WORKDIR_ROOT ?? join(homedir(), '.cache', 'proofstack', 'evals')
/** Paths a generator writes: counted apart in the diff size, since they grow with the change, not the effort. */
const GENERATED = [/^src\/sdk\//, /^openapi\.json$/, /^src\/routeTree\.gen\.ts$/, /^drizzle\/meta\//]
const isGenerated = (path: string) => GENERATED.some((pattern) => pattern.test(path))

interface Task {
  readonly id: string
  readonly prompt: string
  readonly meta: Readonly<Record<string, string>>
}

interface Step {
  readonly ok: boolean
  readonly seconds: number
  readonly log: string
}

const option = (name: string) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? undefined
const flag = (name: string) => process.argv.includes(`--${name}`)

/** `key: value` lines between `---` markers, and the Markdown after them (the prompt the agent gets). */
const parseTask = (id: string, text: string): Task => {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  const lines = match?.[1]?.split('\n') ?? []
  const meta = Object.fromEntries(
    lines.map((line) => /^(\w+):\s*(.*)$/.exec(line)).flatMap((m) => (m?.[1] ? [[m[1], m[2] ?? '']] : [])),
  )
  return { id, prompt: (match?.[2] ?? text).trim(), meta }
}

const loadTasks = () =>
  readdirSync(join(EVALS, 'tasks'))
    .filter((file) => file.endsWith('.md'))
    .map((file) => parseTask(basename(file, '.md'), readFileSync(join(EVALS, 'tasks', file), 'utf8')))
    .toSorted((a, b) => a.id.localeCompare(b.id))

/** Runs a command in `cwd`, appending its output to `log`. */
const step = (log: string, command: string, args: string[], options: SpawnSyncOptions = {}): Step => {
  const started = performance.now()
  writeFileSync(log, `$ ${command} ${args.join(' ')}\n`, { flag: 'a' })
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options })
  writeFileSync(log, `${String(result.stdout)}${String(result.stderr)}\n`, { flag: 'a' })
  return { ok: result.status === 0, seconds: Math.round(performance.now() - started) / 1000, log }
}

const must = (result: Step, what: string) => {
  if (!result.ok) throw new Error(`${what} failed; see ${result.log}`)
}

/** A fresh repository holding `ref`'s tree without evals/, the task's setup applied, and its dependencies. */
const prepare = (task: Task, dir: string, log: string, ref: string) => {
  const archive = spawnSync('git', ['archive', '--format=tar', ref, '--', '.', ':(exclude)evals'], { maxBuffer: 1e9 })
  if (archive.status !== 0) throw new Error(`git archive ${ref} failed: ${String(archive.stderr)}`)
  must(step(log, 'tar', ['-x', '-C', dir], { input: archive.stdout }), 'unpacking the archive')
  if (task.meta.setup) must(step(log, 'git', ['apply', join(EVALS, task.meta.setup)], { cwd: dir }), 'the setup patch')
  const git = (args: string[]) => must(step(log, 'git', args, { cwd: dir }), `git ${args[0] ?? ''}`)
  git(['init', '--quiet', '--initial-branch=main'])
  git(['add', '--all'])
  // The harness's own commit: the agent's pre-commit hook is not installed yet.
  git([
    '-c',
    'user.name=eval',
    '-c',
    'user.email=eval@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'Baseline',
  ])
  must(step(log, 'pnpm', ['install', '--frozen-lockfile', '--offline', '--reporter=silent'], { cwd: dir }), 'install')
}

const runAgent = (task: Task, dir: string, log: string, command: string) => {
  const promptFile = join(dir, '..', `${basename(dir)}.prompt.md`)
  writeFileSync(promptFile, `${task.prompt}\n`)
  const minutes = Number(task.meta.timeout_minutes ?? 30)
  const env = {
    ...process.env,
    EVAL_PROMPT_FILE: promptFile,
    EVAL_TASK: task.id,
    EVAL_WORKDIR: dir,
    EVAL_SOURCE: SOURCE,
  }
  return step(log, 'sh', ['-c', command], { cwd: dir, env, timeout: minutes * 60_000 })
}

/** Files, insertions and deletions against the baseline, hand-written and generated apart. */
const diffSize = (dir: string) => {
  spawnSync('git', ['add', '--all'], { cwd: dir })
  const numstat = spawnSync('git', ['diff', '--cached', '--numstat', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout
  const rows = numstat
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .map(([added = '0', deleted = '0', path = '']) => ({
      added: Number(added) || 0,
      deleted: Number(deleted) || 0,
      path,
    }))
  const sum = (list: typeof rows) => ({
    files: list.length,
    insertions: list.reduce((total, row) => total + row.added, 0),
    deletions: list.reduce((total, row) => total + row.deleted, 0),
  })
  return {
    handWritten: sum(rows.filter((row) => !isGenerated(row.path))),
    generated: sum(rows.filter((row) => isGenerated(row.path))),
  }
}

/** Copies the task's hidden checks into the checkout (evals/checks/<task>/<layer>.test.ts[x]) and runs each layer. */
const hiddenChecks = (task: Task, dir: string, log: string): Step => {
  const folder = join(EVALS, 'checks', task.id)
  const files = existsSync(folder) ? readdirSync(folder).filter((file) => /^\w+\.test\.tsx?$/.test(file)) : []
  const steps = files.map((file) => {
    const layer = file.slice(0, file.indexOf('.'))
    const target = `eval-${task.id}.test${file.slice(file.lastIndexOf('.'))}`
    copyFileSync(join(folder, file), join(dir, 'tests', layer, target))
    return step(log, 'pnpm', [`test:${layer}`, `eval-${task.id}`], { cwd: dir })
  })
  return {
    ok: steps.length > 0 && steps.every((result) => result.ok),
    seconds: Math.round(steps.reduce((total, result) => total + result.seconds, 0) * 1000) / 1000,
    log,
  }
}

/** Grades the checkout: the diff first (before the hidden checks are copied in), then the gates. */
const grade = (task: Task, dir: string, logs: string) => {
  const diff = diffSize(dir)
  const check = step(join(logs, 'check.log'), 'pnpm', ['check'], { cwd: dir })
  const drift = step(join(logs, 'drift.log'), 'pnpm', ['check:drift', 'contract', 'migrations', 'auth'], { cwd: dir })
  const hidden = hiddenChecks(task, dir, join(logs, 'hidden.log'))
  return { diff, gates: { check, drift, hidden }, pass: check.ok && drift.ok && hidden.ok }
}

const redact = (command: string) => command.replaceAll(/((?:key|token|secret|password)\w*=)\S+/gi, '$1<redacted>')

const evaluate = (task: Task, command: string, options: { ref: string; keep: boolean; label: string }) => {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
  const name = `${stamp}-${options.label}-${task.id}`
  const logs = join(RESULTS, name)
  mkdirSync(logs, { recursive: true })
  mkdirSync(WORK_ROOT, { recursive: true })
  const dir = mkdtempSync(join(WORK_ROOT, `${task.id}-`))
  const started = performance.now()
  try {
    prepare(task, dir, join(logs, 'setup.log'), options.ref)
    const agent = runAgent(task, dir, join(logs, 'agent.log'), command)
    const graded = grade(task, dir, logs)
    const result = {
      task: task.id,
      label: options.label,
      agentCommand: redact(command),
      ref: options.ref,
      agent: { exitOk: agent.ok, seconds: Math.round(agent.seconds) },
      ...graded,
      seconds: Math.round((performance.now() - started) / 1000),
      workdir: options.keep ? dir : undefined,
    }
    writeFileSync(join(RESULTS, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`)
    return result
  } finally {
    if (!options.keep) rmSync(dir, { recursive: true, force: true })
    rmSync(`${dir}.prompt.md`, { force: true })
  }
}

type Result = ReturnType<typeof evaluate>
const mark = (s: Step) => (s.ok ? 'ok' : 'FAIL')

const summary = (result: Result) => {
  const { check, drift, hidden } = result.gates
  const { files, insertions, deletions } = result.diff.handWritten
  return (
    `${result.pass ? 'PASS' : 'FAIL'}  ${result.task} (${result.label}): check ${mark(check)}, drift ${mark(drift)}, ` +
    `hidden ${mark(hidden)}; agent ${result.agent.seconds}s, total ${result.seconds}s; ` +
    `${files} files +${insertions} -${deletions} by hand, ${result.diff.generated.files} generated`
  )
}

/** Stub agents apply a patch from evals/, so the harness is tested without a paid agent. */
const SELF_TEST = [
  { label: 'good-patch', command: 'git apply "$EVAL_SOURCE/evals/solutions/fix-post-length-check.patch"', pass: true },
  { label: 'no-op', command: 'true', pass: false },
  { label: 'bad-patch', command: 'git apply "$EVAL_SOURCE/evals/stubs/bad-fix-post-length-check.patch"', pass: false },
] as const

const selfTest = (ref: string) => {
  const task = loadTasks().find((candidate) => candidate.id === 'fix-post-length-check')
  if (!task) throw new Error('evals/tasks/fix-post-length-check.md is missing')
  const outcomes = SELF_TEST.map((stub) => {
    const result = evaluate(task, stub.command, { ref, keep: false, label: `self-test-${stub.label}` })
    console.log(summary(result))
    return result.pass === stub.pass
  })
  // The no-op run must fail on the hidden checks alone: the setup weakened the visible test on purpose.
  return outcomes.every(Boolean)
}

const main = () => {
  const tasks = loadTasks()
  if (flag('list')) {
    for (const task of tasks) console.log(`${task.id.padEnd(24)} ${task.meta.title ?? ''}`)
    return 0
  }
  const ref = option('ref') ?? 'HEAD'
  if (flag('self-test')) {
    const ok = selfTest(ref)
    console.log(ok ? '\nself-test: ok' : '\nself-test: FAILED (see evals/results/)')
    return ok ? 0 : 1
  }
  const command = option('agent') ?? process.env.EVAL_AGENT_CMD
  if (!command) {
    console.error("Set the agent command: --agent='<shell command>' or EVAL_AGENT_CMD (docs/agents/evals.md)")
    return 2
  }
  const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
  const unknown = wanted.filter((id) => !tasks.some((task) => task.id === id))
  if (unknown.length > 0) {
    console.error(`unknown task(s): ${unknown.join(', ')}; see pnpm agent-eval --list`)
    return 2
  }
  const selected = wanted.length > 0 ? tasks.filter((task) => wanted.includes(task.id)) : tasks
  const results = selected.map((task) => evaluate(task, command, { ref, keep: flag('keep'), label: 'run' }))
  for (const result of results) console.log(summary(result))
  console.log(
    `\n${results.filter((result) => result.pass).length}/${results.length} passed; details in ${resolve(RESULTS)}`,
  )
  return 0
}

process.exitCode = main()
