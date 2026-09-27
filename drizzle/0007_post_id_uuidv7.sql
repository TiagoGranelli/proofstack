-- Only the default changes: rows from before keep their random (v4) ids, which stay valid.
ALTER TABLE "post" ALTER COLUMN "id" SET DEFAULT uuidv7();