ALTER TABLE "commerce_settings" ADD COLUMN IF NOT EXISTS "auto_expiration_hours" integer DEFAULT 36 NOT NULL;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "cancellation_reason" text;
