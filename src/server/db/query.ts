import '@tanstack/react-start/server-only'
import { Data, Effect } from 'effect'
import { Database, type Db } from './client.ts'

/** A statement failed (Postgres unreachable, a constraint): the handlers turn it into a defect, an empty 500. */
export class DbError extends Data.TaggedError('DbError')<{ readonly cause: unknown }> {}

/**
 * One statement of a repository. It goes through the current transaction, if the caller runs in one
 * (Database.transaction), and through `own`, the client the repository was built with, otherwise.
 *
 * @example query(own, (db) => db.select().from(post).where(eq(post.id, id)))
 */
export const query = <A>(own: Db, run: (db: Db) => Promise<A>): Effect.Effect<A, DbError> =>
  Effect.flatMap(Database.client(own), (db) =>
    Effect.tryPromise({ try: () => run(db), catch: (cause) => new DbError({ cause }) }),
  )

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether an id from a path can name a row of a uuid table. A repository answers "not found" for any other id
 * without a statement: Postgres would fail the `::uuid` cast (a 500), and a malformed id is as missing as an unknown one.
 */
export const isUuid = (id: string): boolean => UUID.test(id)
