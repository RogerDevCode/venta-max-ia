#!/usr/bin/env tsx
/**
 * Script de prueba exclusivo para DeepSeek LLM Principal (`deepseek/deepseek-v4-flash`).
 * Verifica la conexión soberana y directa a la API de DeepSeek, latencia, respuesta y tokens.
 *
 * Ejecución: pnpm tsx scripts/test-ai/03-deepseek-llm.ts
 */
import { readFileSync } from "node:fs";

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
  console.log("🟦 PRUEBA EXCLUSIVA: DEEPSEEK LLM PRINCIPAL (deepseek-v4-flash)");
  console.log("==============================================================================");

  const env = loadEnv();
  const apiKey = env.DEEPSEEK_API_KEY || env.PROVIDER_API_TOKEN;
  const rawModel = env.PROVIDER_MODEL || env.MODEL_NAME || "deepseek/deepseek-v4-flash";
  const targetModel = rawModel.replace(/^deepseek\//i, "");

  if (!apiKey) {
    console.error("❌ ERROR: No se encontró DEEPSEEK_API_KEY ni PROVIDER_API_TOKEN en .env");
    process.exit(1);
  }

  console.log(`📡 Modelo configurado : ${rawModel} -> Enviado como: ${targetModel}`);
  console.log(`🔑 API Key detectada  : ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);
  console.log(`🔗 Endpoint utilizado : https://api.deepseek.com/chat/completions`);
  console.log("------------------------------------------------------------------------------");

  const prompt = "Actúa como el Agente Venta Max IA. Resume en 1 sola frase potente qué es Venta Max IA.";
  console.log(`💬 Prompt enviado     : "${prompt}"`);

  const startTime = performance.now();
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: targetModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      }),
    });

    const latencyMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ Falló la petición HTTP ${response.status}: ${errText}`);
      console.error(`⏱️ Latencia de fallo  : ${latencyMs} ms`);
      process.exit(1);
    }

    const data = await response.json() as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const reply = data.choices?.[0]?.message?.content;
    if (!reply) {
      console.error("❌ La respuesta no contiene texto en la estructura choices[0].message.content");
      process.exit(1);
    }

    console.log(`✅ ESTADO DE CONEXIÓN : EXITOSA (HTTP 200 OK)`);
    console.log(`⏱️ LATENCIA (ms)       : ${latencyMs} ms`);
    console.log(`🤖 RESPUESTA DE DEEPSEEK:\n"${reply.trim()}"`);
    if (data.usage) {
      console.log(`🪙 TOKENS CONSUMIDOS  : Prompt=${data.usage.prompt_tokens ?? 0} | Respuesta=${data.usage.completion_tokens ?? 0} | Total=${data.usage.total_tokens ?? 0}`);
    }
    console.log(`⚡ ESTABILIDAD / RPM  : API oficial de DeepSeek (Soberana y sin intermediarios)`);
    console.log("==============================================================================\n");
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startTime);
    console.error(`❌ ERROR DE RED O SISTEMA tras ${latencyMs} ms:`, error);
    process.exit(1);
  }
}

main();
