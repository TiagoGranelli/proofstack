-- The keyset indexes become ascending (Postgres scans them backward for newest first); see the comment in
-- src/server/db/schema/posts.ts. New ones first, so the lists are never without an index.
-- Built by hand with CREATE INDEX CONCURRENTLY before the deploy (docs/operations.md, "Migration safety").
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS "post_keyset_idx" ON "post" USING btree ("created_at","id");--> statement-breakpoint
-- Built by hand with CREATE INDEX CONCURRENTLY before the deploy (docs/operations.md, "Migration safety").
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS "post_author_keyset_idx" ON "post" USING btree ("author_id","created_at","id");--> statement-breakpoint
-- Dropped by hand with DROP INDEX CONCURRENTLY before the deploy (docs/operations.md, "Migration safety").
-- squawk-ignore require-concurrent-index-deletion
DROP INDEX IF EXISTS "post_created_id_idx";--> statement-breakpoint
-- Dropped by hand with DROP INDEX CONCURRENTLY before the deploy (docs/operations.md, "Migration safety").
-- squawk-ignore require-concurrent-index-deletion
DROP INDEX IF EXISTS "post_author_created_id_idx";--> statement-breakpoint
-- NOT VALID: checked for new rows at once, without scanning the table under an exclusive lock. 0008 validates
-- the existing rows.
ALTER TABLE "post" ADD CONSTRAINT "post_body_check" CHECK (char_length("post"."body") between 1 and 280 and "post"."body" = btrim("post"."body")) NOT VALID;
