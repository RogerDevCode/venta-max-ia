"use client";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Connection = { botId: number; botUsername: string | null; status: string; tokenLast4: string };

export function TelegramSettingsClient() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/settings/telegram").catch(() => null);
    if (res?.ok) setConnection((await res.json() as { connection: Connection | null }).connection);
  }

  useEffect(() => { void load(); }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/settings/telegram", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    setSaving(false);
    if (!res) {
      setMessage("No se pudo contactar al servidor. Verifica que Venta Max IA esté en ejecución y vuelve a intentar.");
      return;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setMessage(data?.error?.message ?? "No se pudo conectar.");
      return;
    }
    setToken("");
    setMessage("Bot conectado y webhook registrado.");
    await load();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Canal Telegram</CardTitle>
          <CardDescription>
            Este token pertenece exclusivamente a este tenant y se cifra antes de guardarse.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <section className="rounded border bg-panel/50 p-3 text-sm">
            <p className="font-medium">Antes de conectar</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Crea el bot en @BotFather con <code>/newbot</code> y copia su token.</li>
              <li>Configura <code>APP_BASE_URL</code> con el dominio o túnel público HTTPS de Venta Max IA.</li>
              <li>Guarda el token: el sistema registra el webhook y los comandos del bot.</li>
            </ol>
          </section>

          {connection && (
            <p className="rounded border p-3 text-sm">
              Conectado: @{connection.botUsername ?? connection.botId} · token …{connection.tokenLast4}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="telegram-token">Token del bot de este negocio</Label>
            <div className="relative">
              <Input
                id="telegram-token"
                type={showToken ? "text" : "password"}
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Token entregado por @BotFather"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                title={showToken ? "Ocultar token" : "Ver token"}
                aria-label={showToken ? "Ocultar token" : "Ver token"}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              En BotFather: /newbot → copia el token de atención a clientes de este negocio. El bot administrativo se configura por separado en el servidor.
            </p>
          </div>

          <section aria-label="Panel de incidencias" className="rounded border bg-panel/50 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">Panel de incidencias</p>
                <p role={message ? "alert" : undefined} className="text-muted-foreground">
                  {message ?? "Sin incidencias activas."}
                </p>
              </div>
              {message && (
                <Button variant="outline" size="sm" onClick={() => setMessage(null)}>
                  Limpiar
                </Button>
              )}
            </div>
          </section>

          <Button disabled={saving || token.trim().length < 20} onClick={() => void save()}>
            {saving ? "Conectando…" : "Probar, guardar y registrar webhook"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

