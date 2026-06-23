import Anthropic from "@anthropic-ai/sdk";
import {
  getConversation, saveConversation,
  getProfile, getAllNotesText, getAllContactsText, getTasksText,
} from "./memory.js";
import { TOOLS, executeTool } from "./tools.js";
import { isCalendarReady, getUpcomingEventsText } from "./calendar.js";
import { isEmailReady } from "./email.js";

const client = new Anthropic();

// Server-side tools hosted by Anthropic — no client execution needed
const SERVER_TOOLS = [
  { type: "web_search_20260209", name: "web_search" },
  { type: "web_fetch_20260209",  name: "web_fetch"  },
];

const SERVER_TOOL_NAMES = new Set(SERVER_TOOLS.map((t) => t.name));

async function buildSystemPrompt(fromPhone) {
  const profile = getProfile();
  const notes = getAllNotesText();
  const contacts = getAllContactsText();
  const tasks = getTasksText("pending");
  const now = new Date().toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit",
  });

  let calendarSection = "";
  if (isCalendarReady()) {
    try {
      calendarSection = `\n📅 לוח זמנים היום:\n${await getUpcomingEventsText()}`;
    } catch { /* calendar error — skip */ }
  }

  const isOwner = profile.ownerPhone && fromPhone === profile.ownerPhone;

  let identity;
  if (profile.name) {
    if (isOwner) {
      identity = `אתה הסוכן האישי של ${profile.name}${profile.role ? ` (${profile.role})` : ""}.
${profile.name} עצמו מדבר איתך עכשיו.
עזור לו בכל: ניתוח מסמכים, קביעת פגישות, תזכורות, כתיבת טקסטים, מחקר, חישובים, שליחת מיילים — הכל.`;
    } else {
      identity = `אתה ${profile.name}${profile.role ? `, ${profile.role}` : ""}.
מישהו שלח הודעה ל-${profile.name}. ענה בדיוק כמוהו — אותו סגנון, אותה שפה, אותה אישיות.
${profile.style ? `הסגנון שלו: ${profile.style}` : ""}
אל תזכיר שאתה AI. ענה בטבעיות כאילו אתה ${profile.name} עצמו.`;
    }
  } else {
    identity = `אתה סוכן AI אישי.\n💡 שלח /profile להגדרת הפרופיל.`;
  }

  const emailStatus = isEmailReady() ? "" : "\n⚠️ שליחת מייל: הוסף EMAIL_ADDRESS ו-EMAIL_APP_PASSWORD ל-.env";

  return `${identity}

🕐 עכשיו: ${now}${calendarSection}

📋 זיכרון:
${notes}

👥 אנשי קשר:
${contacts}

✅ משימות פתוחות:
${tasks}${emailStatus}

הנחיות:
- ענה בשפה שפונים אליך בה
- השתמש בכלים באופן יזום: "תזכיר לי" → set_reminder, "תזכור ש" → save_to_memory, "תקבע פגישה" → create_calendar_event, "שלח מייל" → send_email
- לחיפוש מידע עדכני — השתמש ב-web_search
- כשמישהו מציין שמו → save_contact
- הודעות WhatsApp — קצר, ברור, אמוג'י לנוחות קריאה`;
}

export async function chat(fromPhone, userContent) {
  const history = getConversation(fromPhone);

  const contentForClaude = typeof userContent === "string"
    ? userContent
    : userContent.blocks;

  const working = [
    ...history,
    { role: "user", content: contentForClaude },
  ];

  let reply = "";

  while (true) {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: await buildSystemPrompt(fromPhone),
      tools: [...SERVER_TOOLS, ...TOOLS],
      messages: working,
    });

    working.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "tool_use") {
      const results = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        // Server-side tools (web_search, web_fetch) are executed by Anthropic —
        // pass a placeholder result so the loop can continue
        if (SERVER_TOOL_NAMES.has(block.name)) {
          console.log(`🌐 ${block.name}`, JSON.stringify(block.input).slice(0, 100));
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({ status: "executed_server_side" }),
          });
          continue;
        }

        // User-defined tools
        console.log(`🔧 ${block.name}`, JSON.stringify(block.input).slice(0, 120));
        const result = await executeTool(block.name, block.input);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      working.push({ role: "user", content: results });
      continue;
    }

    reply = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    break;
  }

  // Persist text-only history
  const userSummary = typeof userContent === "string" ? userContent : userContent.summary;
  history.push({ role: "user", content: userSummary });
  history.push({ role: "assistant", content: reply });
  saveConversation(fromPhone, history);

  return reply;
}
