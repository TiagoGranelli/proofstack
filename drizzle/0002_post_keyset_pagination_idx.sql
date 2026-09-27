DROP INDEX "post_created_at_idx";--> statement-breakpoint
DROP INDEX "post_author_created_idx";--> statement-breakpoint
CREATE INDEX "post_created_id_idx" ON "post" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "post_author_created_id_idx" ON "post" USING btree ("author_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);