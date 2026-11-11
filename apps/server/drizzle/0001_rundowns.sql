CREATE TABLE `rundown_items` (
	`id` text PRIMARY KEY NOT NULL,
	`rundown_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`graphic_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`layer` integer NOT NULL,
	`data` text NOT NULL,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`rundown_id`) REFERENCES `rundowns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rundown_items_rundown_idx` ON `rundown_items` (`rundown_id`,`position`);--> statement-breakpoint
CREATE TABLE `rundowns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cursor_item_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
