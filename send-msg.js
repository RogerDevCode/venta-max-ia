const webhookUrl = "http://127.0.0.1:7080/api/webhooks/telegram/O657BkPClI3AJe_5oc7OUIOwYf7I7A1yGUm2vibgCZM";
const secret = "c7PYTwybNx2dLwVOmBgjwlRMvBI9h0GdgWC5SE20cF8";

async function chat(text) {
  console.log(`\n👤 Usuario Dice: ${text}`);
  const payload = {
    update_id: Math.floor(Math.random() * 100000),
    message: {
      message_id: Math.floor(Math.random() * 100000),
      from: { id: 5391760292, is_bot: false, first_name: "Roger" },
      chat: { id: 5391760292, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text
    }
  };
  
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(payload)
  });
  
  console.log(`✅ Webhook respondio: HTTP ${res.status}`);
  if (!res.ok) {
    console.error(await res.text());
  }
}

async function main() {
  const msg = process.argv.slice(2).join(" ") || "Hola";
  await chat(msg);
}
main();
