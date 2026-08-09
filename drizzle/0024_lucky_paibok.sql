ALTER TABLE "contact" ADD COLUMN "assigned_user_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "assigned_user_id" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "assigned_user_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;