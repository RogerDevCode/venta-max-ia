DO $preflight$
DECLARE actual text[];
DECLARE expected constant text[] := ARRAY['account','agent_profile','agent_test_case','agent_test_run','cart','category','commerce_order_counter','commerce_settings','contact','conversation','invitation','kb_entry','lead','member','message','order','organization','payment','pipeline_stage','product','session','telegram_integration','telegram_menu_action','telegram_menu_instance','telegram_outbox','telegram_webhook_receipt','telegram_webhook_rejection','user','verification','whatsapp_integration'];
DECLARE bad bigint;
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname) INTO actual FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r';
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'RLS preflight failed: public table inventory differs'; END IF;
  SELECT count(*) INTO bad FROM (
    SELECT 1 FROM conversation c JOIN contact p ON p.id=c.contact_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM lead c JOIN contact p ON p.id=c.contact_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM lead c JOIN pipeline_stage p ON p.id=c.stage_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM message c JOIN conversation p ON p.id=c.conversation_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM cart c JOIN conversation p ON p.id=c.conversation_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM "order" c JOIN cart p ON p.id=c.cart_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM "order" c JOIN contact p ON p.id=c.contact_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM "order" c JOIN conversation p ON p.id=c.conversation_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM payment c JOIN "order" p ON p.id=c.order_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM agent_test_case c JOIN agent_test_run p ON p.id=c.run_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM agent_test_case c JOIN conversation p ON p.id=c.conversation_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM telegram_menu_instance c JOIN conversation p ON p.id=c.conversation_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM telegram_menu_action c JOIN telegram_menu_instance p ON p.id=c.menu_instance_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM telegram_menu_action c JOIN conversation p ON p.id=c.conversation_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM telegram_menu_action c JOIN telegram_webhook_receipt p ON p.id=c.receipt_id WHERE c.receipt_id IS NOT NULL AND c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM telegram_outbox c JOIN conversation p ON p.id=c.conversation_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM telegram_outbox c JOIN telegram_integration p ON p.id=c.integration_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM telegram_webhook_receipt c JOIN telegram_integration p ON p.id=c.integration_id WHERE c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM telegram_webhook_receipt c JOIN conversation p ON p.id=c.conversation_id WHERE c.conversation_id IS NOT NULL AND c.organization_id<>p.organization_id
    UNION ALL SELECT 1 FROM telegram_webhook_rejection c JOIN telegram_integration p ON p.id=c.integration_id WHERE c.organization_id<>p.organization_id
  ) violations;
  IF bad>0 THEN RAISE EXCEPTION 'RLS preflight failed: % cross-organization relationships',bad; END IF;
END $preflight$;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app_security AUTHORIZATION venta_owner;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_security.current_organization_id() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT nullif(current_setting('app.organization_id',true),'') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_security.current_user_id() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT nullif(current_setting('app.user_id',true),'') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_security.resolve_telegram_webhook(p_token_hash text) RETURNS TABLE(id text,organization_id text,webhook_header_secret_hash text,status text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT t.id,t.organization_id,t.webhook_header_secret_hash,t.status FROM public.telegram_integration t WHERE t.webhook_token_hash=p_token_hash LIMIT 1 $$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA app_security FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_security FROM PUBLIC;
GRANT USAGE ON SCHEMA app_security TO venta_app,venta_ingress;
GRANT EXECUTE ON FUNCTION app_security.current_organization_id() TO venta_app;
GRANT EXECUTE ON FUNCTION app_security.current_user_id() TO venta_app;
GRANT EXECUTE ON FUNCTION app_security.resolve_telegram_webhook(text) TO venta_ingress;
--> statement-breakpoint
ALTER TABLE contact ADD CONSTRAINT uq_rls_contact_org_id UNIQUE(organization_id,id);
ALTER TABLE pipeline_stage ADD CONSTRAINT uq_rls_pipeline_stage_org_id UNIQUE(organization_id,id);
ALTER TABLE conversation ADD CONSTRAINT uq_rls_conversation_org_id UNIQUE(organization_id,id);
ALTER TABLE cart ADD CONSTRAINT uq_rls_cart_org_id UNIQUE(organization_id,id);
ALTER TABLE "order" ADD CONSTRAINT uq_rls_order_org_id UNIQUE(organization_id,id);
ALTER TABLE agent_test_run ADD CONSTRAINT uq_rls_agent_test_run_org_id UNIQUE(organization_id,id);
ALTER TABLE telegram_integration ADD CONSTRAINT uq_rls_telegram_integration_org_id UNIQUE(organization_id,id);
ALTER TABLE telegram_menu_instance ADD CONSTRAINT uq_rls_telegram_menu_instance_org_id UNIQUE(organization_id,id);
ALTER TABLE telegram_webhook_receipt ADD CONSTRAINT uq_rls_telegram_webhook_receipt_org_id UNIQUE(organization_id,id);
ALTER TABLE conversation ADD CONSTRAINT fk_rls_conversation_contact FOREIGN KEY(organization_id,contact_id) REFERENCES contact(organization_id,id);
ALTER TABLE lead ADD CONSTRAINT fk_rls_lead_contact FOREIGN KEY(organization_id,contact_id) REFERENCES contact(organization_id,id);
ALTER TABLE lead ADD CONSTRAINT fk_rls_lead_stage FOREIGN KEY(organization_id,stage_id) REFERENCES pipeline_stage(organization_id,id);
ALTER TABLE message ADD CONSTRAINT fk_rls_message_conversation FOREIGN KEY(organization_id,conversation_id) REFERENCES conversation(organization_id,id);
ALTER TABLE message ADD CONSTRAINT fk_rls_message_integration FOREIGN KEY(organization_id,integration_id) REFERENCES telegram_integration(organization_id,id);
ALTER TABLE cart ADD CONSTRAINT fk_rls_cart_conversation FOREIGN KEY(organization_id,conversation_id) REFERENCES conversation(organization_id,id);
ALTER TABLE "order" ADD CONSTRAINT fk_rls_order_cart FOREIGN KEY(organization_id,cart_id) REFERENCES cart(organization_id,id);
ALTER TABLE "order" ADD CONSTRAINT fk_rls_order_contact FOREIGN KEY(organization_id,contact_id) REFERENCES contact(organization_id,id);
ALTER TABLE "order" ADD CONSTRAINT fk_rls_order_conversation FOREIGN KEY(organization_id,conversation_id) REFERENCES conversation(organization_id,id);
ALTER TABLE payment ADD CONSTRAINT fk_rls_payment_order FOREIGN KEY(organization_id,order_id) REFERENCES "order"(organization_id,id);
ALTER TABLE agent_test_case ADD CONSTRAINT fk_rls_test_case_run FOREIGN KEY(organization_id,run_id) REFERENCES agent_test_run(organization_id,id);
ALTER TABLE agent_test_case ADD CONSTRAINT fk_rls_test_case_conversation FOREIGN KEY(organization_id,conversation_id) REFERENCES conversation(organization_id,id);
ALTER TABLE telegram_menu_instance ADD CONSTRAINT fk_rls_menu_instance_conversation FOREIGN KEY(organization_id,conversation_id) REFERENCES conversation(organization_id,id);
ALTER TABLE telegram_menu_action ADD CONSTRAINT fk_rls_menu_action_instance FOREIGN KEY(organization_id,menu_instance_id) REFERENCES telegram_menu_instance(organization_id,id);
ALTER TABLE telegram_menu_action ADD CONSTRAINT fk_rls_menu_action_conversation FOREIGN KEY(organization_id,conversation_id) REFERENCES conversation(organization_id,id);
ALTER TABLE telegram_menu_action ADD CONSTRAINT fk_rls_menu_action_receipt FOREIGN KEY(organization_id,receipt_id) REFERENCES telegram_webhook_receipt(organization_id,id);
ALTER TABLE telegram_outbox ADD CONSTRAINT fk_rls_outbox_conversation FOREIGN KEY(organization_id,conversation_id) REFERENCES conversation(organization_id,id);
ALTER TABLE telegram_outbox ADD CONSTRAINT fk_rls_outbox_integration FOREIGN KEY(organization_id,integration_id) REFERENCES telegram_integration(organization_id,id);
ALTER TABLE telegram_webhook_receipt ADD CONSTRAINT fk_rls_receipt_integration FOREIGN KEY(organization_id,integration_id) REFERENCES telegram_integration(organization_id,id);
ALTER TABLE telegram_webhook_receipt ADD CONSTRAINT fk_rls_receipt_conversation FOREIGN KEY(organization_id,conversation_id) REFERENCES conversation(organization_id,id);
ALTER TABLE telegram_webhook_rejection ADD CONSTRAINT fk_rls_rejection_integration FOREIGN KEY(organization_id,integration_id) REFERENCES telegram_integration(organization_id,id);
--> statement-breakpoint
DO $rls$
DECLARE table_name text;
DECLARE tenant_tables constant text[]:=ARRAY['agent_profile','agent_test_case','agent_test_run','cart','category','commerce_order_counter','commerce_settings','contact','conversation','kb_entry','lead','message','order','payment','pipeline_stage','product','telegram_integration','telegram_menu_action','telegram_menu_instance','telegram_outbox','telegram_webhook_receipt','telegram_webhook_rejection','whatsapp_integration'];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY %I ON %I TO venta_app USING (organization_id=app_security.current_organization_id()) WITH CHECK (organization_id=app_security.current_organization_id())',table_name||'_organization_isolation',table_name);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO venta_app',table_name);
  END LOOP;
END $rls$;
--> statement-breakpoint
ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_app_context ON organization TO venta_app USING(id=app_security.current_organization_id()) WITH CHECK(id=app_security.current_organization_id());
CREATE POLICY organization_auth_access ON organization TO venta_auth USING(true) WITH CHECK(true);
ALTER TABLE member ENABLE ROW LEVEL SECURITY;
ALTER TABLE member FORCE ROW LEVEL SECURITY;
CREATE POLICY member_app_context ON member TO venta_app USING(organization_id=app_security.current_organization_id()) WITH CHECK(organization_id=app_security.current_organization_id());
CREATE POLICY member_auth_access ON member TO venta_auth USING(true) WITH CHECK(true);
ALTER TABLE invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation FORCE ROW LEVEL SECURITY;
CREATE POLICY invitation_app_context ON invitation TO venta_app USING(organization_id=app_security.current_organization_id()) WITH CHECK(organization_id=app_security.current_organization_id());
CREATE POLICY invitation_auth_access ON invitation TO venta_auth USING(true) WITH CHECK(true);
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user" FORCE ROW LEVEL SECURITY;
CREATE POLICY user_app_members ON "user" TO venta_app USING(id=app_security.current_user_id() OR EXISTS(SELECT 1 FROM member m WHERE m.user_id="user".id AND m.organization_id=app_security.current_organization_id()));
CREATE POLICY user_auth_access ON "user" TO venta_auth USING(true) WITH CHECK(true);
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE session FORCE ROW LEVEL SECURITY;
CREATE POLICY session_auth_access ON session TO venta_auth USING(true) WITH CHECK(true);
ALTER TABLE account ENABLE ROW LEVEL SECURITY;
ALTER TABLE account FORCE ROW LEVEL SECURITY;
CREATE POLICY account_auth_access ON account TO venta_auth USING(true) WITH CHECK(true);
ALTER TABLE verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification FORCE ROW LEVEL SECURITY;
CREATE POLICY verification_auth_access ON verification TO venta_auth USING(true) WITH CHECK(true);
CREATE POLICY telegram_integration_resolver ON telegram_integration FOR SELECT TO venta_owner USING(true);
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO venta_app,venta_auth,venta_backup;
GRANT SELECT,UPDATE ON organization TO venta_app;
GRANT SELECT,DELETE ON member TO venta_app;
GRANT SELECT ON invitation,"user" TO venta_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON "user",session,account,verification,organization,member,invitation TO venta_auth;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO venta_backup;
GRANT USAGE ON SCHEMA drizzle TO venta_migrator,venta_backup;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA drizzle TO venta_migrator;
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO venta_backup;
--> statement-breakpoint
DO $owners$
DECLARE item record;
BEGIN
  FOR item IN SELECT c.relkind,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','drizzle') AND c.relkind IN('r','p','v','m') LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO venta_owner',CASE item.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,item.nspname,item.relname);
  END LOOP;
END $owners$;
