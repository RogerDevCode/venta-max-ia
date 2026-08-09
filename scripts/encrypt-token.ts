import { encryptSecret } from "@/lib/crypto";

const token = process.env.TELEGRAM_BOT_TOKEN!;
const enc = encryptSecret(token);
console.log("cipher:", enc.cipher);
console.log("iv:", enc.iv);
console.log("tag:", enc.tag);