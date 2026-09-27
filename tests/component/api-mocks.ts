// Network mocks for component tests. Contract endpoints use the MSW handlers Hey API generates from
// openapi.json (src/sdk/msw.gen.ts), so a mock cannot drift from the contract: paths, methods and success
// bodies are typed by it, and `apiError` only accepts a status and body the operation declares.
// Account actions are server functions outside the contract (src/lib/auth.functions.ts); `auth` mocks them
// through their component-test stub (tests/component/stubs/auth-functions.ts), typed by their AuthOutcome.
import type { InfiniteData } from '@tanstack/react-query'
import { http, HttpResponse, type HttpHandler, type JsonBodyType } from 'msw'
import { setupWorker } from 'msw/browser'
import type { AuthOutcome } from '#/lib/auth.functions.ts'
import { createMswHandlers, type MswHandlerFactories } from '#/sdk/msw.gen.ts'
import type {
  MyPostsCreateErrors,
  MyPostsListErrors,
  MyPostsRemoveErrors,
  MyPostsUpdateErrors,
  Post,
  PostPage,
  PublicPostsListErrors,
  SystemReadyErrors,
} from '#/sdk/types.gen.ts'
import { type AuthFunctionName, authFunctionPath } from './stubs/auth-functions.ts'

/** Started and reset by tests/component/setup.ts. Add handlers per test with `worker.use(...)`. */
export const worker = setupWorker()

/**
 * One factory per contract operation, e.g. `api.myPostsCreate({ body: post })` for a success, or
 * `api.myPostsCreate(resolver)` for full control. Without a response a handler answers 501.
 */
export const api = createMswHandlers().pick

/**
 * The error responses each operation declares, by status (from the generated SDK types). Keys must be
 * generated operations: `api[operation]` below does not compile otherwise.
 */
type ErrorsByOperation = {
  publicPostsList: PublicPostsListErrors
  myPostsList: MyPostsListErrors
  myPostsCreate: MyPostsCreateErrors
  myPostsUpdate: MyPostsUpdateErrors
  myPostsRemove: MyPostsRemoveErrors
  systemReady: SystemReadyErrors
}

/** A documented error response, e.g. `apiError('myPostsUpdate', 404, { _tag: 'PostNotFound', id })`. */
export const apiError = <Op extends keyof ErrorsByOperation, Status extends keyof ErrorsByOperation[Op] & number>(
  operation: Op,
  status: Status,
  body: ErrorsByOperation[Op][Status],
): HttpHandler => api[operation](() => HttpResponse.json(body as JsonBodyType, { status }))

/** Answers an operation with something the contract does not describe: a network error or a raw body. */
export const apiFailure = (
  operation: keyof MswHandlerFactories,
  failure: { network: true } | { status: number; text: string },
): HttpHandler =>
  api[operation](() =>
    'network' in failure
      ? HttpResponse.error()
      : new HttpResponse(failure.text, { status: failure.status, headers: { 'content-type': 'text/plain' } }),
  )

/** A response that waits until `release()`, to observe pending states. */
export const held = () => {
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  return { release, wait: () => released }
}

export const post = (overrides: Partial<Post> = {}): Post => ({
  id: crypto.randomUUID(),
  body: 'A post',
  authorName: 'Test Author',
  createdAt: '2026-01-02T03:04:05.000Z',
  updatedAt: '2026-01-02T03:04:05.000Z',
  ...overrides,
})

/** One page of a posts list; `nextCursor` defaults to null (the last page). */
export const postPage = (items: Post[], nextCursor: string | null = null): PostPage => ({ items, nextCursor })

/**
 * A posts list as the infinite query caches it, e.g. to seed `getMyPostsQueryOptions().queryKey`. Each page
 * was requested with the previous page's `nextCursor` (the first with `{}`, see src/features/posts/api/post-pages.ts).
 */
export const postPages = (...pages: PostPage[]): InfiniteData<PostPage> => ({
  pages,
  pageParams: pages.map((_, index) => (index === 0 ? {} : pages[index - 1]!.nextCursor)),
})

/**
 * How a mocked account server function answers: its outcome (`{ ok: true, value }` or a Better Auth failure
 * code), `'network'` (the request fails), `'thrown'` (the handler threw: Start answers 500), or `held()` to
 * answer `{ ok: true, value: null }` only once released.
 */
type AuthAnswer<T> = AuthOutcome<T> | 'network' | 'thrown' | { wait: () => Promise<void> }

/** A server function of src/lib/auth.functions.ts, answered with `answer`. */
export const authFunction = <T = null>(name: AuthFunctionName, answer: AuthAnswer<T>): HttpHandler =>
  http.post(`*${authFunctionPath(name)}`, async () => {
    if (answer === 'network') return HttpResponse.error()
    if (answer === 'thrown') return HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 })
    if ('wait' in answer) {
      await answer.wait()
      return HttpResponse.json({ ok: true, value: null } satisfies AuthOutcome)
    }
    return HttpResponse.json(answer as JsonBodyType)
  })

/**
 * Records the `data` of every call to server function `name` (in `data`) and lets the call through to the
 * handler that answers it: `worker.use(calls.handler, authFunction(name, answer))`, recorder first.
 */
export const authCalls = (name: AuthFunctionName) => {
  const data: unknown[] = []
  const handler = http.post(`*${authFunctionPath(name)}`, async ({ request }) => {
    data.push(await request.clone().json())
  })
  return { handler, data }
}

/** The sign-in and sign-out server functions, with the answers the tests use most. */
export const auth = {
  signIn: (outcome: 'ok' | 'invalid' | 'network' | { wait: () => Promise<void> }) =>
    authFunction(
      'signIn',
      outcome === 'ok'
        ? { ok: true, value: null }
        : outcome === 'invalid'
          ? { ok: false, failure: { code: 'INVALID_EMAIL_OR_PASSWORD' } }
          : outcome,
    ),
  signOut: (outcome: 'ok' | 'failed' | 'network' | { wait: () => Promise<void> }) =>
    authFunction('signOut', outcome === 'ok' ? { ok: true, value: null } : outcome === 'failed' ? 'thrown' : outcome),
}
