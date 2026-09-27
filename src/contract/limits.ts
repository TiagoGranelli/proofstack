// Plain constants shared with UI code. Kept free of Effect so client bundles do not pull the schema runtime.

// Account passwords (Better Auth `emailAndPassword` in src/server/auth.ts, and the password fields of the UI).
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

// Writes per signed-in user through endpoints with the `WriteRateLimit` middleware (src/contract/middleware.ts):
// at most WRITES_PER_WINDOW in WRITE_WINDOW_SECONDS, counted together. Past that the API answers 429 `RateLimited`
// until the window ends.
export const WRITES_PER_WINDOW = 60
export const WRITE_WINDOW_SECONDS = 60

export const POST_MAX_LENGTH = 280

/** Posts per page when a list request names no `limit`. */
export const POSTS_PAGE_DEFAULT = 20
/** Largest `limit` a list request may ask for. */
export const POSTS_PAGE_MAX = 50
