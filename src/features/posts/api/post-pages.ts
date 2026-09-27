import type { PostPage } from '#/sdk/types.gen.ts'

/**
 * The generated `*InfiniteOptions` send a string page param as `query.cursor` and merge an object page param
 * into the request options, so the first page is "no extra options": its request carries no cursor.
 */
export const firstPage = {}

/** The server's opaque cursor for the next page; `null` on the last page ends the list. */
export const nextPage = (page: PostPage) => page.nextCursor
