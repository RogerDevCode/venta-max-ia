import { getDb } from "../src/lib/db/index.js";
import * as schema from "../src/lib/db/schema.js";

async function main() {
  const db = getDb();
  const products = await db.select().from(schema.product);
  console.log("Products count:", products.length);
  if (products.length > 0) {
    console.log("Sample product:", products[0]);
  }
}

main().catch(console.error);
