import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { scoped } from "@/lib/db/tenant";
import { schema } from "@/lib/db";

describe("Tablas y Aislamiento Multi-Tenant en E-Commerce (Paso 5.1 / Principio III)", () => {
  it("las 4 tablas de E-Commerce (category, product, cart, order) tienen organizationId no nulo", () => {
    expect(schema.category.organizationId).toBeDefined();
    expect(schema.category.organizationId.name).toBe("organization_id");
    expect(schema.category.organizationId.notNull).toBe(true);

    expect(schema.product.organizationId).toBeDefined();
    expect(schema.product.organizationId.name).toBe("organization_id");
    expect(schema.product.organizationId.notNull).toBe(true);

    expect(schema.cart.organizationId).toBeDefined();
    expect(schema.cart.organizationId.name).toBe("organization_id");
    expect(schema.cart.organizationId.notNull).toBe(true);

    expect(schema.order.organizationId).toBeDefined();
    expect(schema.order.organizationId.name).toBe("organization_id");
    expect(schema.order.organizationId.notNull).toBe(true);
  });

  it("scoped() lanza error si se intenta acceder a catálogos o productos sin un organizationId explícito", () => {
    expect(() => scoped(schema.product.organizationId, "")).toThrow(/sin tenant/);
    expect(() => scoped(schema.category.organizationId, "")).toThrow(/sin tenant/);
    expect(() => scoped(schema.cart.organizationId, "")).toThrow(/sin tenant/);
    expect(() => scoped(schema.order.organizationId, "")).toThrow(/sin tenant/);
  });

  it("scoped() combina organizationId con SKU o número de orden impidiendo cruce entre organizaciones", () => {
    const prodCondition = scoped(
      schema.product.organizationId,
      "org_alfa",
      eq(schema.product.sku, "SKU-DENTAL-01")
    );
    const dialect = new PgDialect();
    const prodQuery = dialect.sqlToQuery(prodCondition);

    expect(prodQuery.sql).toContain("organization_id");
    expect(prodQuery.sql).toContain("sku");
    expect(prodQuery.sql.toLowerCase()).toContain("and");
    expect(prodQuery.params).toContain("org_alfa");
    expect(prodQuery.params).toContain("SKU-DENTAL-01");

    const orderCondition = scoped(
      schema.order.organizationId,
      "org_beta",
      eq(schema.order.orderNumber, "ORD-999")
    );
    const orderQuery = dialect.sqlToQuery(orderCondition);

    expect(orderQuery.sql).toContain("organization_id");
    expect(orderQuery.sql).toContain("order_number");
    expect(orderQuery.params).toContain("org_beta");
    expect(orderQuery.params).toContain("ORD-999");
  });
});
