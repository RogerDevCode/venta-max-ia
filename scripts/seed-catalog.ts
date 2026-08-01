import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema.ts";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

import { getDb } from "../src/lib/db/index.ts";

async function seed() {
  const db = getDb();
  console.log("🌱 Buscando organización principal...");
  const orgs = await db.select().from(schema.organization).limit(1);
  if (orgs.length === 0) {
    console.error("No hay organizaciones en la BD. Ejecuta la app y crea una primero.");
    process.exit(1);
  }
  const orgId = orgs[0].id;
  console.log(`✓ Organización encontrada: ${orgs[0].name} (${orgId})`);

  console.log("Limpiando catálogo actual...");
  await db.delete(schema.product).where(eq(schema.product.organizationId, orgId));
  await db.delete(schema.category).where(eq(schema.category.organizationId, orgId));

  const cats = [
    { name: "Suplementos Deportivos", pos: 1 },
    { name: "Alimentación Saludable", pos: 2 },
    { name: "Bebidas Energéticas", pos: 3 },
    { name: "Accesorios Fitness", pos: 4 },
    { name: "Ropa Deportiva", pos: 5 }
  ];

  const dbCats = [];
  for (const c of cats) {
    const res = await db.insert(schema.category).values({
      id: "cat_" + randomUUID().substring(0, 8),
      organizationId: orgId,
      name: c.name,
      position: c.pos,
      active: true,
    }).returning();
    dbCats.push(res[0]);
  }

  const productsData = [
    // Suplementos (Cat 0)
    { cat: 0, name: "Proteína Whey Premium", desc: "Sabor Chocolate - 1kg", price: 29990, stock: 50 },
    { cat: 0, name: "Proteína Whey Premium", desc: "Sabor Vainilla - 1kg", price: 29990, stock: 45 },
    { cat: 0, name: "Proteína Whey Premium", desc: "Sabor Fresa - 2kg", price: 54990, stock: 20 },
    { cat: 0, name: "Creatina Monohidratada", desc: "Pura 300g", price: 15990, stock: 100 },
    { cat: 0, name: "Creatina Monohidratada", desc: "Pura 500g", price: 24990, stock: 60 },
    { cat: 0, name: "BCAA Aminoácidos", desc: "Ratio 2:1:1 - Sabor Limón", price: 18990, stock: 35 },
    { cat: 0, name: "Pre-Entreno Explosivo", desc: "Fruit Punch 30 servicios", price: 21990, stock: 40 },
    
    // Alimentación (Cat 1)
    { cat: 1, name: "Mantequilla de Maní Natural", desc: "Crujiente 500g", price: 4990, stock: 80 },
    { cat: 1, name: "Mantequilla de Maní Natural", desc: "Suave 500g", price: 4990, stock: 80 },
    { cat: 1, name: "Mantequilla de Maní Natural", desc: "Suave 1kg", price: 8990, stock: 50 },
    { cat: 1, name: "Avena Integral", desc: "Hojuelas 1kg", price: 2500, stock: 200 },
    { cat: 1, name: "Barra de Proteína Zero", desc: "Caja 12 unidades (Chocolate)", price: 14990, stock: 60 },
    { cat: 1, name: "Barra de Proteína Zero", desc: "Unidad (Chocolate)", price: 1500, stock: 150 },
    { cat: 1, name: "Panqueques Proteicos", desc: "Mix listo 400g", price: 6990, stock: 40 },

    // Bebidas Energéticas (Cat 2)
    { cat: 2, name: "Energy Drink Zero Azúcar", desc: "Lata 250ml - Clásica", price: 1200, stock: 300 },
    { cat: 2, name: "Energy Drink Zero Azúcar", desc: "Lata 250ml - Sandia", price: 1200, stock: 150 },
    { cat: 2, name: "Bebida Isotónica Sport", desc: "Botella 500ml - Berry", price: 1500, stock: 200 },
    { cat: 2, name: "Bebida Isotónica Sport", desc: "Botella 500ml - Limón", price: 1500, stock: 180 },
    { cat: 2, name: "Shot de Cafeína Puro", desc: "Botellita 60ml", price: 2500, stock: 100 },

    // Accesorios (Cat 3)
    { cat: 3, name: "Shaker Mezclador", desc: "600ml - Color Negro", price: 3990, stock: 120 },
    { cat: 3, name: "Shaker Mezclador", desc: "600ml - Color Rosa", price: 3990, stock: 50 },
    { cat: 3, name: "Banda de Resistencia", desc: "Nivel Ligero (Verde)", price: 5990, stock: 75 },
    { cat: 3, name: "Banda de Resistencia", desc: "Nivel Medio (Azul)", price: 6990, stock: 80 },
    { cat: 3, name: "Banda de Resistencia", desc: "Nivel Fuerte (Negro)", price: 7990, stock: 60 },
    { cat: 3, name: "Muñequeras de Fuerza", desc: "Par Talla Única", price: 9990, stock: 40 },

    // Ropa (Cat 4)
    { cat: 4, name: "Polera Deportiva DryFit", desc: "Talla S - Negro", price: 12990, stock: 30 },
    { cat: 4, name: "Polera Deportiva DryFit", desc: "Talla M - Negro", price: 12990, stock: 45 },
    { cat: 4, name: "Polera Deportiva DryFit", desc: "Talla L - Negro", price: 12990, stock: 40 },
    { cat: 4, name: "Short Entrenamiento", desc: "Talla M - Gris", price: 14990, stock: 25 },
    { cat: 4, name: "Short Entrenamiento", desc: "Talla L - Gris", price: 14990, stock: 30 },
  ];

  let pCount = 1;
  for (const p of productsData) {
    const sku = `SKU-${1000 + pCount}`;
    await db.insert(schema.product).values({
      id: "prod_" + randomUUID().substring(0, 8),
      organizationId: orgId,
      categoryId: dbCats[p.cat].id,
      name: p.name,
      description: p.desc,
      sku: sku,
      price: p.price,
      stock: p.stock,
      active: true,
    });
    pCount++;
  }

  console.log(`✓ Insertadas ${dbCats.length} categorías y ${productsData.length} productos.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Error en seed:", err);
  process.exit(1);
});
