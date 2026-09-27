// Hidden check of the eval task add-profile-page (the wiring). evals/grade.sh copies it to tests/unit/ after the
// agent has finished; it is never in the agent's checkout.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('eval: add-profile-page wiring', () => {
  it('has the page under the signed-in layout, not indexed', () => {
    expect(existsSync('src/routes/_authed/profile.tsx')).toBe(true)
    const route = read('src/routes/_authed/profile.tsx')
    expect(route).toContain('Profile · ProofStack')
    expect(route).toMatch(/noindex/)
  })

  it('exposes only the update-user endpoint it needs, through a validated server function', () => {
    expect(read('src/server/http/auth-endpoints.ts')).toContain("'POST /update-user'")
    const functions = read('src/lib/auth.functions.ts')
    expect(functions).toMatch(/export const updateName\b/)
    expect(functions).toContain("'/update-user'")
    expect(read('tests/component/stubs/auth-functions.ts')).toMatch(/export const updateName\b/)
  })

  it('covers the page in the accessibility suites', () => {
    expect(read('tests/e2e/a11y.spec.ts')).toContain("'/profile'")
    expect(read('tests/e2e/keyboard.spec.ts')).toContain("'/profile'")
  })
})
