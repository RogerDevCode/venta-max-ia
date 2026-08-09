import { getEnv } from "../src/lib/env.js";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
const origLookup = dns.lookup;
dns.lookup = ((domain: any, options: any, callback: any) => {
  if (typeof options === "object" && options !== null) {
    if (!options.family) options.family = 4;
  } else if (typeof options === "function") {
    callback = options;
    options = { family: 4 };
  }
  return origLookup(domain, options, callback);
}) as typeof dns.lookup;

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
  const webhookUrl = "http://127.0.0.1:7080/api/webhooks/telegram/O657BkPClI3AJe_5oc7OUIOwYf7I7A1yGUm2vibgCZM";
  const secret = "c7PYTwybNx2dLwVOmBgjwlRMvBI9h0GdgWC5SE20cF8";

  console.log("Polling Telegram getUpdates and forwarding to local webhook...");
  let offset = 0;

  while (true) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=10`);
      if (res.ok) {
        const data = await res.json();
        for (const update of data.result) {
          console.log(`Forwarding update ${update.update_id}...`);
          const fwd = await fetch(webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": secret
            },
            body: JSON.stringify(update)
          });
          if (fwd.ok) {
             console.log(`✅ Update ${update.update_id} forwarded`);
          } else {
             console.error(`❌ Failed to forward update ${update.update_id}:`, fwd.status);
          }
          offset = update.update_id + 1;
        }
      }
    } catch (e) {
      console.error("Polling error:", e);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

main();
