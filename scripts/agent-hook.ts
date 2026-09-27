// Claude Code hooks (.claude/settings.json). Each reads the hook's JSON input on stdin
// (https://code.claude.com/docs/en/hooks). Local tools only: no network, no repository-wide run.
// Usage: node scripts/agent-hook.ts post-edit   PostToolUse on Edit|Write|MultiEdit: formats the edited file with
//                                                oxfmt, lints that one file with oxlint, and hands problems back to
//                                                the agent (`decision: "block"` adds the reason to the tool result).
//        node scripts/agent-hook.ts pre-edit    PreToolUse on Edit|Write|MultiEdit: exit 2 blocks an edit to a
//                                                migration already in the journal at HEAD.
//        node scripts/agent-hook.ts pre-bash    PreToolUse on Bash: exit 2 blocks a command that skips the
//                                                pre-commit hook or runs a linter or formatter without the repo's
//                                                ignore lists (AGENTS.md, "Memory safety").
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path'

const FORMATTED = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc', '.css'])
const LINTED = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
/** Never handed to a tool, whatever the tool's own config says (AGENTS.md, "Memory safety"). */
const OUT_OF_SCOPE = new Set(['node_modules', 'repos', '.output', '.git'])

/** The checkout that holds `file`: the nearest directory above it with the Oxc config and installed binaries. */
export const projectRoot = (file: string, exists: (path: string) => boolean = existsSync): string | undefined => {
  let dir = dirname(file)
  for (;;) {
    if (exists(join(dir, '.oxlintrc.json')) && exists(join(dir, 'node_modules', '.bin', 'oxlint'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export interface EditTarget {
  readonly root: string
  /** Path relative to `root`, the only path the tools receive. */
  readonly path: string
  readonly format: boolean
  readonly lint: boolean
}

/** What to run on an edited file, or undefined when it is outside a checkout or out of the tools' scope. */
export const editTarget = (file: unknown, root: string | undefined): EditTarget | undefined => {
  if (typeof file !== 'string' || !isAbsolute(file) || root === undefined) return undefined
  const path = relative(root, file)
  const parts = path.split(sep)
  if (path === '' || isAbsolute(path) || parts[0] === '..' || parts.some((part) => OUT_OF_SCOPE.has(part))) {
    return undefined
  }
  const extension = extname(path)
  const target = { root, path, format: FORMATTED.has(extension), lint: LINTED.has(extension) }
  return target.format || target.lint ? target : undefined
}

const run = (root: string, tool: string, args: string[]) =>
  spawnSync(join(root, 'node_modules', '.bin', tool), args, { cwd: root, encoding: 'utf8', timeout: 20_000 })

/** Problems oxfmt and oxlint report for the one file, in their own words. Empty when both are clean. */
const checkEdit = ({ root, path, format, lint }: EditTarget): string | undefined => {
  if (format) {
    // Writes the file; a parse error leaves it unchanged and exits non-zero. An ignored file is skipped. A file
    // oxfmt cannot parse gets the same parse error from oxlint, so it is reported once.
    const result = run(root, 'oxfmt', ['--no-error-on-unmatched-pattern', path])
    if (result.status !== 0) return `oxfmt could not format ${path}:\n${result.stderr || result.stdout}`.trim()
  }
  if (lint) {
    // Without --type-aware (about 0.6 s instead of 1 s): `pnpm check` runs the type-aware rules too.
    const result = run(root, 'oxlint', ['--deny-warnings', '--no-error-on-unmatched-pattern', '--format=unix', path])
    if (result.status !== 0) return `oxlint found problems in ${path}:\n${result.stdout || result.stderr}`.trim()
  }
  return undefined
}

const postEdit = (input: { tool_input?: { file_path?: unknown } }) => {
  const file = input.tool_input?.file_path
  const target = editTarget(file, typeof file === 'string' ? projectRoot(file) : undefined)
  if (target === undefined || !existsSync(join(target.root, target.path))) return
  const problems = checkEdit(target)
  if (problems === undefined) return
  const reason =
    `${problems}\n\nFix these in ${target.path} now. A rule that is wrong for one line takes ` +
    '`// oxlint-disable-next-line <rule>` under a comment line that says why.'
  process.stdout.write(JSON.stringify({ decision: 'block', reason }))
}

// ---------------------------------------------------------------------------------------------------------------
// pre-edit

/** The migration tag of `drizzle/<tag>.sql`, or undefined for any other path. */
export const migrationTag = (path: string) => /^drizzle[/\\]([^/\\]+)\.sql$/.exec(path)?.[1]

/** Tags in the journal at HEAD: migrations that databases may have applied (the `applied-migrations` guard). */
const appliedTags = (root: string) => {
  const journal = spawnSync('git', ['show', 'HEAD:drizzle/meta/_journal.json'], { cwd: root, encoding: 'utf8' })
  if (journal.status !== 0) return new Set<string>()
  const { entries } = JSON.parse(journal.stdout) as { entries: { tag: string }[] }
  return new Set(entries.map((entry) => entry.tag))
}

/** Refuses an edit to a committed migration (the generated files are denied in .claude/settings.json). */
const preEdit = (input: { tool_input?: { file_path?: unknown } }) => {
  const file = input.tool_input?.file_path
  const root = typeof file === 'string' && isAbsolute(file) ? projectRoot(file) : undefined
  const tag = root === undefined ? undefined : migrationTag(relative(root, file as string))
  if (root === undefined || tag === undefined || !appliedTags(root).has(tag)) return
  process.stderr.write(
    `Blocked: drizzle/${tag}.sql is in the migration journal at HEAD, so databases may have applied it and will ` +
      'never run an edit. Change src/server/db/schema/ and run `pnpm db:generate --name <slug>` for a new ' +
      'migration (skill database-change).\n',
  )
  process.exitCode = 2
}

// ---------------------------------------------------------------------------------------------------------------
// pre-bash

/** Quoted strings (a commit message, a pattern) become one placeholder word, so their text is never a flag. */
const withoutQuotes = (command: string) => command.replaceAll(/"(?:[^"\\]|\\.)*"|'[^']*'/g, 'QUOTED')

/** Words of each shell command: split at `;`, `&&`, `||`, `|` and newlines, leading `VAR=value` dropped. */
const commands = (command: string) =>
  withoutQuotes(command)
    .split(/\n|;|&&|\|\||\|/)
    .map((part) => part.trim().split(/\s+/).filter(Boolean))
    .map((words) =>
      words.slice(
        Math.max(
          0,
          words.findIndex((word) => !/^\w+=/.test(word)),
        ),
      ),
    )
    .filter((words) => words.length > 0)

/** Short `git commit` options that take a value, so a letter after them in a cluster is that value. */
const COMMIT_VALUE_FLAGS = new Set(['m', 'F', 'c', 'C', 't', 'u'])

/** Whether one short-option cluster of `git commit` (`-anm`) contains `-n`, the short form of `--no-verify`. */
const clusterSkipsHooks = (cluster: string) => {
  for (const letter of cluster.slice(1)) {
    if (letter === 'n') return true
    if (COMMIT_VALUE_FLAGS.has(letter)) return false
  }
  return false
}

const skipsCommitHook = (words: readonly string[]) => {
  const commit = words.indexOf('commit')
  if (words[0] !== 'git' || commit === -1) return false
  if (words.slice(1, commit).some((word) => /^core\.hookspath=/i.test(word))) return true
  return words
    .slice(commit + 1)
    .some((word) => word === '--no-verify' || (/^-[A-Za-z]+$/.test(word) && clusterSkipsHooks(word)))
}

/** The package scripts that run an Oxc tool, so their extra arguments reach it. */
const SCRIPT_TOOLS = new Map([
  ['lint', 'oxlint'],
  ['lint:fix', 'oxlint'],
  ['format', 'oxfmt'],
  ['format:check', 'oxfmt'],
])

/** The tool a command runs (directly, by path, through npx, bunx, pnpm exec/dlx or a package script) and its arguments. */
export const toolOf = (words: readonly string[]): { tool: string; args: readonly string[] } => {
  const [first = '', second = ''] = words
  const scriptAt = first === 'pnpm' ? (second === 'run' ? 2 : 1) : -1
  const script = SCRIPT_TOOLS.get(words[scriptAt] ?? '')
  if (script !== undefined) return { tool: script, args: words.slice(scriptAt + 1) }
  const viaRunner = first === 'npx' || first === 'bunx' || (first === 'pnpm' && ['exec', 'dlx'].includes(second))
  const rest = words.slice(viaRunner ? (first === 'pnpm' ? 2 : 1) : 0)
  const index = viaRunner
    ? Math.max(
        0,
        rest.findIndex((word) => !word.startsWith('-')),
      )
    : 0
  const name = (rest[index] ?? '').split('/').at(-1) ?? ''
  return { tool: name.replace(/(?<=.)@.*$/, ''), args: rest.slice(index + 1) }
}

/** Linters and formatters this repo does not use: their default scope includes node_modules and repos/. */
const FOREIGN_TOOLS = new Set(['eslint', 'prettier', 'biome', 'dprint', 'standard'])
/** Options that switch off or replace the ignore lists of oxlint and oxfmt. */
const UNSCOPING = /^(?:--no-ignore|-c|--config|--ignore-path)(?:=|$)/

const COMMIT_HOOK =
  'Blocked: this commit would skip the pre-commit hook, which runs `pnpm check` on what is committed. Run ' +
  '`pnpm check`, fix what it reports, and commit with the hook.'
const UNSCOPED =
  'Blocked: --no-ignore, -c/--config and --ignore-path replace the ignore lists in .oxlintrc.json and ' +
  '.oxfmtrc.json, and a lint run over node_modules or repos/ once used 17 GB. Use `pnpm lint`, `pnpm format`, ' +
  'or pass explicit file paths.'

/** Why a Bash command is refused, or undefined to let the normal permission flow decide. */
export const blockedCommand = (command: string): string | undefined => {
  for (const words of commands(command)) {
    if (skipsCommitHook(words)) return COMMIT_HOOK
    const { tool, args } = toolOf(words)
    if (FOREIGN_TOOLS.has(tool)) {
      return (
        `Blocked: this repo formats with oxfmt and lints with oxlint, not ${tool}; their configs keep ` +
        'node_modules, .output and repos/ out of scope. Use `pnpm format`, `pnpm lint`, or one file: ' +
        '`pnpm lint src/x.ts`, `pnpm exec oxfmt src/x.ts`.'
      )
    }
    if ((tool === 'oxlint' || tool === 'oxfmt') && args.some((arg) => UNSCOPING.test(arg))) return UNSCOPED
  }
  return undefined
}

const preBash = (input: { tool_input?: { command?: unknown } }) => {
  const command = input.tool_input?.command
  const reason = typeof command === 'string' ? blockedCommand(command) : undefined
  if (reason === undefined) return
  process.stderr.write(`${reason}\n`)
  process.exitCode = 2
}

if (import.meta.main) {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}') as Record<string, never>
  const mode = process.argv[2]
  if (mode === 'post-edit') postEdit(input)
  else if (mode === 'pre-edit') preEdit(input)
  else if (mode === 'pre-bash') preBash(input)
  else {
    process.stderr.write('usage: node scripts/agent-hook.ts post-edit|pre-edit|pre-bash < hook-input.json\n')
    process.exitCode = 1
  }
}
