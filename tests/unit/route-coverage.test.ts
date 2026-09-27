// scripts/route-coverage.ts, the `routes` gate of `pnpm check`: which files are pages, and which pages a spec
// block reaches.
import { describe, expect, it } from 'vitest'
import { pagePath, reachedPaths, routeCoverageProblems } from '../../scripts/route-coverage.ts'

describe('pagePath', () => {
  it.each([
    ['index.tsx', '/'],
    ['about.tsx', '/about'],
    ['_authed/dashboard.tsx', '/dashboard'],
    ['(marketing)/pricing/index.tsx', '/pricing'],
    ['posts/$id.tsx', '/posts/$id'],
  ])('%s is the page %s', (file, path) => {
    expect(pagePath(file)).toBe(path)
  })

  it.each(['__root.tsx', '_authed.tsx', 'api/$.ts', 'api/auth/$.ts', '-private/helper.tsx'])(
    '%s is no page',
    (file) => {
      expect(pagePath(file)).toBeUndefined()
    },
  )
})

describe('reachedPaths', () => {
  it('reads visited paths without their query, and the helpers that reach a page', () => {
    const block = `visit(page, '/verify-email?token=x'); visit(page, '/about'); visit(page, '/')
      await navigateWithApiResponse(page, '/api/me', { status: 503, json: {} })`
    expect([...reachedPaths(block)].toSorted()).toEqual(['/', '/about', '/dashboard', '/verify-email'])
  })
})

describe('the repository', () => {
  it('covers every page route', () => {
    expect(routeCoverageProblems()).toEqual([])
  })
})
