// Claude Code PostToolUse hook on Edit|Write|MultiEdit (.claude/settings.json). Formats the edited file with oxfmt
// and lints that one file with oxlint; a problem goes back to Claude as `{"decision": "block", "reason"}`
// (https://code.claude.com/docs/en/hooks#posttooluse-decision-control). Files the Oxc configs ignore (generated
// code, Markdown, node_modules) are skipped, and so is anything outside this checkout.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(import.meta.dirname, '..')
const input = JSON.parse(readFileSync(0, 'utf8')) as { tool_input?: { file_path?: string } }
const file = relative(root, input.tool_input?.file_path ?? root)
const run = (tool: string, args: string[]) =>
  spawnSync(join('node_modules', '.bin', tool), [...args, '--no-error-on-unmatched-pattern', file], {
    cwd: root,
    encoding: 'utf8',
  })

if (file !== '' && !file.startsWith('..')) {
  const format = run('oxfmt', [])
  // A file oxfmt cannot parse gets the same parse error from oxlint: report it once.
  const check = format.status === 0 ? run('oxlint', ['--deny-warnings', '--format=unix']) : format
  if (check.status !== 0) {
    const reason = `${check.stdout}${check.stderr}`.trim()
    console.log(JSON.stringify({ decision: 'block', reason: `${reason}\n\nFix this in ${file}.` }))
  }
}
