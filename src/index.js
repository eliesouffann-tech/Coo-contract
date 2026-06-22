import "dotenv/config";
import express from "express";
import ngrok from "@ngrok/ngrok";
import axios from "axios";
import { parseIncomingMessage, sendMessage, markAsRead } from "./whatsapp.js";
import { chat } from "./claude.js";
import { clearConversation, getProfile, saveProfile } from "./memory.js";
import { initScheduler, getUpcoming } from "./scheduler.js";
import { downloadWhatsAppMedia, buildMediaContent, summarizeMedia } from "./media.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// ─── Webhook verification ─────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook אומת");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── Incoming messages ────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const msg = parseIncomingMessage(req.body);
  if (!msg) return;

  const { from, messageId, type } = msg;
  await markAsRead(messageId);

  // ── Special slash commands (text only) ──
  if (type === "text") {
    const text = msg.text.trim();

    if (text === "/reset") {
      clearConversation(from);
      await sendMessage(from, "✅ השיחה אופסה.");
      return;
    }

    if (text === "/help") {
      await sendMessage(from, HELP_TEXT);
      return;
    }

    if (text === "/notes") {
      const { getAllNotesText } = await import("./memory.js");
      await sendMessage(from, `📋 *זיכרון שמור:*\n\n${getAllNotesText()}`);
      return;
    }

    if (text === "/reminders") {
      const list = getUpcoming(from);
      if (list.length === 0) {
        await sendMessage(from, "📭 אין תזכורות פעילות.");
      } else {
        const lines = list.map((r, i) =>
          `${i + 1}. ${r.message}\n   ⏰ ${new Date(r.datetime).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}\n   ID: ${r.id.slice(0, 8)}...`
        );
        await sendMessage(from, `🔔 *תזכורות פעילות:*\n\n${lines.join("\n\n")}`);
      }
      return;
    }

    if (text.startsWith("/profile")) {
      const args = text.slice("/profile".length).trim();
      if (!args) {
        // Set owner phone and start guided setup
        const profile = getProfile();
        saveProfile({ ...profile, ownerPhone: from });
        await sendMessage(
          from,
          `👤 *הגדרת פרופיל*\n\nספר לי על עצמך — שם, תפקיד, ואיך אתה אוהב לכתוב.\n\nלדוגמה:\n_"שמי אלי לוי, יזם טכנולוגיה. אני כותב קצר ולעניין, בעברית, עם הרבה אמוג'י. לא אוהב פורמליות."_`
        );
        return;
      }
    }
  }

  // ── Build content for Claude ──
  let claudeInput;

  try {
    if (type === "text") {
      claudeInput = msg.text;
    } else if (type === "image" || type === "document") {
      await sendMessage(from, "⏳ קורא את הקובץ...");
      const { buffer, mimeType } = await downloadWhatsAppMedia(msg.mediaId);
      const blocks = buildMediaContent(buffer, mimeType, msg.caption);
      const summary = summarizeMedia(mimeType, msg.caption);
      claudeInput = { blocks, summary };
    } else if (type === "audio") {
      await sendMessage(from, "⚠️ הודעות קוליות אינן נתמכות עדיין. שלח טקסט או מסמך.");
      return;
    } else {
      await sendMessage(from, "⚠️ סוג הודעה זה אינו נתמך.");
      return;
    }

    console.log(`📨 [${from}] ${typeof claudeInput === "string" ? claudeInput.slice(0, 60) : claudeInput.summary}`);

    const reply = await chat(from, claudeInput);
    await sendMessage(from, reply);
    console.log(`📤 [${from}] ${reply.slice(0, 60)}`);
  } catch (err) {
    console.error("❌", err?.message ?? err);
    await sendMessage(from, "⚠️ אירעה שגיאה. נסה שוב.");
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ─── Startup ──────────────────────────────────────────────────────────────────
async function start() {
  validateEnv();
  initScheduler(sendMessage);

  app.listen(PORT, () => console.log(`\n🚀 שרת רץ על פורט ${PORT}`));

  if (process.env.NGROK_AUTHTOKEN) {
    await startNgrok();
  } else {
    console.log("\n⚠️  NGROK_AUTHTOKEN לא מוגדר. הפעל 'npm run setup' להגדרת ngrok.\n");
  }
}

async function startNgrok() {
  try {
    console.log("🌐 מפעיל ngrok...");
    const listener = await ngrok.forward({ addr: PORT, authtoken: process.env.NGROK_AUTHTOKEN });
    const publicUrl = listener.url();
    const webhookUrl = `${publicUrl}/webhook`;

    console.log(`\n✅ כתובת ציבורית: ${publicUrl}`);

    const registered = await tryRegisterMeta(webhookUrl);
    if (registered) {
      console.log("\n🎉 הכל מוגן! שלח הודעה ב-WhatsApp לעיסוק עם הסוכן.");
    } else {
      printInstructions(webhookUrl);
    }
  } catch (err) {
    console.error("❌ ngrok:", err?.message ?? err);
  }
}

async function tryRegisterMeta(webhookUrl) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return false;
  try {
    await axios.post(`https://graph.facebook.com/v19.0/${appId}/subscriptions`, {
      object: "whatsapp_business_account",
      callback_url: webhookUrl,
      verify_token: VERIFY_TOKEN,
      fields: ["messages"],
      access_token: `${appId}|${appSecret}`,
    });
    console.log("✅ Webhook נרשם אוטומטית אצל Meta");
    return true;
  } catch {
    return false;
  }
}

function printInstructions(webhookUrl) {
  console.log(`
\x1b[33m\x1b[1m━━━ צעד אחרון — הגדרת Webhook ב-Meta ━━━\x1b[0m

1. כנס ל: \x1b[36mhttps://developers.facebook.com/apps/\x1b[0m
2. בחר את האפליקציה → \x1b[1mWhatsApp → Configuration\x1b[0m
3. לחץ \x1b[1m"Edit"\x1b[0m ליד Webhook והכנס:
   \x1b[1mCallback URL:\x1b[0m  \x1b[36m${webhookUrl}\x1b[0m
   \x1b[1mVerify Token:\x1b[0m  \x1b[36m${VERIFY_TOKEN}\x1b[0m
4. לחץ \x1b[1m"Verify and Save"\x1b[0m
5. לחץ \x1b[1mSubscribe\x1b[0m על \x1b[1mmessages\x1b[0m

\x1b[1mזהו! הסוכן מוכן לקבל הודעות.\x1b[0m
`);
}

function validateEnv() {
  const required = ["ANTHROPIC_API_KEY", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "VERIFY_TOKEN"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`\n❌ חסרים: ${missing.join(", ")}\n   הפעל: npm run setup\n`);
    process.exit(1);
  }
}

const HELP_TEXT = `🤖 *פקודות זמינות:*

/profile — הגדר את הפרופיל שלך (שם, תפקיד, סגנון כתיבה)
/notes — הצג את כל המידע השמור
/reminders — הצג תזכורות פעילות
/reset — נקה את היסטוריית השיחה
/help — הצג הודעה זו

💡 *מה הסוכן יכול לעשות:*
• לענות על שאלות ולעזור בכל משימה
• לנתח מסמכים ותמונות שתשלח
• לקבוע תזכורות ("תזכיר לי מחר ב-9 לצלצל לרון")
• לזכור מידע ("תזכור שמספר הרכב שלי הוא 12-345-67")
• לכתוב הודעות, מיילים, סיכומים
• לענות בשמך לאנשים אחרים`;

start();
