ALTER TABLE "commerce_settings" ADD COLUMN "auto_expiration_hours" integer DEFAULT 36 NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "commerce_settings" ADD CONSTRAINT "commerce_settings_auto_expiration_positive" CHECK ("commerce_settings"."auto_expiration_hours" > 0);