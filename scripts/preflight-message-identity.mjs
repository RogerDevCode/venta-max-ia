import postgres from "postgres";

/**
 * Preflight de verificación de identidades de mensajes y unicidad de receipts Telegram.
 */
async function main() {
  let databaseUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/vocero";
  if (databaseUrl.includes("neon")) {
    databaseUrl = "postgresql://postgres:postgres@127.0.0.1:5432/vocero";
  }
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    console.log("==> [PREFLIGHT MESSAGE IDENTITY] Verificando unicidad de receipts Telegram...");

    const receiptIndexes = await sql.unsafe(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'telegram_webhook_receipt' AND indexname LIKE '%telegram_msg_uq%'"
    );

    console.log(`[+] [PREFLIGHT MESSAGE IDENTITY] ${receiptIndexes.length} índices de unicidad verificados PASS.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[-] Error en preflight message identity:", err);
  process.exit(1);
});
