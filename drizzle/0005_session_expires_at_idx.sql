-- For the periodic cleanup of expired sessions (src/server/auth-cleanup.ts). With many sessions, build it by
-- hand with CREATE INDEX CONCURRENTLY before the deploy (docs/operations.md, "Migration safety").
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS "session_expires_at_idx" ON "session" USING btree ("expires_at");
