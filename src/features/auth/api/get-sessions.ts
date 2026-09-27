import { queryOptions } from '@tanstack/react-query'
import { listSessions } from '#/lib/auth.functions.ts'

export const sessionsQueryKey = ['auth', 'sessions'] as const

/**
 * The signed-in account's active sessions, as an AuthOutcome: a refusal such as SESSION_NOT_FRESH is data the
 * page renders (and SSR hands to the client), not an error to retry.
 */
export const getSessionsQueryOptions = () => queryOptions({ queryKey: sessionsQueryKey, queryFn: () => listSessions() })
