"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  CreditCard,
  DollarSign,
  Filter,
  MessageSquare,
  PackageCheck,
  PauseCircle,
  Play,
  RotateCcw,
  ShoppingBag,
  Truck,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { useEvents } from "@/components/use-events";

export type OrderDto = {
  id: string;
  orderNumber: string;
  contactId: string;
  conversationId: string | null;
  contact: {
    id: string;
    name: string;
    channel: string;
    externalAddress: string;
  };
  items: {
    productId: string;
    quantity: number;
    unitPrice: number;
    name: string;
    presentation: string | null;
  }[];
  totalAmount: number;
  isPaid: boolean;
  status:
    | "pending"
    | "confirmed"
    | "processing"
    | "pending_shipment"
    | "shipped"
    | "delivered"
    | "paused"
    | "completed"
    | "cancelled";
  createdAt: string;
  updatedAt: string;
};

const COLUMNS = [
  { id: "pending", label: "Pendientes", badgeBg: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  { id: "processing", label: "En Proceso", badgeBg: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  { id: "pending_shipment", label: "Pendiente Envío", badgeBg: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" },
  { id: "shipped", label: "Enviado", badgeBg: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" },
  { id: "delivered", label: "Entregado", badgeBg: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  { id: "paused", label: "En Pausa", badgeBg: "bg-purple-500/15 text-purple-600 dark:text-purple-400" },
  { id: "cancelled", label: "Cancelados", badgeBg: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
] as const;

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(amount);
}

function timeAgo(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return "hace un momento";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function OrdersClient() {
  const [orders, setOrders] = useState<OrderDto[] | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [rangeFilter, setRangeFilter] = useState<string>("24h");

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/orders?range=${rangeFilter}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { orders: OrderDto[] };
    setOrders(data.orders);
  }, [rangeFilter]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEvents({
    onConversationUpdated: () => void refetch(),
    onMessageNew: () => void refetch(),
  });

  async function updateStatus(orderId: string, status: OrderDto["status"]) {
    setUpdatingId(orderId);
    setOrders((prev) =>
      prev ? prev.map((o) => (o.id === orderId ? { ...o, status } : o)) : null
    );
    await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    setUpdatingId(null);
    void refetch();
  }

  async function togglePaid(orderId: string, isPaid: boolean) {
    setUpdatingId(orderId);
    setOrders((prev) =>
      prev ? prev.map((o) => (o.id === orderId ? { ...o, isPaid } : o)) : null
    );
    await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPaid }),
    }).catch(() => null);
    setUpdatingId(null);
    void refetch();
  }

  // Filtrado
  const filtered = (orders ?? []).filter((o) => {
    // Filtro por estado
    if (statusFilter !== "all") {
      if (statusFilter === "pending" && o.status !== "pending" && o.status !== "confirmed") return false;
      if (statusFilter === "delivered" && o.status !== "delivered" && o.status !== "completed") return false;
      if (statusFilter !== "pending" && statusFilter !== "delivered" && o.status !== statusFilter) return false;
    }
    // Filtro por texto
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      o.orderNumber.toLowerCase().includes(q) ||
      o.contact.name.toLowerCase().includes(q) ||
      o.items.some((i) => i.name.toLowerCase().includes(q))
    );
  });

  // Métricas de primer vistazo
  const pendingCount = orders?.filter((o) => o.status === "pending" || o.status === "confirmed").length ?? 0;
  const processingCount = orders?.filter((o) => o.status === "processing" || o.status === "pending_shipment" || o.status === "shipped").length ?? 0;
  const completedOrders = orders?.filter((o) => o.status === "delivered" || o.status === "completed") ?? [];
  const totalSales = completedOrders.reduce((sum, o) => sum + o.totalAmount, 0);
  const avgTicket = completedOrders.length > 0 ? totalSales / completedOrders.length : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-background/80 backdrop-blur-sm px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight">Gestión de Pedidos y Envíos</h2>
            <p className="text-xs text-text-3">
              Cola de pedidos recibidos por Telegram para atención, empaque, envío y entrega
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Filtro de Jornada Operativa */}
          <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs">
            <Clock className="h-3.5 w-3.5 text-brand" />
            <select
              value={rangeFilter}
              onChange={(e) => setRangeFilter(e.target.value)}
              className="bg-transparent font-semibold text-brand focus:outline-none"
            >
              <option value="24h">Jornada Activa (Últimas 24h)</option>
              <option value="48h">Últimas 48 horas</option>
              <option value="7d">Últimos 7 días</option>
              <option value="all">Todo el Histórico</option>
            </select>
          </div>

          {/* Filtro por estado */}
          <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs">
            <Filter className="h-3.5 w-3.5 text-text-3" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent font-medium focus:outline-none"
            >
              <option value="all">Todos los estados</option>
              <option value="pending">Pendientes</option>
              <option value="processing">En Proceso</option>
              <option value="pending_shipment">Pendiente Envío</option>
              <option value="shipped">Enviados</option>
              <option value="delivered">Entregados</option>
              <option value="paused">En Pausa</option>
              <option value="cancelled">Cancelados</option>
            </select>
          </div>

          <input
            type="text"
            placeholder="Buscar #pedido, cliente..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="h-8 w-56 rounded-md border border-input bg-background px-3 text-xs focus:border-brand focus:outline-none"
          />
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Actualizar
          </Button>
        </div>
      </header>

      {/* Tarjetas de Métricas (Primer Vistazo) */}
      <section className="grid grid-cols-2 gap-4 border-b bg-subtle/30 px-6 py-3.5 md:grid-cols-4">
        <div className="flex items-center gap-3 rounded-lg border bg-background p-3 shadow-2xs">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-600">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-text-3">Pedidos Pendientes</p>
            <p className="text-base font-bold text-foreground">{pendingCount}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-background p-3 shadow-2xs">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/10 text-blue-600">
            <Truck className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-text-3">En Proceso / Envío</p>
            <p className="text-base font-bold text-foreground">{processingCount}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-background p-3 shadow-2xs">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600">
            <DollarSign className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-text-3">Total Ventas Entregadas</p>
            <p className="text-base font-bold text-foreground">{formatCurrency(totalSales)}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-background p-3 shadow-2xs">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand/10 text-brand">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-text-3">Ticket Promedio</p>
            <p className="text-base font-bold text-foreground">{formatCurrency(avgTicket)}</p>
          </div>
        </div>
      </section>

      {/* Tablero Kanban de Cola de Pedidos */}
      <div className="flex-1 overflow-x-auto p-6">
        {orders === null ? (
          <div className="flex h-64 items-center justify-center text-sm text-text-3">
            Cargando cola de pedidos…
          </div>
        ) : (
          <div className="flex h-full min-w-[1400px] gap-3.5">
            {COLUMNS.filter((col) => {
              if (statusFilter === "all") return true;
              if (statusFilter === "pending") return col.id === "pending";
              if (statusFilter === "delivered") return col.id === "delivered";
              return col.id === statusFilter;
            }).map((col) => {
              const colOrders = filtered.filter((o) => {
                if (col.id === "pending") return o.status === "pending" || o.status === "confirmed";
                if (col.id === "delivered") return o.status === "delivered" || o.status === "completed";
                return o.status === col.id;
              });

              return (
                <div
                  key={col.id}
                  className="flex flex-1 flex-col rounded-xl border bg-subtle/40 p-3 shadow-xs"
                >
                  <div className="mb-3 flex items-center justify-between px-1">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-text-2">
                      {col.label}
                    </h3>
                    <span
                      className={cn(
                        "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold",
                        col.badgeBg
                      )}
                    >
                      {colOrders.length}
                    </span>
                  </div>

                  <div className="flex-1 space-y-3 overflow-y-auto pr-0.5">
                    {colOrders.length === 0 ? (
                      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-xs text-text-4">
                        Sin pedidos
                      </div>
                    ) : (
                      colOrders.map((order) => (
                        <div
                          key={order.id}
                          className="group relative rounded-lg border bg-background p-4 shadow-sm transition-all hover:shadow-md"
                        >
                          {/* Encabezado pedido */}
                          <div className="flex items-center justify-between border-b pb-2.5">
                            <span className="font-mono text-xs font-bold text-brand">
                              #{order.orderNumber}
                            </span>
                            <div className="flex items-center gap-2">
                              {/* Badge Estado de Pago */}
                              <button
                                onClick={() => void togglePaid(order.id, !order.isPaid)}
                                title="Hacer clic para alternar estado de pago"
                                className={cn(
                                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
                                  order.isPaid
                                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25"
                                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25"
                                )}
                              >
                                <CreditCard className="h-3 w-3" />
                                {order.isPaid ? "PAGADO" : "NO PAGADO"}
                              </button>
                              <span className="flex items-center gap-1 text-[11px] text-text-4">
                                <Clock className="h-3 w-3" />
                                {timeAgo(order.createdAt)}
                              </span>
                            </div>
                          </div>

                          {/* Cliente */}
                          <div className="my-3 flex items-center gap-2.5">
                            <ContactAvatar
                              name={order.contact.name}
                              seed={order.contact.id}
                              size="sm"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold">
                                {order.contact.name}
                              </p>
                              <p className="text-[10.5px] text-text-3">
                                Telegram: {order.contact.externalAddress}
                              </p>
                            </div>
                          </div>

                          {/* Productos */}
                          <div className="my-2.5 space-y-1 rounded-md bg-secondary/50 p-2.5 text-xs">
                            {order.items.map((item, idx) => (
                              <div key={idx} className="flex justify-between gap-2">
                                <span className="truncate text-text-2">
                                  {item.quantity}x {item.name}{" "}
                                  {item.presentation ? `(${item.presentation})` : ""}
                                </span>
                                <span className="font-medium text-foreground">
                                  {formatCurrency(item.unitPrice * item.quantity)}
                                </span>
                              </div>
                            ))}
                            <div className="mt-2 flex justify-between border-t pt-1.5 font-bold">
                              <span>Total</span>
                              <span className="text-brand">
                                {formatCurrency(order.totalAmount)}
                              </span>
                            </div>
                          </div>

                          {/* Acciones */}
                          <div className="mt-3 flex flex-col gap-2 pt-1">
                            <div className="flex flex-wrap gap-1.5">
                              {(order.status === "pending" || order.status === "confirmed") && (
                                <>
                                  <Button
                                    size="xs"
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                                    disabled={updatingId === order.id}
                                    onClick={() => void updateStatus(order.id, "processing")}
                                  >
                                    <Play className="mr-1 h-3 w-3" /> Procesar
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    disabled={updatingId === order.id}
                                    onClick={() => void updateStatus(order.id, "paused")}
                                  >
                                    <PauseCircle className="mr-1 h-3 w-3" /> Pausar
                                  </Button>
                                </>
                              )}

                              {order.status === "processing" && (
                                <>
                                  <Button
                                    size="xs"
                                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                                    disabled={updatingId === order.id}
                                    onClick={() => void updateStatus(order.id, "pending_shipment")}
                                  >
                                    <PackageCheck className="mr-1 h-3 w-3" /> Empacado
                                  </Button>
                                  <Button
                                    size="xs"
                                    className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white"
                                    disabled={updatingId === order.id}
                                    onClick={() => void updateStatus(order.id, "shipped")}
                                  >
                                    <Truck className="mr-1 h-3 w-3" /> Enviar
                                  </Button>
                                </>
                              )}

                              {order.status === "pending_shipment" && (
                                <>
                                  <Button
                                    size="xs"
                                    className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white"
                                    disabled={updatingId === order.id}
                                    onClick={() => void updateStatus(order.id, "shipped")}
                                  >
                                    <Truck className="mr-1 h-3 w-3" /> Marcar Enviado
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    disabled={updatingId === order.id}
                                    onClick={() => void updateStatus(order.id, "paused")}
                                  >
                                    <PauseCircle className="mr-1 h-3 w-3" /> Pausar
                                  </Button>
                                </>
                              )}

                              {order.status === "shipped" && (
                                <>
                                  <Button
                                    size="xs"
                                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                                    disabled={updatingId === order.id}
                                    onClick={() => void updateStatus(order.id, "delivered")}
                                  >
                                    <CheckCircle2 className="mr-1 h-3 w-3" /> Marcar Entregado
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    disabled={updatingId === order.id}
                                    onClick={() => void updateStatus(order.id, "paused")}
                                  >
                                    <PauseCircle className="mr-1 h-3 w-3" /> Pausar
                                  </Button>
                                </>
                              )}

                              {order.status === "paused" && (
                                <>
                                  <Button
                                    size="xs"
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                                    disabled={updatingId === order.id}
                                    onClick={() => void updateStatus(order.id, "processing")}
                                  >
                                    <Play className="mr-1 h-3 w-3" /> Reanudar
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    className="text-rose-600 border-rose-200 hover:bg-rose-50"
                                    disabled={updatingId === order.id}
                                    onClick={() => void updateStatus(order.id, "cancelled")}
                                  >
                                    <XCircle className="mr-1 h-3 w-3" /> Cancelar
                                  </Button>
                                </>
                              )}

                              {(order.status === "delivered" || order.status === "completed" || order.status === "cancelled") && (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  className="w-full"
                                  disabled={updatingId === order.id}
                                  onClick={() => void updateStatus(order.id, "processing")}
                                >
                                  <RotateCcw className="mr-1 h-3 w-3" /> Reabrir pedido
                                </Button>
                              )}
                            </div>

                            {/* Enlace directo a la bandeja */}
                            <Link
                              href={`/inbox?contact=${order.contact.id}`}
                              className="flex items-center justify-center gap-1.5 rounded-md border border-brand/20 bg-brand-tint/60 py-1 text-xs font-medium text-brand-text hover:bg-brand-tint transition-colors"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              Contactar en Bandeja
                            </Link>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
