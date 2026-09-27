-- Scans the existing rows with only a SHARE UPDATE EXCLUSIVE lock: reads and writes go on meanwhile. scripts/migrate.ts
-- applies pending migrations in one transaction, so on a large table deploy 0007 and 0008 in separate releases.
ALTER TABLE "post" VALIDATE CONSTRAINT "post_body_check";
