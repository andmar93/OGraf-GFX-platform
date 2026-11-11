CREATE TABLE `channel_layers` (
	`channel_id` text NOT NULL,
	`layer` integer NOT NULL,
	`state` text NOT NULL,
	PRIMARY KEY(`channel_id`, `layer`),
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`frame_rate` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `data_roots` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `graphics` (
	`row_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`graphic_id` text NOT NULL,
	`package_id` text NOT NULL,
	`manifest_path` text NOT NULL,
	`base_dir` text NOT NULL,
	`version` text,
	`name` text NOT NULL,
	`manifest` text NOT NULL,
	`warnings` text NOT NULL,
	`is_latest` integer NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graphics_graphic_id_idx` ON `graphics` (`graphic_id`);--> statement-breakpoint
CREATE TABLE `packages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`file_count` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_at` integer NOT NULL
);
