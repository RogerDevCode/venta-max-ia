ALTER TABLE "cart" ADD COLUMN "reopened_from_order_id" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "contact_id" text;--> statement-breakpoint
UPDATE "order" AS customer_order
SET "contact_id" = conversation."contact_id"
FROM "conversation"
WHERE customer_order."conversation_id" = conversation."id"
  AND customer_order."organization_id" = conversation."organization_id"
  AND customer_order."contact_id" IS NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "order" WHERE "contact_id" IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill order.contact_id';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "order" ALTER COLUMN "contact_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_org_contact_status_idx" ON "order" USING btree ("organization_id","contact_id","status");
