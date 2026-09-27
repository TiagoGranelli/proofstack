-- Scans the existing rows with only a SHARE UPDATE EXCLUSIVE lock: reads and writes go on meanwhile. scripts/migrate.ts
-- applies pending migrations in one transaction, so on a large table deploy 0008 and 0009 in separate releases.
ALTER TABLE "post" VALIDATE CONSTRAINT "post_body_check";
