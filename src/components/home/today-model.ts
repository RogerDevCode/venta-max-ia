export interface OperatorToday {
  unreadConversations: number;
  pendingOrders: number;
  telegramStatus: "connected" | "reconnect_required" | "unconfigured";
}

export function todayActions(today: OperatorToday) {
  return [
    {
      href: "/inbox",
      count: today.unreadConversations,
      label: "conversaciones sin leer",
      action:
        today.unreadConversations > 0 ? "Abrir bandeja" : "Revisar bandeja",
    },
    {
      href: "/orders",
      count: today.pendingOrders,
      label: "pedidos que requieren revisión",
      action: today.pendingOrders > 0 ? "Revisar pedidos" : "Ver pedidos",
    },
  ];
}
