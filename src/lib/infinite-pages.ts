/**
 * The page params of a list read with a generated `*InfiniteOptions` (TanStack Query plugin of Hey API), which
 * sends a string page param as `query.cursor` and merges an object page param into the request options. So the
 * first page is "no extra options": its request carries no cursor.
 */
export const firstPage = {}

/** The server's opaque cursor for the next page (`getNextPageParam`); `null` on the last page ends the list. */
export const nextPage = (page: { readonly nextCursor: string | null }): string | null => page.nextCursor
