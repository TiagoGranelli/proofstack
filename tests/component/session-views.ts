// The sessions the account page lists, for the tests of the session list and of the forms that refresh it.
import type { ReactNode } from 'react'
import { sessionsQueryKey } from '#/features/auth/api/get-sessions.ts'
import type { AuthOutcome, SessionView } from '#/lib/auth.functions.ts'
import { authFunction } from './api-mocks.ts'
import { renderInApp, testQueryClient } from './test-utils.tsx'

const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const session = (overrides: Partial<SessionView>): SessionView => ({
  id: crypto.randomUUID(),
  current: false,
  createdAt: '2026-09-01T10:00:00.000Z',
  lastActiveAt: '2026-09-20T12:30:00.000Z',
  ipAddress: '198.51.100.7',
  userAgent: FIREFOX_LINUX,
  ...overrides,
})
/** The session of the browser the page runs in: Firefox on Linux. */
export const thisBrowser = session({ current: true, lastActiveAt: '2026-09-27T09:00:00.000Z' })
/** Another session, Chrome on Windows, whose address Better Auth did not keep. */
export const phone = session({ userAgent: CHROME_WINDOWS, ipAddress: null })
/** The accessible name of `phone`'s Sign out button. */
export const otherName = 'Sign out Chrome on Windows, signed in 2026-09-01 10:00 UTC'

/** The outcome of listing `sessions`, as the listSessions server function answers it. */
export const listed = (...sessions: SessionView[]) => ({ ok: true, value: sessions }) as const
/** Answers the listSessions server function with `sessions`, for the refetch after an action. */
export const listSessions = (...sessions: SessionView[]) =>
  authFunction<ReadonlyArray<SessionView>>('listSessions', listed(...sessions))

/** Renders `ui` with the session list already loaded (the route loader does that in the app). */
export const renderWithSessions = (ui: ReactNode, sessions: AuthOutcome<ReadonlyArray<SessionView>>) => {
  const queryClient = testQueryClient()
  queryClient.setQueryData(sessionsQueryKey, sessions)
  return renderInApp(ui, { url: '/account', queryClient })
}
