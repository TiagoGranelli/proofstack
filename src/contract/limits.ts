// Plain constants shared with UI code. Kept free of Effect so client bundles do not pull the schema runtime.
export const POST_MAX_LENGTH = 280

/** Posts per page when a list request names no `limit`. */
export const POSTS_PAGE_DEFAULT = 20
/** Largest `limit` a list request may ask for. */
export const POSTS_PAGE_MAX = 50

// Account passwords (Better Auth `emailAndPassword` in src/server/auth.ts, and the password fields of the UI).
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128
