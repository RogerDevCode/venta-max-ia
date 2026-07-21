CREATE TABLE "telegram_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"webhook_token_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_webhook_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"update_id" bigint NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "telegram_integration" ADD CONSTRAINT "telegram_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_webhook_receipt" ADD CONSTRAINT "telegram_webhook_receipt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_webhook_receipt" ADD CONSTRAINT "telegram_webhook_receipt_integration_id_telegram_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."telegram_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_integration_org_uq" ON "telegram_integration" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_integration_token_hash_uq" ON "telegram_integration" USING btree ("webhook_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_receipt_org_update_uq" ON "telegram_webhook_receipt" USING btree ("organization_id","update_id");--> statement-breakpoint
CREATE INDEX "telegram_receipt_org_received_idx" ON "telegram_webhook_receipt" USING btree ("organization_id","received_at");