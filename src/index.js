import "dotenv/config";
import express from "express";
import ngrok from "@ngrok/ngrok";
import axios from "axios";
import { parseIncomingMessage, sendMessage, markAsRead } from "./whatsapp.js";
import { chat } from "./claude.js";
import { clearHistory } from "./conversations.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// ─── Webhook verification (called by Meta once during setup) ─────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook אומת בהצלחה");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── Incoming WhatsApp messages ───────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // acknowledge immediately

  const message = parseIncomingMessage(req.body);
  if (!message) return;

  const { from, messageId, text } = message;
  console.log(`📨 [${from}]: ${text}`);

  await markAsRead(messageId);

  if (text.trim().toLowerCase() === "/reset") {
    clearHistory(from);
    await sendMessage(from, "✅ השיחה אופסה. אפשר להתחיל מחדש!");
    return;
  }

  try {
    const reply = await chat(from, text);
    await sendMessage(from, reply);
    console.log(`📤 [${from}]: ${reply.slice(0, 80)}...`);
  } catch (err) {
    console.error("❌ שגיאה:", err?.message ?? err);
    await sendMessage(from, "⚠️ אירעה שגיאה. אנא נסה שוב.");
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ─── Start server + ngrok ────────────────────────────────────────────────────
async function start() {
  validateEnv();

  app.listen(PORT, () => {
    console.log(`\n🚀 שרת רץ על פורט ${PORT}`);
  });

  if (process.env.NGROK_AUTHTOKEN) {
    await startNgrok();
  } else {
    console.log("\n⚠️  NGROK_AUTHTOKEN לא מוגדר — השרת פועל רק מקומית.");
    console.log(`   הפעל 'npm run setup' להגדרת ngrok.\n`);
  }
}

async function startNgrok() {
  try {
    console.log("🌐 מפעיל ngrok...");
    const listener = await ngrok.forward({
      addr: PORT,
      authtoken: process.env.NGROK_AUTHTOKEN,
    });

    const publicUrl = listener.url();
    const webhookUrl = `${publicUrl}/webhook`;

    console.log(`\n✅ כתובת ציבורית: ${publicUrl}`);

    // Try to register webhook automatically with Meta
    const registered = await registerWebhookWithMeta(webhookUrl);

    if (registered) {
      console.log(`\n🎉 הכל מוכן! שלח הודעה ב-WhatsApp לעיסוק עם הסוכן.\n`);
    } else {
      printManualWebhookInstructions(webhookUrl);
    }
  } catch (err) {
    console.error("❌ ngrok נכשל:", err?.message ?? err);
    console.log("   השרת ממשיך לרוץ מקומית.\n");
  }
}

async function registerWebhookWithMeta(webhookUrl) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const waToken = process.env.WHATSAPP_TOKEN;

  if (!appId || !appSecret) {
    return false; // not enough info to register automatically
  }

  try {
    // Subscribe the app to the phone number's webhook
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    await axios.post(
      `https://graph.facebook.com/v19.0/${appId}/subscriptions`,
      {
        object: "whatsapp_business_account",
        callback_url: webhookUrl,
        verify_token: VERIFY_TOKEN,
        fields: ["messages"],
        access_token: `${appId}|${appSecret}`,
      }
    );

    // Also subscribe the WABA
    await axios.post(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/register`,
      { messaging_product: "whatsapp", pin: "000000" },
      { headers: { Authorization: `Bearer ${waToken}` } }
    ).catch(() => {}); // best-effort

    console.log(`✅ Webhook נרשם אוטומטית אצל Meta`);
    return true;
  } catch (err) {
    return false;
  }
}

function printManualWebhookInstructions(webhookUrl) {
  const BOLD = "\x1b[1m";
  const CYAN = "\x1b[36m";
  const YELLOW = "\x1b[33m";
  const RESET = "\x1b[0m";

  console.log(`
${YELLOW}${BOLD}━━━ צעד אחרון — הגדרת Webhook ב-Meta ━━━${RESET}

1. כנס ל: ${CYAN}https://developers.facebook.com/apps/${RESET}
2. בחר את האפליקציה שלך
3. לך ל: ${BOLD}WhatsApp → Configuration${RESET}
4. לחץ ${BOLD}"Edit"${RESET} ליד Webhook
5. הכנס:
   ${BOLD}Callback URL:${RESET}  ${CYAN}${webhookUrl}${RESET}
   ${BOLD}Verify Token:${RESET}  ${CYAN}${VERIFY_TOKEN}${RESET}
6. לחץ ${BOLD}"Verify and Save"${RESET}
7. מתחת ל-"Webhook fields" — לחץ ${BOLD}Subscribe${RESET} על ${BOLD}messages${RESET}

${BOLD}זהו! הסוכן מוכן לקבל הודעות.${RESET}
`);
}

function validateEnv() {
  const required = [
    "ANTHROPIC_API_KEY",
    "WHATSAPP_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "VERIFY_TOKEN",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `\n❌ משתני סביבה חסרים: ${missing.join(", ")}\n   הפעל: npm run setup\n`
    );
    process.exit(1);
  }
}

start();
