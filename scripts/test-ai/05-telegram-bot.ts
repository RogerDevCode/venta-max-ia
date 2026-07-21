#!/usr/bin/env tsx
/**
 * Script de diagnóstico y verificación para el canal de Telegram Bot API.
 * Valida la conexión con @BotFather, inspecciona el estado del Webhook y verifica
 * el acceso al canal/usuario administrador configurado en TELEGRAM_ID.
 *
 * Ejecución: pnpm tsx scripts/test-ai/05-telegram-bot.ts
 * Opcional:  pnpm tsx scripts/test-ai/05-telegram-bot.ts --send (para enviar mensaje de prueba)
 */
import { readFileSync } from "node:fs";
import dns from "node:dns";

// Evitar que undici/fetch haga timeout en redes Linux donde IPv6 hacia api.telegram.org descarta paquetes
dns.setDefaultResultOrder("ipv4first");
const origLookup = dns.lookup;
dns.lookup = ((domain: any, options: any, callback: any) => {
  if (typeof options === "object" && options !== null) {
    if (!options.family) options.family = 4;
  } else if (typeof options === "function") {
    callback = options;
    options = { family: 4 };
  }
  return origLookup(domain, options, callback);
}) as typeof dns.lookup;

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  try {
    const file = readFileSync(".env", "utf8");
    for (const line of file.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        if (!env[k]) env[k] = v;
      }
    }
  } catch {}
  return env;
}

async function main() {
  console.log("==============================================================================");
  console.log("✈️  PRUEBA Y DIAGNÓSTICO: CANAL TELEGRAM BOT API (@BotFather)");
  console.log("==============================================================================");

  const env = loadEnv();
  const token = env.TELEGRAM_BOT_TOKEN;
  const adminId = env.TELEGRAM_ID;
  const baseUrl = env.TELEGRAM_API_BASE_URL || "https://api.telegram.org";

  if (!token) {
    console.error("❌ ERROR: No se encontró TELEGRAM_BOT_TOKEN en el archivo .env");
    process.exit(1);
  }

  const maskedToken = `${token.slice(0, 10)}...${token.slice(-5)}`;
  console.log(`🤖 Token del Bot      : ${maskedToken}`);
  console.log(`👤 Telegram Admin ID  : ${adminId || "(no configurado)"}`);
  console.log(`🔗 Endpoint Base API  : ${baseUrl}`);
  console.log("------------------------------------------------------------------------------");

  const startMs = Date.now();
  try {
    // 1. Verificar identidad del Bot con getMe
    const resMe = await fetch(`${baseUrl}/bot${token}/getMe`, { method: "POST" });
    const elapsedMe = Date.now() - startMs;

    if (!resMe.ok) {
      const errText = await resMe.text();
      console.error(`❌ ESTADO DE CONEXIÓN : FALLÓ (HTTP ${resMe.status})`);
      console.error(`   Detalle del error  : ${errText}`);
      process.exit(1);
    }

    const dataMe = (await resMe.json()) as { ok: boolean; result: { id: number; first_name: string; username?: string; can_join_groups?: boolean; can_read_all_group_messages?: boolean } };
    if (!dataMe.ok || !dataMe.result) {
      console.error("❌ ERROR: Telegram respondió con ok=false al verificar getMe");
      process.exit(1);
    }

    const bot = dataMe.result;
    console.log(`✅ ESTADO DE CONEXIÓN : EXITOSA (HTTP 200 OK en ${elapsedMe} ms)`);
    console.log(`ID Numérico del Bot   : ${bot.id}`);
    console.log(`Nombre del Bot        : ${bot.first_name}`);
    console.log(`Username del Bot      : @${bot.username || "(sin username)"}`);
    console.log(`Puede unirse a grupos : ${bot.can_join_groups ? "Sí" : "No"}`);
    console.log(`Privacidad en grupos  : ${bot.can_read_all_group_messages ? "Lee todo (Privacy OFF)" : "Solo comandos/menciones (Privacy ON)"}`);
    console.log("------------------------------------------------------------------------------");

    // 2. Consultar información del Webhook
    const startWh = Date.now();
    const resWh = await fetch(`${baseUrl}/bot${token}/getWebhookInfo`, { method: "POST" });
    if (resWh.ok) {
      const dataWh = (await resWh.json()) as { ok: boolean; result: { url: string; has_custom_certificate: boolean; pending_update_count: number; last_error_message?: string } };
      if (dataWh.ok && dataWh.result) {
        const wh = dataWh.result;
        console.log(`🌐 URL de Webhook     : ${wh.url ? wh.url : "(Ninguno configurado — Operando en modo manual / local)"}`);
        console.log(`📥 Updates pendientes : ${wh.pending_update_count}`);
        if (wh.last_error_message) {
          console.warn(`⚠️ Último error Webhook: ${wh.last_error_message}`);
        }
      }
    }
    console.log("==============================================================================");

    // 3. Envío opcional de mensaje de prueba
    if (process.argv.includes("--send")) {
      if (!adminId) {
        console.error("⚠️ No se puede enviar mensaje de prueba porque TELEGRAM_ID no está en .env");
      } else {
        console.log(`⌨️  Enviando indicador de escritura (typing) al chat ${adminId}...`);
        const actionUrl = `${baseUrl}/bot${token}/sendChatAction`;
        const resAction = await fetch(actionUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: adminId, action: "typing" }),
        });
        if (resAction.ok) {
          console.log("✅ Acción de escritura (typing) transmitida correctamente.");
        } else {
          console.warn("⚠️ No se pudo transmitir acción typing:", await resAction.text());
        }

        console.log(`📨 Enviando mensaje de prueba al TELEGRAM_ID ${adminId}...`);
        const sendUrl = `${baseUrl}/bot${token}/sendMessage`;
        const resSend = await fetch(sendUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: adminId,
            text: `✈️ *Venta Max IA — Diagnóstico de Telegram*\n\n✅ Conexión establecida y verificada.\n🤖 Bot: @${bot.username}\n⌨️ Acción Typing: OK\n⏱️ Latencia API: ${elapsedMe} ms\n\n_Tu agente está conectado y listo para operar en este canal._`,
            parse_mode: "Markdown",
          }),
        });

        if (resSend.ok) {
          const sentMsg = (await resSend.json()) as { result: { message_id: number } };
          console.log(`✅ Mensaje de prueba entregado con éxito (ID de Mensaje: ${sentMsg?.result?.message_id}).`);
        } else {
          const sendErr = await resSend.text();
          console.error(`❌ Error enviando mensaje a ${adminId}:`, sendErr);
        }
        console.log("==============================================================================");
      }
    } else if (adminId) {
      console.log(`💡 Para enviar un mensaje real de prueba a tu Telegram (${adminId}), ejecuta:`);
      console.log("   pnpm tsx scripts/test-ai/05-telegram-bot.ts --send");
      console.log("==============================================================================");
    }
  } catch (err) {
    console.error("❌ ERROR CRÍTICO DE CONEXIÓN CON TELEGRAM:", err);
    process.exit(1);
  }
}

main();
