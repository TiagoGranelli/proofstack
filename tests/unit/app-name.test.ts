// The app's name lives in package.json (`name`) and src/config/app.ts (APP_NAME); everything else imports it or
// stays neutral, so renaming the app is the short edit in docs/adopting.md. Docs may name the template.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_NAME } from '#/config/app.ts'

/** Where the name may appear: its two homes, the generated API title, the license notice, and prose. */
const ALLOWED = [/^package\.json$/, /^src\/config\/app\.ts$/, /^openapi\.json$/, /^LICENSE$/, /\.md$/]

/**
 * The repository's files: tracked ones from git, or, in the pre-commit hook's copy of the commit (no .git), every
 * file outside the directories .gitignore names (node_modules, and the caches the other gates write meanwhile).
 */
const repositoryFiles = (): string[] => {
  const git = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  if (git.status === 0) return git.stdout.split('\0').filter(Boolean)
  const ignored = new Set(
    readFileSync('.gitignore', 'utf8')
      .split('\n')
      .filter((line) => line.endsWith('/'))
      .map((line) => line.slice(0, -1)),
  )
  return readdirSync('.', { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.parentPath.split(/[\\/]/).some((part) => ignored.has(part)))
    .map((entry) => relative('.', join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
}

describe('the app name', () => {
  it('appears only in package.json, src/config/app.ts and docs', () => {
    const slug = (JSON.parse(readFileSync('package.json', 'utf8')) as { name: string }).name
    const name = new RegExp(`${slug}|${APP_NAME.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
    const offenders = repositoryFiles()
      .filter((file) => !ALLOWED.some((pattern) => pattern.test(file)))
      .filter((file) => {
        try {
          return name.test(readFileSync(file, 'utf8'))
        } catch {
          // A tracked symbolic link to a directory (a skill link) has no text of its own.
          return false
        }
      })
    // Import APP_NAME or pageTitle from #/config/app.ts, or use a neutral identifier (app_, app/…, CHECK_…).
    expect(offenders).toEqual([])
  })
})
