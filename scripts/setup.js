#!/usr/bin/env node
// Interactive setup wizard — creates .env from user input

import { createInterface } from "readline";
import { writeFileSync, existsSync } from "fs";
import { randomBytes } from "crypto";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

console.log(`
${BOLD}${CYAN}╔══════════════════════════════════════════════╗
║        WhatsApp AI Agent — הגדרה ראשונית     ║
╚══════════════════════════════════════════════╝${RESET}

נשאל אותך ${BOLD}4 שאלות${RESET} — זה הכל.
`);

if (existsSync(".env")) {
  const overwrite = await ask(
    `${YELLOW}⚠️  קובץ .env כבר קיים. להחליף אותו? (כן/לא): ${RESET}`
  );
  if (!overwrite.trim().match(/^(כן|yes|y)$/i)) {
    console.log("בסדר, לא שינינו כלום.");
    rl.close();
    process.exit(0);
  }
}

// ─── Step 1: Anthropic API Key ───────────────────────────────────────────────
console.log(`
${BOLD}שלב 1/4 — מפתח Anthropic${RESET}
1. כנס ל: ${CYAN}https://console.anthropic.com/settings/keys${RESET}
2. לחץ "Create Key"
3. העתק את המפתח (מתחיל ב-sk-ant-...)
`);
let anthropicKey = "";
while (!anthropicKey.startsWith("sk-ant-")) {
  anthropicKey = (await ask("הדבק את המפתח כאן: ")).trim();
  if (!anthropicKey.startsWith("sk-ant-")) {
    console.log(`${YELLOW}המפתח צריך להתחיל ב-sk-ant-... נסה שוב.${RESET}`);
  }
}

// ─── Step 2: WhatsApp Access Token ───────────────────────────────────────────
console.log(`
${BOLD}שלב 2/4 — WhatsApp Access Token${RESET}
1. כנס ל: ${CYAN}https://developers.facebook.com/apps/${RESET}
2. בחר את האפליקציה שלך (או צור חדשה)
3. לך ל: WhatsApp → API Setup
4. העתק את ה-"Temporary access token" (או צור permanent token)
`);
let waToken = "";
while (!waToken) {
  waToken = (await ask("הדבק את ה-Access Token כאן: ")).trim();
  if (!waToken) console.log(`${YELLOW}לא יכול להיות ריק.${RESET}`);
}

// ─── Step 3: Phone Number ID ──────────────────────────────────────────────────
console.log(`
${BOLD}שלב 3/4 — Phone Number ID${RESET}
באותה עמוד (WhatsApp → API Setup):
מתחת ל-"From", תראה את ה-Phone Number ID (מספר ארוך, כמו: 123456789012345)
`);
let phoneNumberId = "";
while (!phoneNumberId.match(/^\d{10,20}$/)) {
  phoneNumberId = (await ask("הדבק את ה-Phone Number ID כאן: ")).trim();
  if (!phoneNumberId.match(/^\d{10,20}$/)) {
    console.log(`${YELLOW}Phone Number ID הוא מספרים בלבד (10-20 ספרות).${RESET}`);
  }
}

// ─── Step 4: ngrok Auth Token ────────────────────────────────────────────────
console.log(`
${BOLD}שלב 4/4 — ngrok Auth Token${RESET}
ngrok מאפשר ל-WhatsApp להגיע לשרת שלך.
1. כנס ל: ${CYAN}https://dashboard.ngrok.com/signup${RESET} (הרשמה בחינם)
2. לאחר ההרשמה לך ל: ${CYAN}https://dashboard.ngrok.com/get-started/your-authtoken${RESET}
3. העתק את ה-Authtoken
`);
let ngrokToken = "";
while (!ngrokToken) {
  ngrokToken = (await ask("הדבק את ה-ngrok Authtoken כאן: ")).trim();
  if (!ngrokToken) console.log(`${YELLOW}לא יכול להיות ריק.${RESET}`);
}

rl.close();

// Generate a random verify token
const verifyToken = randomBytes(16).toString("hex");

// Write .env
const envContent = `# Anthropic
ANTHROPIC_API_KEY=${anthropicKey}

# WhatsApp Cloud API
WHATSAPP_TOKEN=${waToken}
WHATSAPP_PHONE_NUMBER_ID=${phoneNumberId}

# Webhook verification (נוצר אוטומטית)
VERIFY_TOKEN=${verifyToken}

# ngrok
NGROK_AUTHTOKEN=${ngrokToken}

# Server
PORT=3000
`;

writeFileSync(".env", envContent);

console.log(`
${GREEN}${BOLD}✅ קובץ .env נוצר בהצלחה!${RESET}

${BOLD}עכשיו הפעל את הסוכן:${RESET}

  ${CYAN}npm start${RESET}

השרת יתחיל ויציג לך ${BOLD}URL ציבורי${RESET} — העתק אותו ל-Meta.
(הוראות מדויקות יופיעו בטרמינל בעת ההפעלה)
`);
