import { describe, expect, it } from "vitest";
import { todayActions } from "@/components/home/today-model";

describe("todayActions", () => {
  it("prioriza bandeja y pedidos sin inventar actividad", () => {
    expect(
      todayActions({
        unreadConversations: 2,
        pendingOrders: 1,
        telegramStatus: "connected",
      }),
    ).toEqual([
      expect.objectContaining({
        href: "/inbox",
        count: 2,
        action: "Abrir bandeja",
      }),
      expect.objectContaining({
        href: "/orders",
        count: 1,
        action: "Revisar pedidos",
      }),
    ]);
  });

  it("ofrece revisión aun cuando no existen pendientes", () => {
    expect(
      todayActions({
        unreadConversations: 0,
        pendingOrders: 0,
        telegramStatus: "unconfigured",
      })[0],
    ).toMatchObject({ action: "Revisar bandeja" });
  });
});
