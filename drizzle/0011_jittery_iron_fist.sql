CREATE TABLE "commerce_order_counter" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_order_counter_next_positive" CHECK ("commerce_order_counter"."next_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "telegram_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"sequence" bigint NOT NULL,
	"depends_on_id" text,
	"text" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reply_markup" jsonb,
	"fsm_revision" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp,
	"telegram_message_id" bigint,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "telegram_webhook_rejection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"reason" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM telegram_integration
    WHERE bot_id IS NOT NULL
    GROUP BY bot_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'telegram_integration contains duplicate bot_id values';
  END IF;
  IF EXISTS (
    SELECT 1 FROM cart WHERE status = 'active'
    GROUP BY organization_id, conversation_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cart contains duplicate active carts; run commerce preflight/reconciliation';
  END IF;
END $$;--> statement-breakpoint
DROP INDEX "telegram_receipt_org_update_uq";--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "fsm_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "webhook_header_secret_hash" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "webhook_route_secret_cipher" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "webhook_route_secret_iv" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "webhook_route_secret_tag" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "webhook_header_secret_cipher" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "webhook_header_secret_iv" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "webhook_header_secret_tag" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "previous_webhook_route_secret_cipher" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "previous_webhook_route_secret_iv" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "previous_webhook_route_secret_tag" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "previous_webhook_header_secret_cipher" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "previous_webhook_header_secret_iv" text;--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD COLUMN "previous_webhook_header_secret_tag" text;--> statement-breakpoint
ALTER TABLE "telegram_menu_action" ADD COLUMN "receipt_id" text;--> statement-breakpoint
ALTER TABLE "telegram_menu_action" ADD COLUMN "ignored_reason" text;--> statement-breakpoint
ALTER TABLE "telegram_menu_instance" ADD COLUMN "fsm_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_webhook_receipt" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_webhook_receipt" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "telegram_webhook_receipt" ADD COLUMN "expected_fsm_revision" bigint;--> statement-breakpoint
ALTER TABLE "telegram_webhook_receipt" ADD COLUMN "expected_fsm_state_key" text;--> statement-breakpoint
ALTER TABLE "telegram_webhook_receipt" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_webhook_receipt" ADD COLUMN "available_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_webhook_receipt" ADD COLUMN "lease_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "telegram_webhook_receipt" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "telegram_webhook_receipt" ADD COLUMN "ignored_reason" text;--> statement-breakpoint
ALTER TABLE "commerce_order_counter" ADD CONSTRAINT "commerce_order_counter_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_integration_id_telegram_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."telegram_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_webhook_rejection" ADD CONSTRAINT "telegram_webhook_rejection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_webhook_rejection" ADD CONSTRAINT "telegram_webhook_rejection_integration_id_telegram_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."telegram_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_outbox_org_idempotency_uq" ON "telegram_outbox" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_outbox_org_conv_sequence_uq" ON "telegram_outbox" USING btree ("organization_id","conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "telegram_outbox_org_status_available_idx" ON "telegram_outbox" USING btree ("organization_id","status","available_at");--> statement-breakpoint
CREATE INDEX "telegram_outbox_org_conv_sequence_idx" ON "telegram_outbox" USING btree ("organization_id","conversation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_rejection_org_integration_hash_uq" ON "telegram_webhook_rejection" USING btree ("organization_id","integration_id","payload_hash");--> statement-breakpoint
CREATE INDEX "telegram_rejection_org_received_idx" ON "telegram_webhook_rejection" USING btree ("organization_id","received_at");--> statement-breakpoint
ALTER TABLE "telegram_menu_action" ADD CONSTRAINT "telegram_menu_action_receipt_id_telegram_webhook_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."telegram_webhook_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_webhook_receipt" ADD CONSTRAINT "telegram_webhook_receipt_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_org_conv_active_uq" ON "cart" USING btree ("organization_id","conversation_id") WHERE "cart"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_integration_bot_id_uq" ON "telegram_integration" USING btree ("bot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_menu_action_org_receipt_uq" ON "telegram_menu_action" USING btree ("organization_id","receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_receipt_integration_update_uq" ON "telegram_webhook_receipt" USING btree ("organization_id","integration_id","update_id");--> statement-breakpoint
CREATE INDEX "telegram_receipt_org_status_available_idx" ON "telegram_webhook_receipt" USING btree ("organization_id","status","available_at");
--> statement-breakpoint
INSERT INTO commerce_order_counter (organization_id, next_value)
SELECT organization_id,
       COALESCE(max(CASE WHEN order_number ~ '^ORD-[0-9]+$' THEN substring(order_number from 5)::bigint END), 0) + 1
FROM "order"
GROUP BY organization_id
ON CONFLICT (organization_id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE telegram_webhook_receipt ADD CONSTRAINT telegram_webhook_receipt_status_check
CHECK (status IN ('received','processing','processed','ignored','retryable_failed','failed','conflict'));
--> statement-breakpoint
ALTER TABLE telegram_outbox ADD CONSTRAINT telegram_outbox_status_check
CHECK (status IN ('pending','sending','delivered','retryable_failed','delivery_unknown','failed','superseded'));
