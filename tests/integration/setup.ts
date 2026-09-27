// Runs before every integration test file: the open server's settings (DATABASE_URL, APP_URL, BETTER_AUTH_SECRET
// and the rest) become this worker's environment, so the server modules a test imports (src/server/env.ts reads
// them on import) and the scripts it starts (scripts/create-user.ts) act on the app under test.
import { inject } from 'vitest'

Object.assign(process.env, inject('servers').env)
