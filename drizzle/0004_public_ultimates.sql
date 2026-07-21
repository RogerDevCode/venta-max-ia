ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "human_available" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "is_general" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "category_org_name_uq" ON "category" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "category_org_id_uq" ON "category" USING btree ("organization_id","id");--> statement-breakpoint
INSERT INTO "category" ("id", "organization_id", "name", "description", "is_general")
SELECT 'cat_general_' || "id", "id", 'General', 'Categoría de respaldo', true FROM "organization"
ON CONFLICT ("organization_id", "name") DO NOTHING;--> statement-breakpoint
UPDATE "category" SET "is_general" = true WHERE "name" = 'General';--> statement-breakpoint
UPDATE "product" p SET "category_id" = g."id"
FROM "category" g
WHERE p."organization_id" = g."organization_id" AND g."is_general" = true AND p."category_id" IS NULL;--> statement-breakpoint
ALTER TABLE "product" DROP CONSTRAINT "product_category_id_category_id_fk";--> statement-breakpoint
ALTER TABLE "product" ALTER COLUMN "category_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_org_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "category"("organization_id","id") ON DELETE RESTRICT;
