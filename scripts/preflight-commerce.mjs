import postgres from "postgres";

/**
 * Preflight de verificación de integridad del módulo E-Commerce y restricciones PostgreSQL.
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/vocero";
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    console.log("==> [PREFLIGHT COMMERCE] Verificando tablas e índices de E-Commerce...");

    const tables = await sql.unsafe(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('product', 'cart', 'order', 'commerce_settings')"
    );

    if (tables.length < 4) {
      console.error("[-] ERROR: Faltan tablas del dominio e-commerce en PostgreSQL.");
      process.exit(1);
    }

    const uniqueIndex = await sql.unsafe(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'cart' AND indexname = 'cart_org_conv_active_uq'"
    );

    if (uniqueIndex.length === 0) {
      console.error("[-] ERROR: Falta el índice único cart_org_conv_active_uq en la tabla cart.");
      process.exit(1);
    }

    console.log("[+] [PREFLIGHT COMMERCE] Integridad de tablas e índices e-commerce PASS.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[-] Error en preflight commerce:", err);
  process.exit(1);
});
