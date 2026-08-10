import { getDb, schema } from "@/lib/db/index";
import { eq, desc } from "drizzle-orm";
import { hashTelegramWebhookToken } from "@/server/telegram/integrations";
import crypto from "node:crypto";

async function main() {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "test-secret";
  const webhookUrl = "http://127.0.0.1:7080/api/webhooks/telegram/O657BkPClI3AJe_5oc7OUIOwYf7I7A1yGUm2vibgCZM";
  const chatId = 99999999;
  let messageId = 1000;
  
  async function sendMessage(text: string) {
    console.log(`\n👤 Usuario: ${text}`);
    const updateId = Math.floor(Math.random() * 100000);
    const payload = {
      update_id: updateId,
      message: {
        message_id: messageId++,
        from: { id: chatId, is_bot: false, first_name: "TestUser" },
        chat: { id: chatId, type: "private" },
        date: Math.floor(Date.now() / 1000),
        text
      }
    };
    
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": secret
      },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      console.error("❌ Webhook error:", res.status);
      return;
    }
    
    // Wait for AI pipeline
    await new Promise(r => setTimeout(r, 8000));
    
    // Fetch last bot message
    const db = getDb();
    const messages = await db.select()
      .from(schema.message)
      .where(eq(schema.message.direction, "out"))
      .orderBy(desc(schema.message.createdAt))
      .limit(1);
      
    if (messages.length > 0) {
      console.log(`🤖 Bot: ${messages[0].text}`);
      if (messages[0].status === "failed") {
         console.log(`⚠️ Error interno: ${messages[0].error}`);
      }
    } else {
      console.log(`🤖 Bot: (sin respuesta)`);
    }
  }

  await sendMessage("/start");
  await sendMessage("¿Qué productos tienen?");
  
  process.exit(0);
}

main();
