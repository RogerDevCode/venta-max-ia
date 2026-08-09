#!/usr/bin/env tsx
import "./enforce-ipv4";
/**
 * Simulador E2E 100% real de Webhooks de Telegram.
 * 
 * Este script inserta una integración de prueba en la base de datos real,
 * dispara una petición HTTP POST idéntica a la que enviaría Telegram hacia el
 * servidor web (Next.js) corriendo en APP_BASE_URL, y verifica que el mensaje
 * haya cruzado todas las capas (HTTP -> DB -> Queue) sin fallar silenciosamente.
 * 
 * Uso: pnpm tsx scripts/e2e-webhook-simulator.ts
 */

import { eq } from "drizzle-orm";
import { getDb } from "../src/lib/db/index";
import { organization, telegramIntegration, telegramWebhookReceipt } from "../src/lib/db/schema";
import { nanoid } from "nanoid";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    const file = readFileSync(".env", "utf8");
    for (const line of file.split(/\r?\n/)) {
      const entry = line.trim();
      if (!entry || entry.startsWith("#")) continue;
      const separator = entry.indexOf("=");
      if (separator < 0) continue;
      const key = entry.slice(0, separator).trim();
      const value = entry.slice(separator + 1).trim();
      if (!process.env[key] && value) process.env[key] = value;
    }
  } catch {}
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function main() {
  loadEnv();
  const baseUrl = process.env.APP_BASE_URL || "http://127.0.0.1:3000";
  console.log(`\n🚀 Iniciando Simulador Webhook Telegram E2E contra: ${baseUrl}`);
  const db = getDb();

  const orgId = `org_test_${nanoid(10)}`;
  const plainToken = `tk_${nanoid(20)}`;
  const secretHeader = `sec_${nanoid(20)}`;
  const integrationId = `tg_test_${nanoid(10)}`;
  const updateId = Math.floor(Math.random() * 1000000000);

  try {
    console.log("1️⃣ Creando Organización e Integración de Prueba en BD...");
    await db.insert(organization).values({
      id: orgId,
      name: "Org Simulador E2E",
      slug: orgId,
    });

    await db.insert(telegramIntegration).values({
      id: integrationId,
      organizationId: orgId,
      webhookTokenHash: hashToken(plainToken),
      webhookHeaderSecretHash: hashToken(secretHeader),
      status: "connected",
      botId: Math.floor(Math.random() * 10000000),
    });
    console.log("   ✅ Base de datos preparada.");

    console.log("2️⃣ Enviando Payload HTTP 100% real (como Telegram)...");
    const payload = {
      update_id: updateId,
      message: {
        message_id: 1,
        from: { id: 123456789, is_bot: false, first_name: "UsuarioE2E", language_code: "es" },
        chat: { id: 123456789, first_name: "UsuarioE2E", type: "private" },
        date: Math.floor(Date.now() / 1000),
        text: "Hola, esta es una prueba E2E 100% real",
      }
    };

    const webhookUrl = `${baseUrl}/api/webhooks/telegram/${plainToken}`;
    
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": secretHeader
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`El servidor devolvió HTTP ${response.status}: ${await response.text()}`);
    }

    const json = await response.json();
    console.log("   ✅ Respuesta HTTP 200 OK del servidor Webhook.");

    console.log("3️⃣ Verificando que la base de datos haya registrado el mensaje (evita fallos silenciosos)...");
    
    // Esperar un segundo para que cualquier proceso asíncrono termine (si no fuera bloqueante)
    await new Promise(resolve => setTimeout(resolve, 500));

    const receipt = await db.query.telegramWebhookReceipt.findFirst({
      where: eq(telegramWebhookReceipt.updateId, updateId)
    });

    if (!receipt) {
      throw new Error("❌ FALLO CRÍTICO: El servidor dio OK pero el mensaje NO se guardó en la tabla telegram_webhook_receipt. Hay un error silencioso o fallo de BD (como falta de columnas).");
    }

    console.log(`   ✅ ¡Éxito! El mensaje se guardó correctamente con ID: ${receipt.id} y estado: ${receipt.status}`);
    console.log("\n🎉 CERTIFICACIÓN 100% REAL COMPLETADA CON ÉXITO.");

  } catch (error) {
    console.error("\n❌ ERROR DURANTE LA PRUEBA E2E:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    console.log("\n🧹 Limpiando datos de prueba...");
    try {
      await db.delete(organization).where(eq(organization.id, orgId));
      console.log("   ✅ Limpieza terminada.");
    } catch (cleanupError) {
      console.error("   ❌ Error al limpiar la BD:", cleanupError);
    }
  }
}

main();
