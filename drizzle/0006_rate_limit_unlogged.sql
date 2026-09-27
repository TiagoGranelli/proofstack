-- rate_limit becomes UNLOGGED and keyed by `key` (src/server/db/schema/rate-limit.ts). Its rows are counters that
-- live at most ten minutes, so the table is re-created instead of re-keyed in place: dropping them only restarts
-- every rate-limit window, and a new table is UNLOGGED without a rewrite under lock.
-- squawk-ignore ban-drop-table
DROP TABLE "rate_limit";--> statement-breakpoint
CREATE UNLOGGED TABLE "rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	-- `count` restarts with every window, so it never nears the 32-bit limit.
	-- squawk-ignore prefer-bigint-over-int
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
