import { getDb, schema } from "@/lib/db/index";
import { eq, desc } from "drizzle-orm";

async function main() {
  const db = getDb();
  console.log("Integrations:");
  const ints = await db.select().from(schema.telegramIntegration);
  console.log(ints);

  console.log("Messages:");
  const msgs = await db.select().from(schema.message).orderBy(desc(schema.message.createdAt)).limit(5);
  console.log(msgs);

  process.exit(0);
}
main();
