import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getAuthDb, getDb, schema } from "@/lib/db";
import { withJobTransaction } from "@/lib/db/context";

type CatalogItem = { category: string; sku: string; name: string; description: string; price: number; stock: number };

const catalog: CatalogItem[] = [
  { category: "Cervezas", sku: "BOT-CRISTAL-LAT-350", name: "Cerveza Cristal", description: "Lata 350 ml", price: 1500, stock: 72 },
  { category: "Cervezas", sku: "BOT-CRISTAL-BOT-330", name: "Cerveza Cristal", description: "Botella retornable 330 ml", price: 1400, stock: 48 },
  { category: "Cervezas", sku: "BOT-CRISTAL-6X330", name: "Cerveza Cristal", description: "Six-pack 6 x 330 ml", price: 7800, stock: 18 },
  { category: "Cervezas", sku: "BOT-ESCUDO-LAT-470", name: "Cerveza Escudo", description: "Lata 470 ml", price: 1800, stock: 60 },
  { category: "Cervezas", sku: "BOT-HEINEKEN-0-330", name: "Heineken 0.0", description: "Lata sin alcohol 330 ml", price: 1900, stock: 30 },
  { category: "Vinos", sku: "BOT-CASILLERO-CAB-750", name: "Casillero del Diablo", description: "Cabernet Sauvignon 750 ml", price: 6990, stock: 24 },
  { category: "Vinos", sku: "BOT-GATO-NEGRO-750", name: "Gato Negro", description: "Merlot 750 ml", price: 4990, stock: 30 },
  { category: "Destilados", sku: "BOT-PISCO-40-750", name: "Pisco Control C", description: "40° 750 ml", price: 8990, stock: 20 },
  { category: "Destilados", sku: "BOT-PISCO-35-1000", name: "Pisco Mistral", description: "35° 1 litro", price: 10990, stock: 16 },
  { category: "Destilados", sku: "BOT-RON-HABANA-700", name: "Ron Habana Club", description: "Añejo Especial 700 ml", price: 13990, stock: 10 },
  { category: "Bebidas", sku: "BOT-COCA-COLA-15", name: "Coca-Cola", description: "Botella retornable 1,5 litros", price: 2500, stock: 50 },
  { category: "Bebidas", sku: "BOT-COCA-COLA-35", name: "Coca-Cola", description: "Botella familiar 3,5 litros", price: 3990, stock: 24 },
  { category: "Bebidas", sku: "BOT-SPRITE-LAT-350", name: "Sprite", description: "Lata 350 ml", price: 1300, stock: 60 },
  { category: "Energía", sku: "BOT-RED-BULL-250", name: "Red Bull", description: "Lata 250 ml", price: 2200, stock: 36 },
  { category: "Energía", sku: "BOT-MONSTER-473", name: "Monster Energy", description: "Lata 473 ml", price: 2500, stock: 32 },
  { category: "Snacks", sku: "BOT-DORITOS-150", name: "Doritos", description: "Queso 150 g", price: 2500, stock: 28 },
  { category: "Snacks", sku: "BOT-MANI-200", name: "Maní salado", description: "Bolsa 200 g", price: 1800, stock: 32 },
  { category: "Promociones", sku: "BOT-HIELO-2KG", name: "Hielo", description: "Bolsa 2 kg", price: 2500, stock: 40 },
];

const categories = ["Cervezas", "Vinos", "Destilados", "Bebidas", "Energía", "Snacks", "Promociones"];

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const organizationId = option("--organization");
  const replace = process.argv.includes("--replace");
  if (!organizationId) throw new Error("Uso: pnpm seed:botilleria -- --organization <id> [--replace]");

  const organization = await getAuthDb().select({ id: schema.organization.id }).from(schema.organization).where(eq(schema.organization.id, organizationId)).limit(1);
  if (!organization[0]) throw new Error("La organización indicada no existe.");

  await withJobTransaction(organizationId, async () => {
    const db = getDb();
    const existing = await db.select({ id: schema.product.id }).from(schema.product).where(eq(schema.product.organizationId, organizationId)).limit(1);
    if (existing[0] && !replace) throw new Error("La organización ya tiene catálogo. Usa --replace para reemplazar solo su catálogo.");

    await db.transaction(async (tx) => {
      if (replace) {
        await tx.delete(schema.product).where(eq(schema.product.organizationId, organizationId));
        await tx.delete(schema.category).where(eq(schema.category.organizationId, organizationId));
      }
      const categoryByName = new Map<string, string>();
      for (const [position, name] of categories.entries()) {
        const id = `cat_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
        await tx.insert(schema.category).values({ id, organizationId, name, position: position + 1, active: true });
        categoryByName.set(name, id);
      }
      for (const item of catalog) {
        await tx.insert(schema.product).values({
          id: `prod_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
          organizationId,
          categoryId: categoryByName.get(item.category)!,
          sku: item.sku,
          name: item.name,
          description: item.description,
          price: item.price,
          stock: item.stock,
          active: true,
        });
      }
    });
  });
  console.log(`Botillería creada: ${categories.length} categorías y ${catalog.length} presentaciones.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
