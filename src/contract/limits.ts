// Plain constants shared with UI code. Kept free of Effect so client bundles do not pull the schema runtime.
export const POST_MAX_LENGTH = 280

/** Posts per page when a list request names no `limit`. */
export const POSTS_PAGE_DEFAULT = 20
/** Largest `limit` a list request may ask for. */
export const POSTS_PAGE_MAX = 50
