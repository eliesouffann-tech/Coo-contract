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
import { downloadWhatsAppMedia, parsePdfText, summarizeMedia, transcribeAudio, isTranscriptionReady } from "./media.js";
import { saveTokenFromCode, getAuthUrl, isCalendarReady, getUpcomingEventsText } from "./calendar.js";
import { isEmailReady } from "./email.js";
import { isN8nReady } from "./n8n.js";
import { apiRouter } from "./api.js";
import { logMessage, saveContact as saveEntityContact } from "./entities.js";
import { shouldExtractTask, extractTaskFromMessage } from "./extractor.js";
import { generateDailyReport, generateWeeklyReport, generateAuditReport } from "./report.js";
import { addTask } from "./memory.js";

const app = express();
app.use(express.json());
app.use("/api", apiRouter);

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

  try {
  const msg = parseIncomingMessage(req.body);
  if (!msg) return;

  const { from, messageId, type, senderName: waName } = msg;
  await markAsRead(messageId);

  const profile = getProfile();
  const isOwner = profile.ownerPhone && from === profile.ownerPhone;
  const senderName = getContactName(from) ?? waName ?? from;

  // Log every message for analytics & history
  if (type === "text") {
    logMessage({ phone: from, name: senderName, text: msg.text, type: "text" });
  }

  // Auto-extract tasks from incoming text (non-owner messages, or owner if keyword matches)
  if (type === "text" && !msg.text.startsWith("/")) {
    const extracted = extractTaskFromMessage(msg.text, senderName, from);
    if (extracted && !isOwner) {
      // Auto-create the task silently
      const task = addTask({ title: extracted.title.slice(0, 120), notes: `מקור: ${senderName} | עדיפות: ${extracted.priority}` });
      console.log(`📋 משימה אוטומטית: [${extracted.priority}] ${extracted.title.slice(0, 60)}`);
    }
  }

  // ── Special commands (owner only, text) ──────────────────────────────────
  if (type === "text") {
    const text = msg.text.trim();
    const textLower = text.toLowerCase();

    if (textLower === "/ping") {
      await sendMessage(from, "🏓 pong — הבוט פועל!");
      return;
    }

    if (textLower === "/reset") {
      clearConversation(from);
      await sendMessage(from, "✅ השיחה אופסה.");
      return;
    }

    if (textLower === "/help") {
      await sendMessage(from, HELP_TEXT);
      return;
    }

    if (textLower === "/notes") {
      await sendMessage(from, `📋 *זיכרון:*\n\n${getAllNotesText()}`);
      return;
    }

    if (textLower === "/tasks") {
      await sendMessage(from, `✅ *משימות:*\n\n${getTasksText("all")}`);
      return;
    }

    if (textLower === "/reminders") {
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

    if (textLower === "/calendar") {
      if (!isCalendarReady()) {
        await sendMessage(from, "📅 Google Calendar לא מחובר.\nהפעל מהטרמינל:\n`npm run auth-google`");
      } else {
        await sendMessage(from, "📅 שאל אותי על לוח הזמנים שלך — 'מה יש לי היום?' או 'קבע פגישה...'");
      }
      return;
    }

    if (textLower === "/email") {
      if (!isEmailReady()) {
        await sendMessage(from,
          "📧 שליחת מיילים לא מוגדרת.\n\nהוסף ל-.env:\n" +
          "`EMAIL_ADDRESS=your@gmail.com`\n" +
          "`EMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx`\n\n" +
          "לקבלת App Password:\nGmail → ⚙️ → Security → App Passwords"
        );
      } else {
        await sendMessage(from, `📧 מייל מוגדר: ${process.env.EMAIL_ADDRESS}\nאמור לי 'שלח מייל ל...' ואפעל.`);
      }
      return;
    }

    if (textLower === "/n8n") {
      if (!isN8nReady()) {
        await sendMessage(from,
          "🔀 *n8n לא מוגדר*\n\n" +
          "להפעלת אינטגרציית n8n, הוסף ל-.env:\n" +
          "`N8N_WEBHOOK_URL=https://your-n8n.instance/webhook`\n" +
          "`N8N_API_KEY=secret-key` _(אופציונלי)_\n\n" +
          "לאחר ההגדרה תוכל לבקש ממני: 'הפעל workflow ב-n8n'"
        );
      } else {
        await sendMessage(from,
          `🔀 *n8n מחובר ✅*\n\n` +
          `Webhook Base: ${process.env.N8N_WEBHOOK_URL}\n\n` +
          `REST API זמין ב: /api\n\n` +
          `אמור לי 'הפעל workflow ב-n8n' ואוכל להפעיל כל webhook שהגדרת.`
        );
      }
      return;
    }

    if (textLower === "/briefing" || textLower === "/report") {
      const report = generateDailyReport();
      await sendMessage(from, report);
      return;
    }

    if (textLower === "/weekly") {
      const report = generateWeeklyReport();
      await sendMessage(from, report);
      return;
    }

    if (textLower.startsWith("/audit")) {
      const topic = text.slice("/audit".length).trim() || "כללי";
      const report = generateAuditReport(topic);
      await sendMessage(from, report);
      return;
    }

    if (textLower === "/employees") {
      const { getEmployeeRanking } = await import("./entities.js");
      const ranking = getEmployeeRanking();
      if (!ranking.length) {
        await sendMessage(from, "👥 אין עובדים במערכת.\nהוסף: 'שמור עובד: שם, תפקיד, מחלקה'");
      } else {
        const lines = ranking.map(e =>
          `${e.rank}. *${e.name}* (${e.role})\n   ציון: ${e.score}/100 | ✅${e.tasksCompleted}/${e.tasksAssigned} | ⚠️${e.tasksOverdue}`
        );
        await sendMessage(from, `👥 *דירוג עובדים:*\n\n${lines.join("\n\n")}`);
      }
      return;
    }

    if (textLower === "/projects") {
      const { getProjects } = await import("./entities.js");
      const ps = Object.values(getProjects());
      if (!ps.length) {
        await sendMessage(from, "📁 אין פרויקטים.\nצור: 'פרויקט חדש: שם הפרויקט'");
      } else {
        const lines = ps.map(p =>
          `• *${p.name}* — ${p.status}\n  מנהל: ${p.owner || "—"} | עדכון: ${p.updates?.slice(-1)[0]?.update?.slice(0, 50) ?? "אין"}`
        );
        await sendMessage(from, `📁 *פרויקטים:*\n\n${lines.join("\n\n")}`);
      }
      return;
    }

    if (textLower.startsWith("/profile")) {
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

      if (mimeType === "application/pdf") {
        const pdfText = await parsePdfText(buffer);
        const caption = msg.caption ? `\n${msg.caption}` : "";
        claudeInput = `[מסמך PDF${caption}]\n\n${pdfText}`;
      } else if (mimeType.startsWith("image/")) {
        claudeInput = {
          imageBase64: buffer.toString("base64"),
          mimeType,
          caption: msg.caption ?? "",
          summary: summarizeMedia(mimeType, msg.caption),
        };
      } else {
        claudeInput = `[קובץ מסוג ${mimeType}${msg.caption ? `: ${msg.caption}` : ""}]`;
      }
    } else if (type === "audio") {
      if (!isTranscriptionReady()) {
        await sendMessage(from, "⚠️ להפעלת הודעות קוליות הוסף OPENAI_API_KEY ל-.env");
        return;
      }
      await sendMessage(from, "🎙 מתמלל...");
      const { buffer, mimeType } = await downloadWhatsAppMedia(msg.mediaId);
      const transcript = await transcribeAudio(buffer, mimeType);
      console.log(`🎙 [${senderName}] תמלול: ${transcript}`);
      claudeInput = `[הודעה קולית]\n${transcript}`;
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
    try { await sendMessage(from, "⚠️ אירעה שגיאה. נסה שוב."); } catch { /* ignore */ }
  }
  } catch (err) {
    console.error("❌ Unhandled webhook error:", err?.message ?? err);
  }
});

app.get("/health", (_req, res) =>
  res.json({ status: "ok", calendar: isCalendarReady(), email: isEmailReady(), n8n: isN8nReady(), port: PORT })
);

app.use(express.static("public"));
app.get("/dashboard", (_req, res) => res.sendFile("dashboard.html", { root: "public" }));

// ─── Startup ──────────────────────────────────────────────────────────────────
async function start() {
  validateEnv();
  initScheduler(sendMessage, buildMorningBriefing);

  const token = process.env.WHATSAPP_TOKEN ?? "";
  console.log(`\n🔑 WHATSAPP_TOKEN: ${token.slice(0, 12)}...${token.slice(-6)} (אורך: ${token.length})`);

  app.listen(PORT, () => console.log(`\n🚀 שרת רץ על פורט ${PORT}`));

  // Detect deployment platform
  const publicUrl = process.env.PUBLIC_URL          // manually set
    || (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
    || (process.env.RENDER_EXTERNAL_URL)             // Render
    || null;

  if (publicUrl) {
    // ── Cloud deployment (Railway / Render / etc.) ──
    const webhookUrl = `${publicUrl}/webhook`;
    console.log(`\n🌐 URL ציבורי: ${publicUrl}`);
    const registered = await tryRegisterMeta(webhookUrl);
    if (registered) {
      console.log("🎉 Webhook נרשם אוטומטית — הסוכן מוכן!\n");
    } else {
      printInstructions(webhookUrl);
    }
  } else if (process.env.NGROK_AUTHTOKEN) {
    // ── Local with ngrok ──
    await startNgrok();
  } else {
    console.log("\n⚠️  הגדר PUBLIC_URL או NGROK_AUTHTOKEN. הפעל 'npm run setup'.\n");
  }

  if (isCalendarReady()) console.log("📅 Google Calendar מחובר ✅");
  if (isEmailReady())    console.log("📧 שליחת מייל מוגדרת ✅");
  if (isN8nReady())      console.log(`🔀 n8n מחובר ✅  (${process.env.N8N_WEBHOOK_URL})`);
  console.log(`🔌 REST API זמין ב: /api  (הגן עם N8N_API_KEY ב-.env)`);
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

async function buildMorningBriefing() {
  const profile = getProfile();
  if (!profile.ownerPhone) return null;

  let text = generateDailyReport();

  // Append calendar if available
  if (isCalendarReady()) {
    try {
      text += `\n\n📅 *לוח זמנים היום:*\n${await getUpcomingEventsText()}`;
    } catch { /* skip */ }
  }

  // Append reminders
  const reminders = getUpcoming(profile.ownerPhone).slice(0, 5);
  if (reminders.length) {
    text += `\n\n🔔 *תזכורות:*\n` + reminders
      .map(r => `• ${r.message} — ${new Date(r.datetime).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" })}`)
      .join("\n");
  }

  return { phone: profile.ownerPhone, text };
}

function validateEnv() {
  const required = ["GROQ_API_KEY", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "VERIFY_TOKEN"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`\n❌ חסרים: ${missing.join(", ")}\n   הפעל: npm run setup\n`);
    process.exit(1);
  }
}

const HELP_TEXT = `🏢 *מנהל לשכה AI — פקודות:*

*📊 דוחות:*
/report — דוח יומי (משימות, קריטיות, איחורים)
/weekly — דוח שבועי + KPIs + דירוג עובדים
/audit [נושא] — תיק ביקורת (בריאות/בטיחות/כיבוי אש)

*👥 ניהול:*
/employees — דירוג ביצועי עובדים
/projects — סטטוס פרויקטים
/tasks — כל המשימות הפתוחות
/reminders — תזכורות פעילות

*⚙️ הגדרות:*
/profile — פרופיל מנהל + הגדרות ארגון
/notes — זיכרון ארגוני
/calendar — Google Calendar
/email — סטטוס מייל
/n8n — סטטוס אוטומציות n8n
/reset — נקה שיחה
/ping — בדיקת חיבור

*💬 דוגמאות לשיחה:*
• "הוסף עובד: דוד כהן, מנהל תחזוקה, מחלקת מבנים"
• "ספק חדש: חברת ניקיון X, 050-1234567"
• "מה ביקש אייל לפני חודש?"
• "הפק דוח שבועי ושלח לי"
• "מה ההחלטה האחרונה לגבי הגנרטור?"
• "הוחלט לרכוש גנרטור חדש מסכום 80,000₪"
• "פרויקט חדש: שיפוץ מסדרון, עלות 50,000₪"
• "ביקורת משרד הבריאות — הכן תיק"`;

start();
