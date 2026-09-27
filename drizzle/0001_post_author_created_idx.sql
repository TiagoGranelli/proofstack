DROP INDEX "post_author_id_idx";--> statement-breakpoint
CREATE INDEX "post_author_created_idx" ON "post" USING btree ("author_id","created_at" DESC NULLS LAST);