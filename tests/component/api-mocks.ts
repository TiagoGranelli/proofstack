// Network mocks for component tests. Contract endpoints use the MSW handlers Hey API generates from
// openapi.json (src/sdk/msw.gen.ts), so a mock cannot drift from the contract: paths, methods and success
// bodies are typed by it, and `apiError` only accepts a status and body the operation declares.
// Better Auth's endpoints are outside the contract and are mocked by hand in `auth`.
import type { InfiniteData } from '@tanstack/react-query'
import { http, HttpResponse, type HttpHandler, type JsonBodyType } from 'msw'
import { setupWorker } from 'msw/browser'
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

/** Better Auth endpoints the UI calls through `authClient` (src/lib/auth-client.ts). */
export const auth = {
  signIn: (outcome: 'ok' | 'invalid' | 'network' | { wait: () => Promise<void> }) =>
    http.post('*/api/auth/sign-in/email', async () => {
      if (outcome === 'network') return HttpResponse.error()
      if (outcome === 'invalid')
        return HttpResponse.json(
          { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
          { status: 401 },
        )
      if (typeof outcome === 'object') await outcome.wait()
      return HttpResponse.json({ redirect: false, token: 'session-token', user: { id: 'u1', name: 'Test Author' } })
    }),
  signOut: (outcome: 'ok' | 'failed' | 'network' | { wait: () => Promise<void> }) =>
    http.post('*/api/auth/sign-out', async () => {
      if (outcome === 'network') return HttpResponse.error()
      if (outcome === 'failed') return HttpResponse.json({ message: 'Failed to sign out' }, { status: 500 })
      if (typeof outcome === 'object') await outcome.wait()
      return HttpResponse.json({ success: true })
    }),
}
