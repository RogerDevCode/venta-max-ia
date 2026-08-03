DO $retired$
DECLARE item record;
BEGIN
  IF EXISTS(SELECT FROM pg_namespace WHERE nspname='retired_whatsapp') THEN
    ALTER SCHEMA retired_whatsapp OWNER TO venta_owner;
    REVOKE ALL ON SCHEMA retired_whatsapp FROM PUBLIC,venta_app,venta_auth,venta_ingress;
    GRANT USAGE ON SCHEMA retired_whatsapp TO venta_backup;
    FOR item IN SELECT c.relkind,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='retired_whatsapp' AND c.relkind IN('r','p','v','m') LOOP
      EXECUTE format('ALTER %s retired_whatsapp.%I OWNER TO venta_owner',CASE item.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,item.relname);
    END LOOP;
    REVOKE ALL ON ALL TABLES IN SCHEMA retired_whatsapp FROM PUBLIC,venta_app,venta_auth,venta_ingress;
    GRANT SELECT ON ALL TABLES IN SCHEMA retired_whatsapp TO venta_backup;
  END IF;
END $retired$;
