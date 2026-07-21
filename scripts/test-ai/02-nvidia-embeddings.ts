#!/usr/bin/env tsx
/**
 * Script de prueba exclusivo para NVIDIA NIM Embeddings (`nvidia/nv-embedqa-e5-v5`).
 * Verifica conexión a la infraestructura GPU de NVIDIA, latencia, dimensiones y estado.
 *
 * Ejecución: pnpm tsx scripts/test-ai/02-nvidia-embeddings.ts
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
  console.log("🟩 PRUEBA EXCLUSIVA (FALLBACK): NVIDIA NIM EMBEDDINGS (nv-embedqa-e5-v5)");
  console.log("==============================================================================");

  const env = loadEnv();
  const apiKey = env.NVIDIA_API_KEY;
  const model = env.EMBEDDING_FALLBACK_MODEL || "nvidia/nv-embedqa-e5-v5";

  if (!apiKey) {
    console.error("❌ ERROR: No se encontró NVIDIA_API_KEY en .env");
    process.exit(1);
  }

  console.log(`📡 Modelo configurado : ${model}`);
  console.log(`🔑 API Key detectada  : ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);
  console.log(`🔗 Endpoint utilizado : https://integrate.api.nvidia.com/v1/embeddings`);
  console.log("------------------------------------------------------------------------------");

  const testText = "¿Cuáles son las ventajas del plan empresarial anual en Venta Max IA?";
  console.log(`📝 Texto de prueba    : "${testText}"`);

  const startTime = performance.now();
  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [testText],
        input_type: "query",
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
      data?: { embedding?: number[] }[];
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };

    const vector = data.data?.[0]?.embedding;
    if (!vector || !Array.isArray(vector)) {
      console.error("❌ El payload devuelto no contiene un vector de embedding válido");
      process.exit(1);
    }

    console.log(`✅ ESTADO DE CONEXIÓN : EXITOSA (HTTP 200 OK)`);
    console.log(`⏱️ LATENCIA (ms)       : ${latencyMs} ms`);
    console.log(`📐 DIMENSIONES RAW    : ${vector.length} dimensiones (NVIDIA E5-v5 Nativo)`);
    console.log(`🔢 MUESTRA DEL VECTOR : [${vector.slice(0, 4).map(v => v.toFixed(5)).join(", ")}, ...]`);
    if (data.usage) {
      console.log(`🪙 TOKENS CONSUMIDOS  : ${data.usage.prompt_tokens ?? data.usage.total_tokens ?? "N/A"}`);
    }
    console.log(`⚡ ESTABILIDAD / RPM  : Alta velocidad en GPU dedicada de build.nvidia.com`);
    console.log("==============================================================================\n");
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startTime);
    console.error(`❌ ERROR DE RED O SISTEMA tras ${latencyMs} ms:`, error);
    process.exit(1);
  }
}

main();
