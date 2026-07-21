ALTER TABLE "telegram_integration" ADD COLUMN "token_cipher" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "token_iv" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "token_tag" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "bot_id" bigint;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "bot_username" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "status" text DEFAULT 'reconnect_required' NOT NULL;