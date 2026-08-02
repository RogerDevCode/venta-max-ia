# Guardas conversacionales de Botillería STAX Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interceptar respetuosamente garabatos, consultas fuera del negocio y productos inexistentes antes del LLM, sin alterar pedidos ni inventar información.

**Architecture:** Un módulo puro clasifica el texto entrante tras normalizar acentos, mayúsculas y separadores. `runAgentTurn` invoca el guard después de los comandos transaccionales y antes del LLM; una decisión bloqueante persiste una respuesta fija y un contador consecutivo en el estado de la conversación. Catálogo, FAQ y precios continúan consultándose desde PostgreSQL tenant-scoped.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM, PostgreSQL/pgvector.

## Global Constraints

- No enviar el texto bloqueado al LLM.
- No modificar carrito, pedido, lead ni stock cuando se active una guarda.
- Nunca inventar productos, precios, stock, promociones, delivery o condiciones.
- Aislar cada consulta por `organizationId`.
- Una consulta ajena al negocio recibe redirección, no una respuesta externa.

---

### Task 1: Clasificador puro de seguridad conversacional

**Files:**
- Create: `src/server/ai/conversation-guard.ts`
- Create: `tests/unit/conversation-guard.test.ts`

**Interfaces:**
- Produces: `classifyConversationInput(text): "offensive" | "out_of_scope" | null`.
- Produces: `guardReply(kind, strikes): string`.
- Consumes: texto de cliente sin datos de organización.

- [ ] **Step 1: Write failing unit tests**

```ts
expect(classifyConversationInput("eres un weón")).toBe("offensive");
expect(classifyConversationInput("W-E-O-N" )).toBe("offensive");
expect(classifyConversationInput("¿Quién ganó el partido?")).toBe("out_of_scope");
expect(classifyConversationInput("¿cuánto cuesta una Cristal lata?")).toBeNull();
expect(guardReply("offensive", 2)).toContain("atención humana");
```

- [ ] **Step 2: Verify red**

Run: `pnpm vitest run tests/unit/conversation-guard.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal classifier**

```ts
const OFFENSIVE_TERMS = ["weon", "huevon", "culiao", "culia", "maricon", "puta", "mierda"];
const IN_SCOPE = /catalogo|producto|pedido|carrito|delivery|despacho|retiro|pago|horario|comuna|stock|cerveza|vino|pisco|bebida|snack|hielo|humano|mayor de edad/;

export function classifyConversationInput(text: string) {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (OFFENSIVE_TERMS.some((term) => normalized.includes(term))) return "offensive";
  if (/\?|quien|que es|capital|partido|receta|programa|codigo/.test(normalized) && !IN_SCOPE.test(normalized)) return "out_of_scope";
  return null;
}
```

Keep normal business greetings and ambiguous short messages unblocked; only reject clear external questions.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm vitest run tests/unit/conversation-guard.test.ts && pnpm typecheck`

Expected: PASS.

```bash
git add src/server/ai/conversation-guard.ts tests/unit/conversation-guard.test.ts
git commit -m "feat: clasificar entradas fuera de alcance"
```

### Task 2: Aplicar la guarda antes del LLM

**Files:**
- Modify: `src/server/ai/pipeline.ts`
- Test: `tests/unit/conversation-guard.test.ts`

**Interfaces:**
- Consumes: `classifyConversationInput`, `guardReply`.
- Produces: estado `guard_offensive_strikes` dentro de `conversation.stateMetadata`.
- Uses existing `deliverReply(conversation, text)` to persist or send the fixed reply.

- [ ] **Step 1: Write failing pipeline tests**

```ts
it("responde al garabato sin invocar chatJson ni modificar el carrito", async () => {
  await runAgentTurn(conversationIdWithText("eres un weón"));
  expect(mockChatJson).not.toHaveBeenCalled();
  expect(mockReply).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("Conversemos con respeto"));
});
```

- [ ] **Step 2: Insert guard after commands and before `isAiConfigured()`**

```ts
const guard = lastInbound.text ? classifyConversationInput(lastInbound.text) : null;
if (guard) {
  const strikes = guard === "offensive" ? previousStrikes + 1 : 0;
  await persistGuardState(conversation, strikes);
  await deliverReply(conversation, guardReply(guard, strikes));
  return;
}
await persistGuardState(conversation, 0);
```

Do not run the guard while a validated menu callback, slash command or pending quantity is being handled; their existing paths already return first.

- [ ] **Step 3: Verify state and escalation behavior**

Run: `pnpm vitest run tests/unit/conversation-guard.test.ts`

Expected: PASS for first strike, second strike, valid-message reset and no LLM call.

- [ ] **Step 4: Commit**

```bash
git add src/server/ai/pipeline.ts tests/unit/conversation-guard.test.ts
git commit -m "feat: bloquear lenguaje ofensivo antes del agente"
```

### Task 3: Endurecer fuente de verdad y regresión

**Files:**
- Modify: `src/server/ai/prompts.ts`
- Modify: `tests/unit/ai-adapter.test.ts`
- Modify: `tests/unit/conversation-guard.test.ts`

**Interfaces:**
- Prompt declares catálogo PostgreSQL, FAQ pgvector y estado de pedido como únicas fuentes de verdad.
- A búsqueda de producto sin resultado se responde con catálogo disponible, sin precio o sustituto inventado.

- [ ] **Step 1: Add prompt assertions**

```ts
expect(prompt).toContain("No inventes productos, precios, stock, promociones ni condiciones");
expect(prompt).toContain("Sólo responde sobre esta Botillería");
```

- [ ] **Step 2: Add strict source-of-truth rules**

```ts
"- Productos, precios, stock y promociones existen únicamente si la consulta tenant-scoped a PostgreSQL los devuelve.",
"- Fuera de catálogo, FAQ recuperadas por pgvector, pedido o atención de esta Botillería: redirige; no respondas el tema externo.",
```

- [ ] **Step 3: Run complete regression**

Run: `pnpm test && pnpm typecheck && pnpm build && docker compose build --quiet app`

Expected: all tests, types, build and image PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/ai/prompts.ts tests/unit/ai-adapter.test.ts tests/unit/conversation-guard.test.ts
git commit -m "test: reforzar fuente de verdad conversacional"
```
