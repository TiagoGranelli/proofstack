// Shared by the `db` project: statement counting for query budgets, and throwaway authors.
import { Client } from 'pg'
import { expect, vi } from 'vitest'
import { auth } from '#/server/auth.ts'

const textOf = (query: unknown) =>
  typeof query === 'string' ? query : String((query as { text?: unknown } | null)?.text ?? query)

/**
 * Runs `work` and returns the SQL statements every pg client of this process sent meanwhile (the app's pool
 * included: Drizzle, Better Auth's adapter and the rate-limit storage all go through it). Test-only
 * instrumentation on pg's Client, so production code needs no hook.
 */
export async function statementsOf<A>(work: () => Promise<A>): Promise<{ result: A; statements: string[] }> {
  const spy = vi.spyOn(Client.prototype, 'query')
  try {
    const result = await work()
    return { result, statements: spy.mock.calls.map(([query]) => textOf(query)) }
  } finally {
    spy.mockRestore()
  }
}

/** Fails, naming `what` and listing the statements, unless exactly `budget` statements ran. */
export const expectBudget = (what: string, statements: string[], budget: number) => {
  expect(
    statements,
    `${what} issued ${statements.length} SQL statements, its budget is ${budget}:\n${statements.join('\n')}`,
  ).toHaveLength(budget)
}

/** A verified account with a password, created the way `pnpm user:create` does it. */
export const createAccount = async (label: string) => {
  const context = await auth.$context
  const password = `pw-${crypto.randomUUID()}`
  const created = await context.internalAdapter.createUser(
    { email: `${label}-${crypto.randomUUID()}@example.test`, name: `DB ${label}`, emailVerified: true },
    { method: 'email-password' },
  )
  await context.internalAdapter.linkAccount({
    userId: created.id,
    providerId: 'credential',
    accountId: created.id,
    password: await context.password.hash(password),
  })
  return { id: created.id, name: created.name, email: created.email, password }
}
