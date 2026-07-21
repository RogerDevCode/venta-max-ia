#!/usr/bin/env tsx
/**
 * Script de prueba exclusivo para Google Gemini Embeddings (`text-embedding-004`).
 * Utiliza el endpoint nativo de Gemini API para máxima estabilidad y compatibilidad.
 *
 * Ejecución: pnpm tsx scripts/test-ai/01-gemini-embeddings.ts
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
  console.log("🟦 PRUEBA EXCLUSIVA: GOOGLE GEMINI EMBEDDINGS (text-embedding-004)");
  console.log("==============================================================================");

  const env = loadEnv();
  const apiKey = env.GEMINI_API_KEY || env.PROVIDER_API_TOKEN;
  const rawModel = env.EMBEDDING_MODEL || "gemini-embedding-2";
  const targetModel = rawModel.startsWith("models/") ? rawModel : `models/${rawModel}`;

  if (!apiKey) {
    console.error("❌ ERROR: No se encontró GEMINI_API_KEY en .env");
    process.exit(1);
  }

  console.log(`📡 Modelo configurado : ${rawModel} -> ${targetModel}`);
  console.log(`🔑 API Key detectada  : ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${targetModel}:embedContent`;
  console.log(`🔗 Endpoint utilizado : ${endpoint}`);
  console.log("------------------------------------------------------------------------------");

  const testText = "¿Cuáles son las ventajas del plan empresarial anual en Venta Max IA?";
  console.log(`📝 Texto de prueba    : "${testText}"`);

  const startTime = performance.now();
  try {
    const response = await fetch(`${endpoint}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: targetModel,
        content: {
          parts: [{ text: testText }],
        },
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
      embedding?: { values?: number[] };
    };

    const vector = data.embedding?.values;
    if (!vector || !Array.isArray(vector)) {
      console.error("❌ El payload devuelto no contiene un vector de embedding válido en embedding.values");
      process.exit(1);
    }

    console.log(`✅ ESTADO DE CONEXIÓN : EXITOSA (HTTP 200 OK)`);
    console.log(`⏱️ LATENCIA (ms)       : ${latencyMs} ms`);
    console.log(`📐 DIMENSIONES RAW    : ${vector.length} dimensiones (Gemini E5/004 Nativo)`);
    console.log(`🔢 MUESTRA DEL VECTOR : [${vector.slice(0, 4).map(v => v.toFixed(5)).join(", ")}, ...]`);
    console.log(`⚡ ESTABILIDAD / RPM  : Límite gratuito generoso (hasta 1,500 RPM en AI Studio)`);
    console.log("==============================================================================\n");
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startTime);
    console.error(`❌ ERROR DE RED O SISTEMA tras ${latencyMs} ms:`, error);
    process.exit(1);
  }
}

main();
