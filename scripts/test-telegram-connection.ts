#!/usr/bin/env tsx
/**
 * Verifica únicamente que el token de Telegram pueda autenticarse con Bot API.
 *
 * Uso: pnpm test:telegram:connection
 * Lee TELEGRAM_BOT_TOKEN desde el entorno o el archivo .env. No envía mensajes,
 * no registra webhooks y nunca imprime el token.
 */
import dns from "node:dns";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

type TelegramGetMeResponse = {
  ok?: boolean;
  result?: {
    id: number;
    first_name: string;
    username?: string;
  };
  error_code?: number;
  description?: string;
};

function loadEnv(): Record<string, string> {
  const values: Record<string, string> = { ...process.env as Record<string, string> };
  try {
    const file = readFileSync(".env", "utf8");
    for (const line of file.split(/\r?\n/)) {
      const entry = line.trim();
      if (!entry || entry.startsWith("#")) continue;
      const separator = entry.indexOf("=");
      if (separator < 0) continue;
      const key = entry.slice(0, separator).trim();
      const value = entry.slice(separator + 1).trim();
      if (!values[key] && value) values[key] = value;
    }
  } catch {
    // El entorno puede suministrar las variables sin archivo .env.
  }
  return values;
}

function getMe(url: string): Promise<TelegramGetMeResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "curl",
      ["--silent", "--show-error", "--fail-with-body", "--max-time", "15", "--request", "POST", "--config", "-"],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    let output = "";
    let errorOutput = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.on("data", (chunk: string) => { errorOutput += chunk; });
    child.once("error", (error) => reject(new Error(`No se pudo ejecutar curl: ${error.message}`)));
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput.trim() || `curl finalizó con código ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(output) as TelegramGetMeResponse);
      } catch {
        reject(new Error("Telegram devolvió una respuesta no válida."));
      }
    });
    // curl recibe la URL desde stdin: el token no queda expuesto en la lista de procesos.
    child.stdin.end(`url = ${JSON.stringify(url)}\n`);
  });
}

async function main() {
  dns.setDefaultResultOrder("ipv4first");
  const env = loadEnv();
  const token = env.TELEGRAM_BOT_TOKEN;
  const baseUrl = env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org";

  if (!token) {
    console.error("FALLÓ: falta TELEGRAM_BOT_TOKEN en el entorno o .env.");
    process.exitCode = 1;
    return;
  }

  const startedAt = performance.now();
  try {
    const payload = await getMe(`${baseUrl}/bot${token}/getMe`);

    if (!payload.ok || !payload.result) {
      console.error(
        `FALLÓ: Telegram rechazó la conexión (${payload.error_code ? `API ${payload.error_code}` : "sin código de API"}). ${payload.description ?? "Sin detalle."}`
      );
      process.exitCode = 1;
      return;
    }

    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log("CONEXIÓN TELEGRAM: OK");
    console.log(`Bot: ${payload.result.first_name}${payload.result.username ? ` (@${payload.result.username})` : ""}`);
    console.log(`ID del bot: ${payload.result.id}`);
    console.log(`Latencia: ${elapsedMs} ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error(`FALLÓ: no se pudo contactar Telegram. ${message}`);
    process.exitCode = 1;
  }
}

void main();
