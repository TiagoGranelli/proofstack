// The in-memory stand-in for Postgres that the api layer's repositories share (./harness.ts).
import { Data, Effect } from 'effect'

/** Same tag as the repositories' private DbError: the handlers only look at `_tag`. */
class DbError extends Data.TaggedError('DbError')<{ readonly cause: unknown }> {}

export interface RepoOptions {
  /** Every call fails like an unreachable Postgres. */
  readonly databaseDown?: boolean
  /**
   * Microseconds the clock advances per write (default one second). `1` puts several posts in the same
   * millisecond (equal `createdAt` on the wire, distinct sort keys); `0` gives them the same instant, so
   * only the id orders them.
   */
  readonly clockStepMicros?: number
}

/** A database call in memory, or the failure of an unreachable Postgres when `databaseDown` is set. */
export const memoryQuery =
  (options: RepoOptions) =>
  <A>(run: () => A) =>
    options.databaseDown ? Effect.fail(new DbError({ cause: new Error('connect ECONNREFUSED') })) : Effect.sync(run)
