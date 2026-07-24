ALTER TABLE "contact" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "external_address" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "channel" text DEFAULT 'telegram' NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "integration_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "external_message_id" text;--> statement-breakpoint
UPDATE contact c SET
  channel = CASE
    WHEN EXISTS (SELECT 1 FROM conversation cv WHERE cv.contact_id=c.id AND cv.is_test=true) THEN 'test'
    WHEN EXISTS (SELECT 1 FROM conversation cv JOIN message m ON m.conversation_id=cv.id WHERE cv.contact_id=c.id AND m.wa_message_id LIKE 'tg_%') THEN 'telegram'
    ELSE 'retired_whatsapp'
  END,
  external_address = phone;--> statement-breakpoint
ALTER TABLE contact ALTER COLUMN channel SET NOT NULL;--> statement-breakpoint
ALTER TABLE contact ALTER COLUMN external_address SET NOT NULL;--> statement-breakpoint
UPDATE message m SET
  integration_id = ti.id,
  external_message_id = CASE
    WHEN m.wa_message_id LIKE 'tg_cb_%' THEN 'callback:' || substring(m.wa_message_id from 7)
    WHEN m.wa_message_id ~ '^tg_-?[0-9]+_[0-9]+$' THEN 'message:' || replace(substring(m.wa_message_id from 4), '_', ':')
    ELSE NULL
  END
FROM conversation cv
JOIN telegram_integration ti ON ti.organization_id=cv.organization_id
WHERE m.conversation_id=cv.id AND m.wa_message_id LIKE 'tg_%';--> statement-breakpoint
ALTER TABLE message DROP CONSTRAINT IF EXISTS message_wa_message_id_unique;--> statement-breakpoint
ALTER TABLE message ADD CONSTRAINT message_integration_id_telegram_integration_id_fk FOREIGN KEY (integration_id) REFERENCES telegram_integration(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_org_channel_address_uq" ON "contact" USING btree ("organization_id","channel","external_address");--> statement-breakpoint
CREATE UNIQUE INDEX "message_org_integration_external_uq" ON "message" USING btree ("organization_id","integration_id","external_message_id") WHERE "message"."integration_id" is not null and "message"."external_message_id" is not null;
