"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart2,
  Bot,
  MessageSquare,
  Package,
  RefreshCw,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Range = "7d" | "30d" | "90d";

type AnalyticsData = {
  range: string;
  since: string;
  kpis: {
    totalOrders: number;
    revenue: number;
    cancelledOrders: number;
    deliveredOrders: number;
    pendingOrders: number;
    newContacts: number;
    totalConversations: number;
    handoffs: number;
    totalMessages: number;
    inboundMessages: number;
    outboundMessages: number;
    cartTotal: number;
    cartConverted: number;
    cartAbandoned: number;
    conversionRate: number;
  };
  revenueByDay: { day: string; revenue: number; orders: number }[];
  topProducts: { name: string; qty: number; revenue: number }[];
  ordersByStatus: { status: string; count: number }[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCLP(n: number): string {
  return `$${n.toLocaleString("es-CL")} CLP`;
}

function formatNum(n: number): string {
  return n.toLocaleString("es-CL");
}

const RANGE_LABELS: Record<Range, string> = {
  "7d": "7 días",
  "30d": "30 días",
  "90d": "90 días",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  processing: "En proceso",
  pending_shipment: "Por despachar",
  shipped: "Despachado",
  delivered: "Entregado",
  paused: "Pausado",
  completed: "Completado",
  cancelled: "Cancelado",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b",
  confirmed: "#3b82f6",
  processing: "#8b5cf6",
  pending_shipment: "#06b6d4",
  shipped: "#10b981",
  delivered: "#22c55e",
  paused: "#94a3b8",
  completed: "#16a34a",
  cancelled: "#ef4444",
};

// ─── Spark Bar Chart (SVG inline) ─────────────────────────────────────────────

function SparkBars({
  data,
  color = "var(--accent)",
  valueKey,
}: {
  data: { day: string; revenue: number; orders: number }[];
  color?: string;
  valueKey: "revenue" | "orders";
}) {
  const max = Math.max(...data.map((d) => d[valueKey]), 1);
  const W = 280;
  const H = 64;
  const barW = Math.max(2, (W / Math.max(data.length, 1)) - 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16 mt-2" aria-hidden>
      {data.map((d, i) => {
        const h = Math.max(2, (d[valueKey] / max) * H);
        const x = (W / data.length) * i;
        return (
          <rect
            key={d.day}
            x={x + 1}
            y={H - h}
            width={barW}
            height={h}
            rx={2}
            fill={color}
            opacity={0.75}
          />
        );
      })}
    </svg>
  );
}

// ─── Donut Chart ──────────────────────────────────────────────────────────────

function DonutChart({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-[var(--text-4)]">
        Sin datos
      </div>
    );
  }

  const R = 48;
  const CX = 60;
  const CY = 60;
  let cumAngle = -Math.PI / 2;

  const arcs = segments
    .filter((s) => s.value > 0)
    .map((seg) => {
      const angle = (seg.value / total) * 2 * Math.PI;
      const x1 = CX + R * Math.cos(cumAngle);
      const y1 = CY + R * Math.sin(cumAngle);
      cumAngle += angle;
      const x2 = CX + R * Math.cos(cumAngle);
      const y2 = CY + R * Math.sin(cumAngle);
      const large = angle > Math.PI ? 1 : 0;
      return { ...seg, x1, y1, x2, y2, large, angle };
    });

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" className="w-28 h-28 shrink-0" aria-hidden>
        {arcs.map((arc, i) => (
          <path
            key={i}
            d={`M ${CX} ${CY} L ${arc.x1} ${arc.y1} A ${R} ${R} 0 ${arc.large} 1 ${arc.x2} ${arc.y2} Z`}
            fill={arc.color}
            opacity={0.85}
          />
        ))}
        <circle cx={CX} cy={CY} r={28} fill="var(--bg-panel)" />
        <text
          x={CX}
          y={CY + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="11"
          fill="var(--text)"
          fontWeight="600"
        >
          {formatNum(total)}
        </text>
      </svg>
      <div className="flex flex-col gap-1 min-w-0">
        {segments
          .filter((s) => s.value > 0)
          .slice(0, 5)
          .map((seg) => (
            <div key={seg.label} className="flex items-center gap-1.5 text-xs">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: seg.color }}
              />
              <span className="truncate text-[var(--text-3)]">{seg.label}</span>
              <span className="ml-auto font-semibold text-[var(--text)]">
                {formatNum(seg.value)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = false,
  good,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  good?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-4 flex flex-col gap-2 shadow-sm",
        accent && "border-[var(--accent)]/40 bg-[var(--accent-tint)]"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-3)] uppercase tracking-wide">
          {label}
        </span>
        <Icon
          className={cn(
            "h-4 w-4",
            accent ? "text-[var(--accent)]" : "text-[var(--text-4)]"
          )}
          strokeWidth={1.7}
        />
      </div>
      <span
        className={cn(
          "text-2xl font-bold tracking-tight",
          accent ? "text-[var(--accent-text)]" : "text-[var(--text)]"
        )}
      >
        {value}
      </span>
      {sub && (
        <span
          className={cn(
            "text-xs flex items-center gap-1",
            good === true
              ? "text-[var(--success)]"
              : good === false
              ? "text-[var(--danger)]"
              : "text-[var(--text-4)]"
          )}
        >
          {good === true && <ArrowUp className="h-3 w-3" />}
          {good === false && <ArrowDown className="h-3 w-3" />}
          {sub}
        </span>
      )}
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-[var(--border)] overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.min(pct, 100)}%`, background: color }}
      />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AnalyticsClient() {
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (r: Range) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/analytics?range=${r}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const json = (await res.json()) as AnalyticsData;
        setData(json);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError("No se pudo cargar el dashboard.");
        }
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(range);
  }, [load, range]);

  const kpis = data?.kpis;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg)]">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-6 py-4">
        <div className="flex items-center gap-2.5">
          <BarChart2 className="h-5 w-5 text-[var(--accent)]" strokeWidth={1.7} />
          <h1 className="text-lg font-semibold tracking-tight">Analytics</h1>
          <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-text)] uppercase tracking-wide">
            Beta
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Range selector */}
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs font-medium">
            {(["7d", "30d", "90d"] as Range[]).map((r) => (
              <button
                key={r}
                id={`analytics-range-${r}`}
                onClick={() => setRange(r)}
                className={cn(
                  "px-3 py-1.5 transition-colors",
                  range === r
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-3)] hover:bg-[var(--bg-hover)]"
                )}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
          <button
            id="analytics-refresh"
            onClick={() => load(range)}
            disabled={loading}
            className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--text-3)] hover:bg-[var(--bg-hover)] disabled:opacity-50 transition-colors"
            title="Actualizar"
          >
            <RefreshCw
              className={cn("h-4 w-4", loading && "animate-spin")}
              strokeWidth={1.7}
            />
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error && (
          <div className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}

        {/* ── KPI Grid ─────────────────────────────────────────────────────── */}
        <section aria-label="Indicadores clave">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-4)]">
            Indicadores — {RANGE_LABELS[range]}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <KpiCard
              icon={TrendingUp}
              label="Revenue"
              value={loading ? "…" : formatCLP(kpis?.revenue ?? 0)}
              sub={kpis ? `${kpis.totalOrders} pedidos` : undefined}
              accent
            />
            <KpiCard
              icon={ShoppingBag}
              label="Pedidos"
              value={loading ? "…" : formatNum(kpis?.totalOrders ?? 0)}
              sub={kpis ? `${kpis.pendingOrders} activos` : undefined}
            />
            <KpiCard
              icon={ShoppingCart}
              label="Conversión"
              value={loading ? "…" : `${kpis?.conversionRate ?? 0}%`}
              sub={kpis ? `${kpis.cartConverted} de ${kpis.cartTotal} carritos` : undefined}
              good={kpis ? kpis.conversionRate >= 40 : undefined}
            />
            <KpiCard
              icon={UserPlus}
              label="Contactos nuevos"
              value={loading ? "…" : formatNum(kpis?.newContacts ?? 0)}
            />
            <KpiCard
              icon={Users}
              label="Conversaciones"
              value={loading ? "…" : formatNum(kpis?.totalConversations ?? 0)}
              sub={kpis ? `${kpis.handoffs} handoffs` : undefined}
            />
            <KpiCard
              icon={MessageSquare}
              label="Mensajes"
              value={loading ? "…" : formatNum(kpis?.totalMessages ?? 0)}
              sub={kpis ? `${kpis.inboundMessages} recibidos` : undefined}
            />
            <KpiCard
              icon={Bot}
              label="Bot respondió"
              value={loading ? "…" : formatNum(kpis?.outboundMessages ?? 0)}
              sub="mensajes enviados"
            />
            <KpiCard
              icon={Package}
              label="Entregados"
              value={loading ? "…" : formatNum(kpis?.deliveredOrders ?? 0)}
              good={kpis ? kpis.deliveredOrders > 0 : undefined}
            />
          </div>
        </section>

        {/* ── Revenue Chart + Donut ──────────────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Revenue por día */}
          <section
            className="lg:col-span-2 rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-5"
            aria-label="Revenue por día"
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold">Revenue por día</h2>
              <span className="text-xs text-[var(--text-4)]">
                {data?.revenueByDay.length ?? 0} días con datos
              </span>
            </div>
            {loading ? (
              <div className="h-16 mt-2 rounded bg-[var(--border)] animate-pulse" />
            ) : data && data.revenueByDay.length > 0 ? (
              <>
                <SparkBars
                  data={data.revenueByDay}
                  valueKey="revenue"
                  color="var(--accent)"
                />
                <div className="flex justify-between mt-1 text-xs text-[var(--text-4)]">
                  <span>{data.revenueByDay[0]?.day}</span>
                  <span>{data.revenueByDay[data.revenueByDay.length - 1]?.day}</span>
                </div>
              </>
            ) : (
              <p className="mt-6 text-center text-sm text-[var(--text-4)]">
                Sin datos en el período
              </p>
            )}

            <div className="mt-4 pt-4 border-t border-[var(--border)]">
              <h3 className="text-xs font-semibold mb-2 text-[var(--text-3)]">Pedidos por día</h3>
              {loading ? (
                <div className="h-16 rounded bg-[var(--border)] animate-pulse" />
              ) : data && data.revenueByDay.length > 0 ? (
                <SparkBars
                  data={data.revenueByDay}
                  valueKey="orders"
                  color="var(--success)"
                />
              ) : null}
            </div>
          </section>

          {/* Pedidos por estado */}
          <section
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-5"
            aria-label="Pedidos por estado"
          >
            <h2 className="text-sm font-semibold mb-3">Estado de pedidos</h2>
            {loading ? (
              <div className="h-28 rounded bg-[var(--border)] animate-pulse" />
            ) : (
              <DonutChart
                segments={(data?.ordersByStatus ?? []).map((s) => ({
                  label: STATUS_LABELS[s.status] ?? s.status,
                  value: s.count,
                  color: STATUS_COLORS[s.status] ?? "#94a3b8",
                }))}
              />
            )}
          </section>
        </div>

        {/* ── Top Productos + Conversión ───────────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Top 5 productos */}
          <section
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-5"
            aria-label="Top productos"
          >
            <h2 className="text-sm font-semibold mb-3">Top productos vendidos</h2>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-8 rounded bg-[var(--border)] animate-pulse" />
                ))}
              </div>
            ) : data?.topProducts.length ? (
              <div className="space-y-3">
                {data.topProducts.map((p, i) => {
                  const maxQty = data.topProducts[0]?.qty ?? 1;
                  const pct = Math.round((p.qty / maxQty) * 100);
                  const colors = [
                    "#3b82f6",
                    "#8b5cf6",
                    "#10b981",
                    "#f59e0b",
                    "#ef4444",
                  ];
                  return (
                    <div key={p.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-medium truncate">
                          <span
                            className="text-xs font-bold w-4 text-center shrink-0"
                            style={{ color: colors[i] }}
                          >
                            #{i + 1}
                          </span>
                          <span className="truncate text-[var(--text)]">{p.name}</span>
                        </span>
                        <span className="shrink-0 ml-2 text-[var(--text-3)]">
                          {formatNum(p.qty)} u · {formatCLP(p.revenue)}
                        </span>
                      </div>
                      <ProgressBar pct={pct} color={colors[i] ?? "#3b82f6"} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center text-sm text-[var(--text-4)] py-6">
                Sin datos
              </p>
            )}
          </section>

          {/* Embudo carrito → pedido */}
          <section
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-5"
            aria-label="Embudo de conversión"
          >
            <h2 className="text-sm font-semibold mb-3">Embudo de conversión</h2>
            {loading || !kpis ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 rounded bg-[var(--border)] animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Carritos creados */}
                <FunnelStep
                  label="Carritos creados"
                  value={kpis.cartTotal}
                  pct={100}
                  color="#3b82f6"
                  sub="100%"
                />
                {/* Carritos convertidos */}
                <FunnelStep
                  label="Carritos convertidos"
                  value={kpis.cartConverted}
                  pct={kpis.cartTotal > 0 ? (kpis.cartConverted / kpis.cartTotal) * 100 : 0}
                  color="#10b981"
                  sub={`${kpis.conversionRate}% conversión`}
                />
                {/* Abandonados */}
                <FunnelStep
                  label="Abandonados"
                  value={kpis.cartAbandoned}
                  pct={kpis.cartTotal > 0 ? (kpis.cartAbandoned / kpis.cartTotal) * 100 : 0}
                  color="#ef4444"
                  sub="abandono"
                />

                <div className="pt-3 border-t border-[var(--border)] grid grid-cols-2 gap-3 text-center">
                  <div className="rounded-lg bg-[var(--bg-hover)] p-3">
                    <div className="text-xs text-[var(--text-4)]">Handoff rate</div>
                    <div className="text-lg font-bold text-[var(--text)] mt-0.5">
                      {kpis.totalConversations > 0
                        ? `${Math.round((kpis.handoffs / kpis.totalConversations) * 100)}%`
                        : "—"}
                    </div>
                    <div className="text-xs text-[var(--text-4)]">
                      {kpis.handoffs} de {kpis.totalConversations}
                    </div>
                  </div>
                  <div className="rounded-lg bg-[var(--bg-hover)] p-3">
                    <div className="text-xs text-[var(--text-4)]">Mensajes/conv</div>
                    <div className="text-lg font-bold text-[var(--text)] mt-0.5">
                      {kpis.totalConversations > 0
                        ? (kpis.totalMessages / kpis.totalConversations).toFixed(1)
                        : "—"}
                    </div>
                    <div className="text-xs text-[var(--text-4)]">promedio</div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="text-center text-xs text-[var(--text-4)] pb-2">
          Datos en tiempo real · Período: {RANGE_LABELS[range]} · Actualizado ahora
        </footer>
      </div>
    </div>
  );
}

function FunnelStep({
  label,
  value,
  pct,
  color,
  sub,
}: {
  label: string;
  value: number;
  pct: number;
  color: string;
  sub: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-[var(--text)]">{label}</span>
        <div className="flex items-center gap-2 text-[var(--text-3)]">
          <span className="text-[10px]">{sub}</span>
          <span className="font-semibold">{formatNum(value)}</span>
        </div>
      </div>
      <ProgressBar pct={pct} color={color} />
    </div>
  );
}
