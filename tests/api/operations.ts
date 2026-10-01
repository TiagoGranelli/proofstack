// Every operation of the contract, read from it with HttpApi.reflect, and a valid request for each: the tests that
// check all operations alike (./database-down.test.ts, ./public-operations.test.ts) cover a new endpoint without an
// edit.
import { HttpApi } from 'effect/http-api'
import { Api } from '#/contract/api.ts'

interface Operation {
  /** `<group>.<endpoint>`, as the typed client names it: `myPosts.update`. */
  readonly name: string
  readonly method: string
  /** The contract's path, with `:param` placeholders: `/api/me/posts/:id`. */
  readonly path: string
  /** The error statuses the operation declares, its middleware's included. */
  readonly errorStatuses: ReadonlySet<number>
}

const collected: Operation[] = []
HttpApi.reflect(Api, {
  onGroup: () => {},
  onEndpoint: ({ group, endpoint, errors }) =>
    collected.push({
      name: `${group.identifier}.${endpoint.identifier}`,
      method: endpoint.method,
      path: endpoint.path,
      errorStatuses: new Set(errors.keys()),
    }),
})
export const operations: ReadonlyArray<Operation> = collected

/** A well-formed id that no row has: a path parameter that decodes, so only the test's subject can fail. */
const MISSING_ID = '00000000-0000-4000-8000-000000000000'

/**
 * A payload every write of the contract accepts today (PostInput). An endpoint that takes another payload gets its
 * own here, or the tests see a 400 where they expect the database or the session to decide.
 */
const VALID_PAYLOAD = { body: 'hello' }

/** A valid request for `operation`, with `headers` (a session cookie, say) on top of the JSON content type. */
export const requestFor = (operation: Operation, headers: Record<string, string> = {}): Request =>
  new Request(`http://localhost:3000${operation.path.replaceAll(/:\w+/g, MISSING_ID)}`, {
    method: operation.method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(operation.method === 'POST' || operation.method === 'PATCH' ? { body: JSON.stringify(VALID_PAYLOAD) } : {}),
  })
