import { execSync } from "child_process";
import "./enforce-ipv4";

const WEBHOOK_URL = "http://127.0.0.1:7080/api/webhooks/telegram/O657BkPClI3AJe_5oc7OUIOwYf7I7A1yGUm2vibgCZM";
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "test-secret";
const TEST_USER_ID = 5391760292;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function dbQuery(query: string) {
  try {
    const safeQuery = query.replace(/"/g, '\\"');
    const out = execSync(`docker compose exec -T postgres psql -U postgres -d vocero -t -c "${safeQuery}"`);
    return out.toString().trim();
  } catch (err) {
    console.error("DB Query Failed:", err);
    return "";
  }
}

async function sendTelegramText(text: string) {
  console.log(`\n👤 [TestUser] Envía texto: "${text}"`);
  const payload = {
    update_id: Math.floor(Math.random() * 1000000),
    message: {
      message_id: Math.floor(Math.random() * 1000000),
      from: { id: TEST_USER_ID, is_bot: false, first_name: "Integration", last_name: "Tester" },
      chat: { id: TEST_USER_ID, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text
    }
  };
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Webhook falló: ${res.status}`);
}

async function sendTelegramCallback(data: string, callbackQueryId: string, messageId: number) {
  console.log(`\n👤 [TestUser] Hace click en: "${data}"`);
  const payload = {
    update_id: Math.floor(Math.random() * 1000000),
    callback_query: {
      id: callbackQueryId,
      from: { id: TEST_USER_ID, is_bot: false, first_name: "Integration", last_name: "Tester" },
      message: {
        message_id: messageId,
        chat: { id: TEST_USER_ID, type: "private" },
        date: Math.floor(Date.now() / 1000)
      },
      data
    }
  };
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Webhook falló: ${res.status}`);
}

/** Wait for a new outgoing message from the bot (text commands) */
async function waitForBotResponse(afterDateStr: string) {
  console.log("⏳ Esperando nueva respuesta del bot...");
  let retries = 40;
  while (retries > 0) {
    const jsonRes = dbQuery(`SELECT json_agg(json_build_object('text', m.text, 'createdAt', m.created_at)) FROM message m JOIN conversation c ON m.conversation_id = c.id JOIN contact ct ON c.contact_id = ct.id WHERE ct.external_address = '${TEST_USER_ID}' AND m.direction = 'out' AND m.created_at > '${afterDateStr}'`);
    if (jsonRes && jsonRes !== "null") {
      const msgs = JSON.parse(jsonRes);
      if (msgs && msgs.length > 0) {
        const instanceJson = dbQuery(`SELECT json_build_object('id', id, 'messageId', telegram_message_id, 'allowedActions', allowed_actions, 'state', fsb_state) FROM telegram_menu_instance WHERE chat_id = '${TEST_USER_ID}' AND status = 'active' LIMIT 1`);
        let actions: any[] = [];
        let messageId = 0;
        let state = "";
        if (instanceJson && instanceJson !== "null") {
          const instance = JSON.parse(instanceJson);
          messageId = instance.messageId;
          state = instance.state;
          const allowedActions = instance.allowedActions || [];
          actions = allowedActions.map((actionName: string, idx: number) => ({
            action: actionName,
            data: `m:${instance.id}:${idx}`
          }));
        }
        return { text: msgs.map((m: any) => m.text).join(" | "), actions, messageId, state };
      }
    }
    await sleep(500);
    retries--;
  }
  throw new Error("El bot no respondió a tiempo");
}

/** Wait for the active menu instance to change state (bot edits inline buttons) */
async function waitForMenuStateChange(prevState: string) {
  console.log(`⏳ Esperando cambio de estado del menú (prev: ${prevState})...`);
  let retries = 40;
  while (retries > 0) {
    const instanceJson = dbQuery(`SELECT json_build_object('id', id, 'messageId', telegram_message_id, 'allowedActions', allowed_actions, 'state', fsb_state) FROM telegram_menu_instance WHERE chat_id = '${TEST_USER_ID}' AND status = 'active' LIMIT 1`);
    if (instanceJson && instanceJson !== "null") {
      const instance = JSON.parse(instanceJson);
      if (instance.state !== prevState) {
        const allowedActions = instance.allowedActions || [];
        const actions = allowedActions.map((actionName: string, idx: number) => ({
          action: actionName,
          data: `m:${instance.id}:${idx}`
        }));
        // Get the latest message text too
        const msgJson = dbQuery(`SELECT text FROM message m JOIN conversation c ON m.conversation_id = c.id JOIN contact ct ON c.contact_id = ct.id WHERE ct.external_address = '${TEST_USER_ID}' AND m.direction = 'out' ORDER BY m.created_at DESC LIMIT 1`);
        return { text: msgJson || "", actions, messageId: instance.messageId, state: instance.state };
      }
    }
    await sleep(500);
    retries--;
  }
  throw new Error(`El bot no cambió el estado del menú (prev: ${prevState})`);
}

async function sendCallback(action: { action: string; data: string }, messageId: number) {
  const cbqId = `testcb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await sendTelegramCallback(action.data, cbqId, messageId);
}

async function runTests() {
  console.log("🚀 Iniciando Test de Integración E2E sobre flujos principales...\n");
  
  console.log("🧹 Limpiando contacto de prueba anterior...");
  dbQuery(`DELETE FROM contact WHERE external_address = '${TEST_USER_ID}'`);

  const getCurrentDBTime = () => dbQuery(`SELECT CURRENT_TIMESTAMP(3)`).trim();

  // ─── PASO 1: /start → menú principal ─────────────────────────────────────
  let mark = getCurrentDBTime();
  await sendTelegramText("/start");
  let response = await waitForBotResponse(mark);
  console.log(`✅ [/start] Estado: ${response.state}`);
  console.log(`   Acciones: ${response.actions.map((a: any) => a.action).join(", ")}`);

  // ─── PASO 2: catálogo → categorías ───────────────────────────────────────
  mark = getCurrentDBTime();
  await sendTelegramText("muéstrame tu catálogo");
  response = await waitForBotResponse(mark);
  console.log(`\n✅ [catálogo] Estado: ${response.state}`);
  console.log(`   Acciones: ${response.actions.map((a: any) => a.action).join(", ")}`);

  // ─── PASO 3: ir directo a categoría con productos (Bebidas) ────────────────
  // Encontramos dinámicamente qué categorías tienen productos activos en la DB
  const catWithProds = dbQuery(`SELECT cat.id FROM category cat JOIN product p ON p.category_id = cat.id AND p.active = true GROUP BY cat.id LIMIT 1`);
  const targetCatId = catWithProds?.trim();
  if (!targetCatId) throw new Error("Falla: No hay categorías con productos activos en la DB");
  console.log(`\n📂 Categoría con productos encontrada: ${targetCatId}`);
  
  // Encontrar esa categoría en las acciones actuales del menú
  const targetCategoryAction = response.actions.find((a: any) => a.action === `catalog:category:${targetCatId}`);
  if (!targetCategoryAction) throw new Error(`Falla: categoría ${targetCatId} no está en el menú activo`);
  
  const prevState = response.state;
  await sendCallback(targetCategoryAction, response.messageId);
  response = await waitForMenuStateChange(prevState);
  console.log(`✅ [categoría] Estado: ${response.state}`);
  console.log(`   Acciones: ${response.actions.map((a: any) => a.action).join(", ")}`);

  // ─── PASO 4: agregar producto al carrito ──────────────────────────────────
  const addAction = response.actions.find((a: any) => a.action.startsWith("catalog:product:"));
  if (!addAction) throw new Error("Falla: No se mostraron opciones de productos");

  const prevState2 = response.state;
  await sendCallback(addAction, response.messageId);
  response = await waitForMenuStateChange(prevState2);
  console.log(`\n✅ [add product] Estado: ${response.state}`);
  console.log(`   Acciones: ${response.actions.map((a: any) => a.action).join(", ")}`);

  // ─── PASO 5: ver carrito ───────────────────────────────────────────────────
  const cartAction = response.actions.find((a: any) => a.action === "cart:view");
  if (!cartAction) throw new Error("Falla: No hay botón de Ver Carrito");
  const prevState3 = response.state;
  await sendCallback(cartAction, response.messageId);
  response = await waitForMenuStateChange(prevState3);
  console.log(`\n✅ [carrito] Estado: ${response.state}`);
  console.log(`   Acciones: ${response.actions.map((a: any) => a.action).join(", ")}`);

  // ─── PASO 6: checkout ─────────────────────────────────────────────────────
  const checkoutAction = response.actions.find((a: any) => a.action === "cart:checkout");
  if (!checkoutAction) throw new Error("Falla: No hay botón de Checkout");
  const prevState4 = response.state;
  await sendCallback(checkoutAction, response.messageId);
  response = await waitForMenuStateChange(prevState4);
  console.log(`\n✅ [checkout] Estado: ${response.state}`);
  console.log(`   Acciones: ${response.actions.map((a: any) => a.action).join(", ")}`);

  // ─── PASO 7: ver estado de pedido (refresh) ───────────────────────────────
  const refreshAction = response.actions.find((a: any) => a.action.startsWith("order:refresh:"));
  if (!refreshAction) throw new Error("Falla: No hay botón de Ver Estado/Refresh");
  const prevState5 = response.state;
  await sendCallback(refreshAction, response.messageId);
  // Refresh puede no cambiar estado, lo detectamos por tiempo
  await sleep(3000);
  console.log(`\n✅ [refresh order] Estado: ${response.state}`);

  // ─── PASO 8: cancelar pedido ──────────────────────────────────────────────
  const cancelAction = response.actions.find((a: any) => a.action.startsWith("order:cancel:"));
  if (!cancelAction) throw new Error("Falla: No hay botón de Cancelar Orden");
  const prevState6 = response.state;
  await sendCallback(cancelAction, response.messageId);
  response = await waitForMenuStateChange(prevState6);
  console.log(`\n✅ [cancel order] Estado: ${response.state}`);
  console.log(`   Acciones: ${response.actions.map((a: any) => a.action).join(", ")}`);

  // ─── PASO 9: confirmar cancelación ───────────────────────────────────────
  const confirmCancelAction = response.actions.find((a: any) => a.action.startsWith("order:cancel_confirm:"));
  if (confirmCancelAction) {
    const prevState7 = response.state;
    await sendCallback(confirmCancelAction, response.messageId);
    response = await waitForMenuStateChange(prevState7);
    console.log(`\n✅ [confirm cancel] Estado: ${response.state}`);
  }

  console.log("\n\n🎉 TODOS LOS TESTS PASARON. El flujo E2E completo funciona correctamente.");
}

runTests().catch(err => {
  console.error("\n❌ Test Fallido:", err.message);
  process.exit(1);
});
