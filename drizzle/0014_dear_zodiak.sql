SELECT pg_advisory_xact_lock(hashtext('venta-max:whatsapp-retirement'));--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS retired_whatsapp;--> statement-breakpoint
CREATE TABLE retired_whatsapp.meta_credentials AS TABLE public.meta_credentials WITH DATA;--> statement-breakpoint
CREATE TABLE retired_whatsapp.template AS TABLE public.template WITH DATA;--> statement-breakpoint
DO $$
DECLARE source_meta bigint; archived_meta bigint; source_template bigint; archived_template bigint;
BEGIN
  SELECT count(*) INTO source_meta FROM public.meta_credentials;
  SELECT count(*) INTO archived_meta FROM retired_whatsapp.meta_credentials;
  SELECT count(*) INTO source_template FROM public.template;
  SELECT count(*) INTO archived_template FROM retired_whatsapp.template;
  IF source_meta <> archived_meta OR source_template <> archived_template THEN
    RAISE EXCEPTION 'WhatsApp archive verification failed';
  END IF;
END $$;--> statement-breakpoint
DROP TABLE "meta_credentials" CASCADE;--> statement-breakpoint
DROP TABLE "template" CASCADE;--> statement-breakpoint
ALTER TABLE "message" RENAME COLUMN "wa_timestamp" TO "external_timestamp";--> statement-breakpoint
DROP INDEX "contact_org_phone_uq";--> statement-breakpoint
ALTER TABLE "contact" DROP COLUMN "phone";--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "wa_message_id";
