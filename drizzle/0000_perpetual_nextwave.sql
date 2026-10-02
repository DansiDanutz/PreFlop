CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`balance` integer NOT NULL,
	`version` integer NOT NULL,
	`favorites` text NOT NULL,
	`favorite_tables` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "balance_nonnegative" CHECK("profiles"."balance" >= 0),
	CONSTRAINT "version_nonnegative" CHECK("profiles"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text NOT NULL,
	`profile_id` text NOT NULL,
	`table_id` text NOT NULL,
	`selection_id` text NOT NULL,
	`stake` integer NOT NULL,
	`odds_centi` integer NOT NULL,
	`payout` integer NOT NULL,
	`won` integer NOT NULL,
	`cards` text NOT NULL,
	`balance_before` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stake_bounds" CHECK("rounds"."stake" >= 10 AND "rounds"."stake" <= 1000),
	CONSTRAINT "payout_nonnegative" CHECK("rounds"."payout" >= 0),
	CONSTRAINT "odds_positive" CHECK("rounds"."odds_centi" >= 100),
	CONSTRAINT "won_boolean" CHECK("rounds"."won" IN (0,1)),
	CONSTRAINT "round_balance_exact" CHECK("rounds"."balance_after" = "rounds"."balance_before" - "rounds"."stake" + "rounds"."payout" AND "rounds"."balance_before" >= "rounds"."stake" AND "rounds"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE INDEX `rounds_profile_created` ON `rounds` (`profile_id`,`created_at`);