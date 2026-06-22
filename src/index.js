import "dotenv/config";
import express from "express";
import ngrok from "@ngrok/ngrok";
import axios from "axios";
import { parseIncomingMessage, sendMessage, markAsRead } from "./whatsapp.js";
import { chat } from "./claude.js";
import {
  clearConversation, getProfile, saveProfile,
  getAllNotesText, getTasksText, getContactName, saveContact,
} from "./memory.js";
import { initScheduler, getUpcoming } from "./scheduler.js";
import { downloadWhatsAppMedia, buildMediaContent, summarizeMedia } from "./media.js";
import { saveTokenFromCode, getAuthUrl, isCalendarReady } from "./calendar.js";

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

// ─── Google OAuth callback ────────────────────────────────────────────────────
app.get("/oauth2callback", async (req, res) => {
  try {
    await saveTokenFromCode(req.query.code);
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:50px">
        <h2>✅ Google Calendar מחובר בהצלחה!</h2>
        <p>אפשר לסגור חלון זה ולחזור לטרמינל.</p>
      </body></html>
    `);
    console.log("✅ Google Calendar מחובר!");
  } catch (err) {
    res.status(500).send("שגיאה: " + err.message);
  }
});

// ─── Incoming WhatsApp messages ───────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const msg = parseIncomingMessage(req.body);
  if (!msg) return;

  const { from, messageId, type } = msg;
  await markAsRead(messageId);

  const profile = getProfile();
  const isOwner = profile.ownerPhone && from === profile.ownerPhone;
  const senderName = getContactName(from) ?? from;

  // ── Special commands (owner only, text) ──────────────────────────────────
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
      await sendMessage(from, `📋 *זיכרון:*\n\n${getAllNotesText()}`);
      return;
    }

    if (text === "/tasks") {
      await sendMessage(from, `✅ *משימות:*\n\n${getTasksText("all")}`);
      return;
    }

    if (text === "/reminders") {
      const list = getUpcoming(from);
      if (!list.length) {
        await sendMessage(from, "📭 אין תזכורות פעילות.");
      } else {
        const lines = list.map((r, i) =>
          `${i + 1}. ${r.message}\n   ⏰ ${new Date(r.datetime).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}\n   🆔 ${r.id.slice(0, 8)}`
        );
        await sendMessage(from, `🔔 *תזכורות פעילות:*\n\n${lines.join("\n\n")}`);
      }
      return;
    }

    if (text === "/calendar") {
      if (!isCalendarReady()) {
        await sendMessage(from, "📅 Google Calendar לא מחובר.\nהפעל מהטרמינל:\n`npm run auth-google`");
      } else {
        await sendMessage(from, "📅 שאל אותי על לוח הזמנים שלך — 'מה יש לי היום?' או 'קבע פגישה...'");
      }
      return;
    }

    if (text.startsWith("/profile")) {
      const args = text.slice("/profile".length).trim();
      const saved = saveProfile({ ...profile, ownerPhone: from });
      if (!args) {
        await sendMessage(
          from,
          `👤 *הגדרת פרופיל*\n\nספר לי עליך — שם, תפקיד, ואיך אתה אוהב לכתוב.\n\n_לדוגמה: "שמי אלי לוי, יזם. כותב קצר ולעניין, עברית, הרבה אמוג'י."_`
        );
        return;
      }
    }
  }

  // ── Build Claude input ────────────────────────────────────────────────────
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
      await sendMessage(from, "⚠️ הודעות קוליות לא נתמכות עדיין.");
      return;
    } else {
      await sendMessage(from, "⚠️ סוג הודעה זה לא נתמך.");
      return;
    }

    console.log(`📨 [${senderName}] ${typeof claudeInput === "string" ? claudeInput.slice(0, 80) : claudeInput.summary}`);

    const reply = await chat(from, claudeInput);
    await sendMessage(from, reply);
    console.log(`📤 [${senderName}] ${reply.slice(0, 80)}`);

    // ── Notify owner when agent replies on their behalf ──────────────────
    if (!isOwner && profile.ownerPhone && profile.notifyOwner !== false) {
      const msgText = typeof claudeInput === "string" ? claudeInput : claudeInput.summary;
      const notification =
        `👁 *הודעה נכנסת*\n` +
        `*מ:* ${senderName}\n` +
        `*הם:* ${msgText.slice(0, 200)}\n\n` +
        `*עניתי בשמך:*\n${reply.slice(0, 300)}${reply.length > 300 ? "..." : ""}`;
      await sendMessage(profile.ownerPhone, notification).catch(() => {});
    }
  } catch (err) {
    console.error("❌", err?.message ?? err);
    await sendMessage(from, "⚠️ אירעה שגיאה. נסה שוב.");
  }
});

app.get("/health", (_req, res) =>
  res.json({ status: "ok", calendar: isCalendarReady(), port: PORT })
);

// ─── Startup ──────────────────────────────────────────────────────────────────
async function start() {
  validateEnv();
  initScheduler(sendMessage);

  app.listen(PORT, () => console.log(`\n🚀 שרת רץ על פורט ${PORT}`));

  if (process.env.NGROK_AUTHTOKEN) {
    await startNgrok();
  } else {
    console.log("\n⚠️  NGROK_AUTHTOKEN לא מוגדר. הפעל 'npm run setup'.\n");
  }

  if (isCalendarReady()) {
    console.log("📅 Google Calendar מחובר ✅");
  } else if (process.env.GOOGLE_CLIENT_ID) {
    console.log("📅 Google Calendar: הפעל 'npm run auth-google' לחיבור");
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
    if (!registered) printInstructions(webhookUrl);
    else console.log("\n🎉 הכל מוכן! שלח הודעה ב-WhatsApp לעיסוק עם הסוכן.\n");
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
    console.log("✅ Webhook נרשם אוטומטית");
    return true;
  } catch { return false; }
}

function printInstructions(webhookUrl) {
  console.log(`
\x1b[33m\x1b[1m━━━ צעד אחרון — הגדרת Webhook ב-Meta ━━━\x1b[0m

1. \x1b[36mhttps://developers.facebook.com/apps/\x1b[0m
2. האפליקציה שלך → \x1b[1mWhatsApp → Configuration\x1b[0m
3. \x1b[1mCallback URL:\x1b[0m  \x1b[36m${webhookUrl}\x1b[0m
   \x1b[1mVerify Token:\x1b[0m  \x1b[36m${VERIFY_TOKEN}\x1b[0m
4. לחץ \x1b[1m"Verify and Save"\x1b[0m + Subscribe על \x1b[1mmessages\x1b[0m
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

const HELP_TEXT = `🤖 *פקודות:*

/profile — הגדר את הפרופיל שלך
/notes — הצג זיכרון שמור
/tasks — הצג משימות
/reminders — הצג תזכורות
/calendar — סטטוס Google Calendar
/reset — נקה שיחה
/help — עזרה

💬 *דוגמאות לשימוש:*
• "תזכיר לי מחר ב-9 לצלצל לדוד"
• "תוסיף לי משימה: לשלוח הצעת מחיר עד יום שישי"
• "תקבע פגישה עם רון ביום שלישי ב-14:00"
• "תזכור שהסיסמה של הנהלת חשבונות היא..."
• שלח תמונה/PDF — אנתח אותו לבד`;

start();
