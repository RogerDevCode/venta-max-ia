import { beforeEach, describe, expect, it, vi } from "vitest";

const pendingWork: Promise<unknown>[] = [];
const processTelegramUpdate = vi.fn().mockResolvedValue(undefined);
const findIntegration = vi.fn();
const registerReceipt = vi.fn();

vi.mock("next/server", () => ({
  after: (work: () => unknown) => {
    pendingWork.push(Promise.resolve(work()));
  },
}));

vi.mock("@/server/inbox/telegram-webhook", () => ({
  processTelegramUpdate: (...args: unknown[]) => processTelegramUpdate(...args),
}));

vi.mock("@/server/telegram/integrations", () => ({
  findTelegramIntegrationByWebhookToken: (...args: unknown[]) => findIntegration(...args),
  registerTelegramWebhookReceipt: (...args: unknown[]) => registerReceipt(...args),
}));

import { POST } from "@/app/api/webhooks/telegram/[webhookToken]/route";

const params = { params: Promise.resolve({ webhookToken: "ruta-opaca" }) };
const validUpdate = {
  update_id: 42,
  message: {
    message_id: 7,
    from: { id: 99, is_bot: false, first_name: "Ana" },
    chat: { id: 99, type: "private" },
    date: 1_780_000_000,
    text: "Hola",
  },
};

describe("POST webhook Telegram", () => {
  beforeEach(() => {
    pendingWork.length = 0;
    processTelegramUpdate.mockClear();
    findIntegration.mockReset();
    registerReceipt.mockReset();
  });

  it("devuelve 404 para un token sin integración persistida", async () => {
    findIntegration.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/webhooks/telegram/ruta-opaca", {
        method: "POST",
        body: JSON.stringify(validUpdate),
      }),
      params
    );

    expect(response.status).toBe(404);
    expect(registerReceipt).not.toHaveBeenCalled();
    expect(processTelegramUpdate).not.toHaveBeenCalled();
  });

  it("ACK un payload inválido sin enviarlo a la ingesta", async () => {
    findIntegration.mockResolvedValue({ id: "tgi_1", organizationId: "org_1" });

    const response = await POST(
      new Request("http://localhost/api/webhooks/telegram/ruta-opaca", {
        method: "POST",
        body: "{",
      }),
      params
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(registerReceipt).not.toHaveBeenCalled();
    expect(processTelegramUpdate).not.toHaveBeenCalled();
  });

  it("persiste el receipt y procesa solo un update nuevo para la organización de la integración", async () => {
    findIntegration.mockResolvedValue({ id: "tgi_1", organizationId: "org_1" });
    registerReceipt.mockResolvedValue("received");

    const response = await POST(
      new Request("http://localhost/api/webhooks/telegram/ruta-opaca?orgId=org_atacante", {
        method: "POST",
        body: JSON.stringify(validUpdate),
      }),
      params
    );
    await Promise.all(pendingWork);

    expect(response.status).toBe(200);
    expect(registerReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        integrationId: "tgi_1",
        updateId: 42,
      })
    );
    expect(processTelegramUpdate).toHaveBeenCalledWith({
      organizationId: "org_1",
      update: validUpdate,
    });
  });

  it.each(["duplicate", "conflict"] as const)("ACK %s sin reprocesar el update", async (result) => {
    findIntegration.mockResolvedValue({ id: "tgi_1", organizationId: "org_1" });
    registerReceipt.mockResolvedValue(result);

    const response = await POST(
      new Request("http://localhost/api/webhooks/telegram/ruta-opaca", {
        method: "POST",
        body: JSON.stringify(validUpdate),
      }),
      params
    );
    await Promise.all(pendingWork);

    expect(response.status).toBe(200);
    expect(processTelegramUpdate).not.toHaveBeenCalled();
  });
});
