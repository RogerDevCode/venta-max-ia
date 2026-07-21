import { beforeAll, describe, expect, it } from "vitest";
import {
  parseTelegramUpdate,
  isTelegramWebhookBodyWithinLimit,
  MAX_TELEGRAM_WEBHOOK_BODY_BYTES,
} from "@/server/inbox/telegram-update";
import {
  hashTelegramWebhookToken,
  createTelegramWebhookToken,
} from "@/server/telegram/integrations";

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-test";
});

describe("Red Team: Seguridad, Límite de Payload, Inyección y Aislamiento Multi-Tenant", () => {
  describe("1. Protección contra Bomba de Payload y Agotamiento de Memoria (Denial of Service)", () => {
    it("debe rechazar cargas útiles que excedan exactamente MAX_TELEGRAM_WEBHOOK_BODY_BYTES (256 KiB)", () => {
      const exactValid = "a".repeat(MAX_TELEGRAM_WEBHOOK_BODY_BYTES);
      const exactInvalid = "a".repeat(MAX_TELEGRAM_WEBHOOK_BODY_BYTES + 1);

      expect(isTelegramWebhookBodyWithinLimit(exactValid)).toBe(true);
      expect(isTelegramWebhookBodyWithinLimit(exactInvalid)).toBe(false);
    });

    it("debe rechazar cargas con caracteres multibyte (UTF-8) que superen 256 KiB en bytes aunque el string sea corto", () => {
      // Un emoji 🚀 ocupa 4 bytes en UTF-8. 65,537 emojis ocupan 262,148 bytes (> 256 KiB)
      const emojiBomb = "🚀".repeat(65537);
      expect(emojiBomb.length).toBeLessThan(MAX_TELEGRAM_WEBHOOK_BODY_BYTES); // En JS .length cuenta code units
      expect(isTelegramWebhookBodyWithinLimit(emojiBomb)).toBe(false); // Pero en bytes supera el límite
    });

    it("debe manejar JSON extremadamente anidado y malformado sin lanzar excepciones no controladas ni agotar la memoria", () => {
      // JSON profundamente anidado (1,000 niveles) o roto
      const deepOpening = '{"update_id": 1, "message": {"chat": {"id": 1, "type": "private"}, "date": 123, "message_id": 1, "text": "foo", "meta": ' + '{"nested": '.repeat(500);
      const deepClosing = '""' + '}'.repeat(500) + '}}';
      const payloadBomb = deepOpening + deepClosing;

      const result = parseTelegramUpdate(payloadBomb);
      // Debe retornar ok: true o ok: false pacíficamente sin lanzar RangeError o exceder call stack
      expect(typeof result.ok).toBe("boolean");
    });
  });

  describe("2. Prototype Pollution & Inyección de Estructuras (Zod Passthrough Defense)", () => {
    it("debe ignorar e invalidar intentos de Prototype Pollution vía __proto__ o constructor en mensajes Telegram", () => {
      const maliciousPayload = JSON.stringify({
        update_id: 666,
        __proto__: { isAdmin: true, organizationId: "GLOBAL_SYSTEM_TENANT" },
        constructor: { prototype: { bypassed: true } },
        message: {
          message_id: 1,
          chat: { id: 12345, type: "private" },
          date: 1690000000,
          text: "Hola <script>alert(1)</script> ' OR 1=1 --",
          __proto__: { polluted: "yes" },
        },
      });

      const parsed = parseTelegramUpdate(maliciousPayload);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        // Verificamos que no haya contaminado Object.prototype ni los objetos nativos
        expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(({} as Record<string, unknown>).bypassed).toBeUndefined();
        // Además, el texto malicioso se conserva para ser sanitizado por capas posteriores, pero el parseo Zod no falla ni inyecta propiedades prototipo
        expect(parsed.data.message?.text).toContain("' OR 1=1 --");
      }
    });

    it("debe rechazar updates que no contengan ni message ni callback_query (ej. updates de bot status malintencionados)", () => {
      const ghostPayload = JSON.stringify({
        update_id: 999,
        my_chat_member: {
          chat: { id: 123, type: "private" },
          from: { id: 456, is_bot: false, first_name: "Attacker" },
          new_chat_member: { status: "kicked" },
        },
      });

      const parsed = parseTelegramUpdate(ghostPayload);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.reason).toBe("invalid_update");
      }
    });
  });

  describe("3. Criptografía, Tokens y Aislamiento Criptográfico (`crypto.ts` & `integrations.ts`)", () => {
    it("generateTelegramWebhookToken debe generar tokens opacos criptográficamente únicos y sin colisiones en 1,000 iteraciones", () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        const token = createTelegramWebhookToken();
        expect(token.length).toBeGreaterThanOrEqual(40);
        tokens.add(token);
      }
      expect(tokens.size).toBe(1000); // 0 colisiones
    });

    it("hashTelegramWebhookToken debe ser determinista, irreversible (SHA-256 hex) y resistente a extensiones o padding", () => {
      const token = "super_secret_telegram_token_12345";
      const hash1 = hashTelegramWebhookToken(token);
      const hash2 = hashTelegramWebhookToken(token);
      const hashTampered = hashTelegramWebhookToken(token + " ");

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hashTampered);
      expect(hash1.length).toBe(64); // SHA-256 genera 64 caracteres en hex
      expect(hash1).not.toContain(token);
    });

    it("decryptSecret (AES-256-GCM) debe fallar de inmediato si la etiqueta de autenticación (Auth Tag) o el texto cifrado es manipulado", async () => {
      const { encryptSecret, decryptSecret } = await import("@/lib/crypto");
      const secret = "whatsapp_waba_secret_token_abcdef123456";
      const encrypted = encryptSecret(secret);

      // Manipulamos 1 byte del Auth Tag (GCM Tag)
      const tamperedTag = Buffer.alloc(16, 1).toString("base64");
      const tampered = {
        ...encrypted,
        tag: tamperedTag,
      };

      expect(() => decryptSecret(tampered)).toThrow();
    });

    it("decryptSecret no debe ser vulnerable a ataques de truncamiento o iv/tag inválidos", async () => {
      const { decryptSecret } = await import("@/lib/crypto");
      expect(() => decryptSecret({ iv: "", tag: "", cipher: "" })).toThrow();
      expect(() => decryptSecret({ iv: "invalid_iv", tag: "invalid_tag", cipher: "invalid_cipher" })).toThrow();
    });
  });
});
