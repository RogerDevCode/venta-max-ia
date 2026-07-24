import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FR-031 / FR-082: una conversación de prueba del Laboratorio JAMÁS alcanza
 * la API de Telegram — sendText lanza antes de cualquier request externo.
 */

const externalRequest = vi.fn();

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

const selectRows: unknown[][] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => makeChain(selectRows.shift() ?? []),
  }),
  schema: {
    conversation: { contactId: "contactId", id: "id" },
    contact: { id: "id" },
    message: {},
  },
}));

describe("sandbox del Laboratorio en el sender", () => {
  beforeEach(() => {
    externalRequest.mockReset();
    vi.stubGlobal("fetch", externalRequest);
    selectRows.length = 0;
  });

  it("conversación is_test → lanza sandbox_violation y NO llama a Graph", async () => {
    selectRows.push([
      {
        conversation: {
          id: "cv_test",
          organizationId: "org_1",
          isTest: true,
          lastInboundAt: new Date(),
        },
        contact: { id: "ct_1", channel: "test", externalAddress: "5215511111111" },
      },
    ]);
    const { sendText, SendError } = await import("@/server/inbox/send");

    await expect(
      sendText({
        conversationId: "cv_test",
        organizationId: "org_1",
        text: "hola",
      })
    ).rejects.toMatchObject({ code: "sandbox_violation" });

    expect(externalRequest).not.toHaveBeenCalled();

    // sanity: el error es del tipo tipado
    try {
      selectRows.push([
        {
          conversation: {
            id: "cv_test",
            organizationId: "org_1",
            isTest: true,
            lastInboundAt: new Date(),
          },
          contact: { id: "ct_1", channel: "test", externalAddress: "5215511111111" },
        },
      ]);
      await sendText({
        conversationId: "cv_test",
        organizationId: "org_1",
        text: "hola",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(SendError);
    }
    expect(externalRequest).not.toHaveBeenCalled();
  });
});
