"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { todayActions, type OperatorToday } from "./today-model";

const EMPTY_TODAY: OperatorToday = {
  unreadConversations: 0,
  pendingOrders: 0,
  telegramStatus: "unconfigured",
};

export function TodayClient() {
  const [today, setToday] = useState<OperatorToday>(EMPTY_TODAY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/conversations/unread").then(async (response) => {
        if (!response.ok) throw new Error("unread_unavailable");
        return response.json() as Promise<{ unread: number }>;
      }),
      fetch("/api/analytics?range=7d").then(async (response) => {
        if (!response.ok) throw new Error("analytics_unavailable");
        return response.json() as Promise<{ kpis: { pendingOrders: number } }>;
      }),
      fetch("/api/settings/telegram").then(async (response) => {
        if (!response.ok) throw new Error("telegram_unavailable");
        return response.json() as Promise<{
          connection: { status: OperatorToday["telegramStatus"] } | null;
        }>;
      }),
    ])
      .then(([inbox, analytics, telegram]) => {
        if (active)
          setToday({
            unreadConversations: inbox.unread ?? 0,
            pendingOrders: analytics.kpis.pendingOrders ?? 0,
            telegramStatus: telegram.connection?.status ?? "unconfigured",
          });
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section
      className="h-full overflow-y-auto px-6 py-7 md:px-10"
      aria-labelledby="today-title"
    >
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
          Atención ordenada
        </p>
        <h1
          id="today-title"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          Hoy
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-text-2">
          Parte por las conversaciones y pedidos que necesitan tu criterio.
          Telegram sigue siendo tu canal activo; nada se responde ni se confirma
          sin la regla y revisión que corresponden.
        </p>
        <p className="mt-2 max-w-2xl text-sm text-text-3">
          Cuando termines lo urgente, usa Contactos, Pipeline, Agente y
          Configuración para preparar tu operación con calma.
        </p>
        {error && (
          <p
            className="mt-5 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-text-2"
            role="alert"
          >
            No pudimos actualizar los contadores. Puedes abrir Bandeja o Pedidos
            directamente.
          </p>
        )}
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          {todayActions(today).map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="rounded-lg border border-border bg-card p-5 transition hover:border-brand hover:bg-brand-tint"
            >
              <span className="text-3xl font-semibold text-brand">
                {loading ? "—" : action.count}
              </span>
              <span className="mt-2 block font-semibold">{action.label}</span>
              <span className="mt-1 block text-sm text-text-3">
                {action.action} →
              </span>
            </Link>
          ))}
        </div>
        <div className="mt-6 rounded-lg border border-border bg-subtle p-4 text-sm text-text-2">
          <strong className="text-foreground">Estado de Telegram:</strong>{" "}
          {today.telegramStatus === "connected"
            ? "conectado; revisa los mensajes desde la Bandeja."
            : today.telegramStatus === "reconnect_required"
              ? "requiere reconexión; revísalo en Configuración antes de confiar en nuevos mensajes."
              : "aún no está conectado; puedes configurarlo cuando estés listo."}
        </div>
      </div>
    </section>
  );
}
