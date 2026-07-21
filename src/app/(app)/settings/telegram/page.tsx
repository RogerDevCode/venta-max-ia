import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function TelegramSettingsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Canal Telegram</CardTitle>
          <CardDescription>
            Conecta un bot de Telegram para recibir mensajes, mostrar botones interactivos y responder desde Venta Max IA.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          <section className="rounded-md border bg-panel/50 p-4">
            <h3 className="font-semibold">1. Crear el bot y obtener el token</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-text-2">
              <li>Abre <strong>@BotFather</strong> en Telegram.</li>
              <li>Envía <code>/newbot</code>, elige nombre y un usuario terminado en <code>bot</code>.</li>
              <li>Copia el token entregado y guárdalo como <code>TELEGRAM_BOT_TOKEN</code> en las variables seguras del despliegue.</li>
            </ol>
          </section>
          <section className="rounded-md border bg-panel/50 p-4">
            <h3 className="font-semibold">2. Dirección pública y webhook</h3>
            <p className="mt-2 text-text-2">Necesitas una URL pública HTTPS en <code>APP_BASE_URL</code>. El webhook de cada organización usa la ruta <code>/api/webhooks/telegram/&lt;token-secreto&gt;</code>; el secreto identifica al tenant y no debe compartirse.</p>
          </section>
          <section className="rounded-md border bg-panel/50 p-4">
            <h3 className="font-semibold">3. Datos opcionales recomendados</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-text-2">
              <li><code>TELEGRAM_ID</code>: tu chat ID administrativo, para alertas internas.</li>
              <li>Nombre, foto, descripción y comandos del bot: se administran en BotFather, en <code>/mybots</code>.</li>
              <li>Usa <code>/start</code> para la primera prueba; el usuario debe iniciar el chat antes de que el bot pueda responderle.</li>
            </ul>
          </section>
          <p className="text-muted-foreground">Seguridad: trata el token como una contraseña. No lo pegues en código, mensajes ni capturas; si se expone, revócalo desde BotFather y crea uno nuevo.</p>
        </CardContent>
      </Card>
    </div>
  );
}
