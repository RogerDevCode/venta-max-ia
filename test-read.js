import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://venta_app:venta_app_local@127.0.0.1:5432/ventamaxia' });

async function main() {
  const res = await pool.query("SELECT text, status, error FROM message WHERE direction = 'out' ORDER BY created_at DESC LIMIT 1");
  console.log("🤖 Bot:");
  console.dir(res.rows[0], { depth: null });
  process.exit(0);
}
main();
