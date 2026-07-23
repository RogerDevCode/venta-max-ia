CREATE TABLE "commerce_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"max_units_per_product" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_settings_max_units_positive" CHECK ("commerce_settings"."max_units_per_product" > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce_settings" ADD CONSTRAINT "commerce_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;