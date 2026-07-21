import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function TelegramSettingsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Canal Telegram</CardTitle>
          <CardDescription>
            Telegram está disponible como canal principal del asistente. La integración recibe actualizaciones idempotentes mediante su webhook por organización.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Configura el token del bot y la URL del webhook desde las variables seguras de tu despliegue.</p>
          <p>WhatsApp permanece deshabilitado en la navegación mientras se prioriza este canal.</p>
        </CardContent>
      </Card>
    </div>
  );
}
