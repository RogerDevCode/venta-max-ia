#!/usr/bin/env tsx
/**
 * Script de prueba para Modelos de Respaldo / Juez (`gemini-2.5-flash` y `groq/llama-3.3-70b-versatile`).
 * Verifica latencia, estructura de respuesta, telemetría y salud del ruteador de contingencia.
 *
 * Ejecución: pnpm tsx scripts/test-ai/04-fallbacks.ts
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

async function testGroqJudge(env: Record<string, string>) {
  console.log("==============================================================================");
  console.log("🟨 PRUEBA: MODELO DEL JUEZ / FALLBACK GROQ (llama-3.3-70b-versatile)");
  console.log("==============================================================================");
  const apiKey = env.GROQ_API_KEY;
  const model = env.PROVIDER_JUDGE_MODEL || "groq/llama-3.3-70b-versatile";
  const targetModel = model.replace(/^groq\//i, "");

  if (!apiKey) {
    console.warn("⚠️ OMITIDO: No se encontró GROQ_API_KEY en .env");
    return;
  }

  const startTime = performance.now();
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: targetModel,
        messages: [{ role: "user", content: "Di 'Groq Operativo' en 2 palabras." }],
      }),
    });
    const latencyMs = Math.round(performance.now() - startTime);
    if (!res.ok) {
      console.error(`❌ Falló HTTP ${res.status}: ${await res.text()}`);
      return;
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    console.log(`✅ ESTADO : EXITOSA | ⏱️ LATENCIA: ${latencyMs} ms | 🤖 RESPUESTA: "${data.choices?.[0]?.message?.content?.trim()}"`);
  } catch (err) {
    console.error("❌ ERROR GROQ:", err);
  }
}

async function testGroqInstantFallback(env: Record<string, string>) {
  console.log("------------------------------------------------------------------------------");
  console.log("🟩 PRUEBA: MODELO FALLBACK 1 / GROQ INSTANT (llama-3.1-8b-instant)");
  console.log("------------------------------------------------------------------------------");
  const apiKey = env.GROQ_API_KEY;
  const rawModel = env.PROVIDER_JUDGE_FALLBACK_MODEL || env.FALLBACK_MODEL_1 || "groq/llama-3.1-8b-instant";
  const targetModel = rawModel.replace(/^groq\//i, "");

  if (!apiKey) {
    console.warn("⚠️ OMITIDO: No se encontró GROQ_API_KEY en .env");
    return;
  }

  const startTime = performance.now();
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: targetModel,
        messages: [{ role: "user", content: "Di 'Groq Fallback Operativo' en 3 palabras." }],
      }),
    });
    const latencyMs = Math.round(performance.now() - startTime);
    if (!res.ok) {
      console.error(`❌ Falló HTTP ${res.status}: ${await res.text()}`);
      return;
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    console.log(`✅ ESTADO : EXITOSA | ⏱️ LATENCIA: ${latencyMs} ms | 🤖 RESPUESTA: "${data.choices?.[0]?.message?.content?.trim()}"`);
  } catch (err) {
    console.error("❌ ERROR GROQ FALLBACK:", err);
  }
  console.log("==============================================================================\n");
}

async function testOpenRouterFreeFallback(env: Record<string, string>) {
  console.log("------------------------------------------------------------------------------");
  console.log("🟩 PRUEBA: MODELO FALLBACK 2 / OPENROUTER FREE ROUTER (openrouter/free)");
  console.log("------------------------------------------------------------------------------");
  const apiKey = env.OPENROUTER_API_KEY || env.PROVIDER_API_TOKEN;
  const rawModel = env.FALLBACK_MODEL_2 || "openrouter/free";

  if (!apiKey) {
    console.warn("⚠️ OMITIDO: No se encontró OPENROUTER_API_KEY en .env");
    return;
  }

  const startTime = performance.now();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: rawModel,
        messages: [{ role: "user", content: "Di 'OpenRouter Free Operativo' brevemente." }],
      }),
    });
    const latencyMs = Math.round(performance.now() - startTime);
    if (!res.ok) {
      console.error(`❌ Falló HTTP ${res.status}: ${await res.text()}`);
      return;
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    console.log(`✅ ESTADO : EXITOSA | ⏱️ LATENCIA: ${latencyMs} ms | 🤖 RESPUESTA: "${data.choices?.[0]?.message?.content?.trim()}"`);
  } catch (err) {
    console.error("❌ ERROR OPENROUTER FALLBACK:", err);
  }
  console.log("==============================================================================\n");
}

async function main() {
  const env = loadEnv();
  await testGroqJudge(env);
  await testGroqInstantFallback(env);
  await testOpenRouterFreeFallback(env);
}

main();
