import { describe, expect, it } from "vitest";
import { getEnvFrom } from "@/lib/env";

const valid = {
  NODE_ENV: "production",
  APP_BASE_URL: "https://bot.tuvitrina.lat",
  APP_DATABASE_URL: "postgresql://venta_app:x@postgres:5432/vocero",
  AUTH_DATABASE_URL: "postgresql://venta_auth:x@postgres:5432/vocero",
  INGRESS_DATABASE_URL: "postgresql://venta_ingress:x@postgres:5432/vocero",
  BETTER_AUTH_SECRET: "a".repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
};

describe("entorno seguro", () => {
  it("falla cerrado sin URL de aplicación", () => {
    const { APP_DATABASE_URL: _removed, ...missing } = valid;
    expect(() => getEnvFrom(missing)).toThrow(/APP_DATABASE_URL/);
  });

  it("acepta conexiones separadas", () => {
    expect(getEnvFrom(valid).AUTH_DATABASE_URL).toContain("venta_auth");
  });
});
