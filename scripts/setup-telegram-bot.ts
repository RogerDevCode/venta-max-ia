import { createTelegramWebhookToken, hashTelegramWebhookToken } from "../src/server/telegram/integrations.js";
import { saveTelegramCredentials } from "../src/server/telegram/credentials.js";
import { createTelegramWebhookUrl } from "../src/server/telegram/webhook-url.js";
import "./enforce-ipv4";

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const orgId = "org_x3jnpp3eyk6h608shh3k";

  if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing in .env");

  console.log("Setting up Telegram Bot for org:", orgId);

  const secret = createTelegramWebhookToken();
  const headerSecret = createTelegramWebhookToken();
  const webhookUrl = createTelegramWebhookUrl(process.env.APP_BASE_URL || "https://bot.tuvitrina.lat", secret);

  const botId = parseInt(token.split(":")[0], 10);
  const botUsername = "ventamaxiabot";
  console.log("Bot:", botUsername);

  await saveTelegramCredentials({
    organizationId: orgId,
    token: token,
    botId,
    botUsername,
    webhookTokenHash: hashTelegramWebhookToken(secret),
    webhookHeaderSecretHash: hashTelegramWebhookToken(headerSecret),
    routeSecret: secret,
    headerSecret,
    status: "connected",
  });
  
  console.log("✅ DB is updated.");
  console.log("Webhook URL to configure:", webhookUrl);
  console.log("Webhook Secret Token:", headerSecret);
}

main().catch(console.error);
