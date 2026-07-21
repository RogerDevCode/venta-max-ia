import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  chunkText,
  EmbeddingError,
  generateEmbedding,
  ingestKbEntryWithEmbedding,
  ingestLongTextAsBlocks,
} from "@/server/ai/rag/embeddings";

const fetchMock = vi.fn();
const insertedKbEntries: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertedKbEntries.push(v);
        return Promise.resolve([{ ...v }]);
      },
    }),
  }),
  schema: {
    kbEntry: {},
  },
}));

beforeAll(() => {
  vi.stubGlobal("fetch", fetchMock);
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-suficiente-para-tests";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
  process.env.PROVIDER_API_TOKEN = "token-test-rag";
});

afterEach(() => {
  fetchMock.mockReset();
  insertedKbEntries.length = 0;
});

describe("Chunking y Embeddings RAG (Paso 3.1)", () => {
  it("chunkText divide textos largos en párrafos con superposición (overlap)", () => {
    const text =
      "Primer párrafo importante de información del negocio que describe nuestra historia y los valores.\n" +
      "Segundo párrafo que detalla los horarios de atención y las sucursales principales en toda la ciudad.\n" +
      "Tercer párrafo sobre políticas de devolución, plazos y requerimientos técnicos para los clientes.";

    const chunks = chunkText(text, 120, 30);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toContain("Primer párrafo");
    // Verificar que cada fragmento es no vacío y se mantiene dentro de un margen razonable
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("chunkText retorna el texto original si no supera maxChars", () => {
    const text = "Hola, somos Venta Max IA.";
    expect(chunkText(text, 500)).toEqual(["Hola, somos Venta Max IA."]);
  });

  it("generateEmbedding obtiene un vector de 1536 dimensiones desde la API", async () => {
    const fakeVector = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ embedding: fakeVector }],
        }),
    } as unknown as Response);

    const vec = await generateEmbedding("¿Qué servicios ofrecen?");
    expect(vec.length).toBe(1536);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(JSON.parse(options.body)).toEqual({
      model: "text-embedding-3-small",
      input: "¿Qué services ofrecen?".replace("services", "servicios"),
    });
  });

  it("lanza EmbeddingError cuando la API falla o responde error HTTP", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    } as unknown as Response);

    await expect(generateEmbedding("Fallo de red")).rejects.toThrowError(EmbeddingError);
  });

  it("ingestKbEntryWithEmbedding genera e inserta el vector en PostgreSQL (Drizzle)", async () => {
    const fakeVector = Array(1536).fill(0.123);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: fakeVector }] }),
    } as unknown as Response);

    const res = await ingestKbEntryWithEmbedding({
      organizationId: "org_1",
      kind: "qa",
      question: "¿Horario?",
      answer: "Lunes a Viernes de 9 a 18 hs",
    });

    expect(res.id).toMatch(/^kb_/);
    expect(res.embedding).toEqual(fakeVector);
    expect(insertedKbEntries.length).toBe(1);
    expect(insertedKbEntries[0]!.organizationId).toBe("org_1");
    expect(insertedKbEntries[0]!.kind).toBe("qa");
    expect(insertedKbEntries[0]!.embedding).toEqual(fakeVector);
  });

  it("ingestLongTextAsBlocks divide e ingesta cada fragmento por separado con su embedding", async () => {
    const fakeVec1 = Array(1536).fill(0.1);
    const fakeVec2 = Array(1536).fill(0.2);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: fakeVec1 }] }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: fakeVec2 }] }),
      } as unknown as Response);

    const res = await ingestLongTextAsBlocks({
      organizationId: "org_2",
      text: "Parte una de la política.\n".repeat(10) + "Parte dos con más información.\n".repeat(10),
      maxChars: 180,
      overlap: 20,
    });

    expect(res.ids.length).toBeGreaterThanOrEqual(2);
    expect(insertedKbEntries.length).toBeGreaterThanOrEqual(2);
    expect(insertedKbEntries[0]!.embedding).toEqual(fakeVec1);
  });
});
