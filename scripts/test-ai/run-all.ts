#!/usr/bin/env tsx
/**
 * Ejecutor central de pruebas de Inteligencia Artificial (Benchmark y Diagnóstico de Salud).
 * Ejecuta los 4 scripts individuales e imprime un resumen ejecutivo.
 *
 * Ejecución: pnpm test:ai o pnpm tsx scripts/test-ai/run-all.ts
 */
import { spawn } from "node:child_process";

const scripts = [
  "scripts/test-ai/01-gemini-embeddings.ts",
  "scripts/test-ai/02-nvidia-embeddings.ts",
  "scripts/test-ai/03-deepseek-llm.ts",
  "scripts/test-ai/04-fallbacks.ts",
];

function runScript(path: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["-y", "tsx", path], { stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  console.log("\n🚀 INICIANDO BENCHMARK DIAGNÓSTICO DE MODELOS DE IA EN VENTA MAX IA\n");
  for (const script of scripts) {
    await runScript(script);
  }
  console.log("🎯 DIAGNÓSTICO Y BENCHMARK DE IA COMPLETADO.\n");
}

main();
