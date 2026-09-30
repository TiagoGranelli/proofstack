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
  MeGetErrors,
  MyPostsCreateErrors,
  MyPostsListErrors,
  MyPostsRemoveErrors,
  MyPostsUpdateErrors,
  Post,
  PublicPostsListErrors,
  SystemReadyErrors,
} from '#/sdk/types.gen.ts'
import { type AuthFunctionName, authFunctionPath } from './stubs/auth-functions.ts'

/** Started and reset by tests/component/setup.ts. Add handlers per test with `worker.use(...)`. */
export const worker = setupWorker()

/**
 * One factory per contract operation, e.g. `api.meGet({ body: user })` for a success, or `api.meGet(resolver)`
 * for full control. Without a response a handler answers 501.
 */
export const api = createMswHandlers().pick

/**
 * The error responses each operation declares, by status (from the generated SDK types). Keys must be
 * generated operations: `api[operation]` below does not compile otherwise. An operation needs its line only once a
 * test calls `apiError` for it (the call does not compile before). Written by hand because nothing generated maps an
 * operation to its `<Operation>Errors` type: the SDK functions return the errors as one union, without the statuses.
 */
type ErrorsByOperation = {
  systemReady: SystemReadyErrors
  meGet: MeGetErrors
  publicPostsList: PublicPostsListErrors
  myPostsList: MyPostsListErrors
  myPostsCreate: MyPostsCreateErrors
  myPostsUpdate: MyPostsUpdateErrors
  myPostsRemove: MyPostsRemoveErrors
}

/** A documented error response, e.g. `apiError('meGet', 401, { _tag: 'Unauthorized', message })`. */
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

/** One page of a list (a `PostPage`, or any `{ items, nextCursor }` page); `nextCursor` defaults to null (the last page). */
export const listPage = <Item>(items: Item[], nextCursor: string | null = null) => ({ items, nextCursor })

/**
 * A list as the infinite query caches it, e.g. to seed `getMyPostsQueryOptions().queryKey`. Each page was
 * requested with the previous page's `nextCursor` (the first with `{}`, `firstPage` in src/lib/infinite-pages.ts).
 */
export const listPages = <Page extends { nextCursor: string | null }>(...pages: Page[]): InfiniteData<Page> => ({
  pages,
  pageParams: pages.map((_, index) => (index === 0 ? {} : pages[index - 1]!.nextCursor)),
})

type ImmediateAuthAnswer<T> = AuthOutcome<T> | 'network' | 'thrown'
/**
 * How a mocked account server function answers: its outcome (`{ ok: true, value }` or a Better Auth failure
 * code), `'network'` (the request fails), `'thrown'` (the handler threw: Start answers 500), or `held()` to
 * answer only once released: `{ ok: true, value: null }`, or `{ ...held(), answer }` for another answer.
 */
type AuthAnswer<T> = ImmediateAuthAnswer<T> | { wait: () => Promise<void>; answer?: ImmediateAuthAnswer<T> }

const respond = (answer: ImmediateAuthAnswer<unknown>) => {
  if (answer === 'network') return HttpResponse.error()
  if (answer === 'thrown') return HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 })
  return HttpResponse.json(answer as JsonBodyType)
}

/** A server function of src/lib/auth.functions.ts, answered with `answer`. */
export const authFunction = <T = null>(name: AuthFunctionName, answer: AuthAnswer<T>): HttpHandler =>
  http.post(`*${authFunctionPath(name)}`, async () => {
    if (typeof answer === 'object' && 'wait' in answer) {
      await answer.wait()
      return respond(answer.answer ?? ({ ok: true, value: null } satisfies AuthOutcome))
    }
    return respond(answer)
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

/** A held answer, or `'network'`: what `auth.signIn` and `auth.signOut` pass through to `authFunction` as it is. */
type PassedThrough = 'network' | { wait: () => Promise<void> }

const signInAnswer = (outcome: 'ok' | 'invalid' | PassedThrough): AuthAnswer<null> => {
  if (outcome === 'ok') return { ok: true, value: null }
  if (outcome === 'invalid') return { ok: false, failure: { code: 'INVALID_EMAIL_OR_PASSWORD' } }
  return outcome
}

const signOutAnswer = (outcome: 'ok' | 'failed' | PassedThrough): AuthAnswer<null> => {
  if (outcome === 'ok') return { ok: true, value: null }
  if (outcome === 'failed') return 'thrown'
  return outcome
}

/** The sign-in and sign-out server functions, with the answers the tests use most. */
export const auth = {
  signIn: (outcome: Parameters<typeof signInAnswer>[0]) => authFunction('signIn', signInAnswer(outcome)),
  signOut: (outcome: Parameters<typeof signOutAnswer>[0]) => authFunction('signOut', signOutAnswer(outcome)),
}
