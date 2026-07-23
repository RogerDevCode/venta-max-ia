CREATE TABLE "telegram_menu_action" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"menu_instance_id" text NOT NULL,
	"callback_query_id" text NOT NULL,
	"telegram_update_id" bigint NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "telegram_menu_instance" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"telegram_message_id" bigint,
	"generation" bigint NOT NULL,
	"fsb_state" text NOT NULL,
	"allowed_actions" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"activated_at" timestamp,
	"consumed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "telegram_menu_action" ADD CONSTRAINT "telegram_menu_action_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_menu_action" ADD CONSTRAINT "telegram_menu_action_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_menu_action" ADD CONSTRAINT "telegram_menu_action_menu_instance_id_telegram_menu_instance_id_fk" FOREIGN KEY ("menu_instance_id") REFERENCES "public"."telegram_menu_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_menu_instance" ADD CONSTRAINT "telegram_menu_instance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_menu_instance" ADD CONSTRAINT "telegram_menu_instance_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_menu_action_org_callback_uq" ON "telegram_menu_action" USING btree ("organization_id","callback_query_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_menu_action_org_instance_uq" ON "telegram_menu_action" USING btree ("organization_id","menu_instance_id");--> statement-breakpoint
CREATE INDEX "telegram_menu_action_org_status_available_idx" ON "telegram_menu_action" USING btree ("organization_id","status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_menu_org_conv_generation_uq" ON "telegram_menu_instance" USING btree ("organization_id","conversation_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_menu_org_conv_active_uq" ON "telegram_menu_instance" USING btree ("organization_id","conversation_id") WHERE "telegram_menu_instance"."status" = 'active';--> statement-breakpoint
CREATE INDEX "telegram_menu_org_chat_message_idx" ON "telegram_menu_instance" USING btree ("organization_id","chat_id","telegram_message_id");