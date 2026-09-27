// scripts/agent-hook.ts, the Claude Code hooks in .claude/settings.json: which edited files get formatted and
// linted, and which shell commands are refused.
import { describe, expect, it } from 'vitest'
import { blockedCommand, editTarget, migrationTag, projectRoot, toolOf } from '../../scripts/agent-hook.ts'

const ROOT = '/work/proofstack'

describe('projectRoot', () => {
  const checkout = new Set([`${ROOT}/.oxlintrc.json`, `${ROOT}/node_modules/.bin/oxlint`])

  it('is the nearest directory with the Oxc config and the installed binary', () => {
    expect(projectRoot(`${ROOT}/src/features/posts/api/create-post.ts`, (path) => checkout.has(path))).toBe(ROOT)
  })

  it('is undefined outside a checkout', () => {
    expect(projectRoot('/tmp/scratch/x.ts', (path) => checkout.has(path))).toBeUndefined()
  })
})

describe('editTarget', () => {
  it('formats and lints a source file, by its path relative to the root', () => {
    expect(editTarget(`${ROOT}/src/lib/utils.ts`, ROOT)).toEqual({
      root: ROOT,
      path: 'src/lib/utils.ts',
      format: true,
      lint: true,
    })
  })

  it('only formats JSON and CSS', () => {
    expect(editTarget(`${ROOT}/package.json`, ROOT)).toMatchObject({ format: true, lint: false })
    expect(editTarget(`${ROOT}/src/styles/app.css`, ROOT)).toMatchObject({ format: true, lint: false })
  })

  it.each([
    ['Markdown', `${ROOT}/AGENTS.md`],
    ['a dependency', `${ROOT}/node_modules/effect/src/Effect.ts`],
    ['a vendored snapshot', `${ROOT}/repos/effect/src/index.ts`],
    ['build output', `${ROOT}/.output/server/index.mjs`],
    ['a file outside the checkout', '/etc/hosts.json'],
    ['the root itself', ROOT],
  ])('leaves %s alone', (_, file) => {
    expect(editTarget(file, ROOT)).toBeUndefined()
  })

  it('leaves input without a usable path alone', () => {
    expect(editTarget(undefined, ROOT)).toBeUndefined()
    expect(editTarget('src/lib/utils.ts', ROOT)).toBeUndefined()
    expect(editTarget(`${ROOT}/src/lib/utils.ts`, undefined)).toBeUndefined()
  })
})

describe('migrationTag', () => {
  it('names the migration of a SQL file in drizzle/ and nothing else', () => {
    expect(migrationTag('drizzle/0004_auth_timestamptz.sql')).toBe('0004_auth_timestamptz')
    expect(migrationTag('drizzle/meta/_journal.json')).toBeUndefined()
    expect(migrationTag('src/server/db/schema/posts.ts')).toBeUndefined()
  })
})

describe('toolOf', () => {
  it.each([
    [['eslint', '.'], 'eslint', ['.']],
    [['npx', '-y', 'prettier@3', '--write', '.'], 'prettier', ['--write', '.']],
    [['pnpm', 'dlx', '@biomejs/biome', 'check'], 'biome', ['check']],
    [['pnpm', 'exec', 'oxlint', '-c', 'x.json'], 'oxlint', ['-c', 'x.json']],
    [['node_modules/.bin/oxfmt', '--no-ignore'], 'oxfmt', ['--no-ignore']],
    [['pnpm', 'lint', '--no-ignore'], 'oxlint', ['--no-ignore']],
    [['pnpm', 'run', 'format', 'src'], 'oxfmt', ['src']],
    [['pnpm', 'check'], 'pnpm', ['check']],
  ])('%j runs %s', (words, tool, args) => {
    expect(toolOf(words)).toEqual({ tool, args })
  })
})

describe('blockedCommand', () => {
  it.each([
    'git commit --no-verify -m wip',
    'git commit -n -m wip',
    'git commit -anm wip',
    'git add -A && git commit -qn -F msg.txt',
    'HUSKY=0 git -C /work/proofstack commit --no-verify',
    'git -c core.hooksPath=/dev/null commit -m wip',
  ])('refuses a commit that skips the hook: %s', (command) => {
    expect(blockedCommand(command)).toMatch(/pre-commit hook/)
  })

  it.each([
    'git commit -m "fix -n handling"',
    'git commit -mn',
    'git commit -F msg.txt',
    "git commit -m 'no --no-verify here'",
    'git log -n 5',
    'git commit --amend --no-edit',
  ])('lets a normal commit or git command through: %s', (command) => {
    expect(blockedCommand(command)).toBeUndefined()
  })

  it.each(['npx eslint .', 'pnpm dlx prettier --write .', 'cd src && biome check'])(
    'refuses a linter or formatter the repo does not use: %s',
    (command) => {
      expect(blockedCommand(command)).toMatch(/oxfmt and lints with oxlint/)
    },
  )

  it.each([
    'pnpm exec oxlint --no-ignore .',
    'pnpm lint -c /tmp/other.json',
    'node_modules/.bin/oxfmt --ignore-path=/dev/null .',
    'pnpm exec oxlint --config=/tmp/x.json src',
  ])('refuses an Oxc run without the ignore lists: %s', (command) => {
    expect(blockedCommand(command)).toMatch(/ignore lists/)
  })

  it.each([
    'pnpm check',
    'pnpm lint src/x.ts',
    'pnpm exec oxfmt --check src/x.ts',
    'pnpm format',
    'git commit -F - <<EOF\nReplace prettier with oxfmt\nEOF',
    'echo "eslint --no-ignore" > notes.txt',
    'rg -n prettier docs',
  ])('lets the usual commands through: %s', (command) => {
    expect(blockedCommand(command)).toBeUndefined()
  })
})
