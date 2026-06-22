import Anthropic from "@anthropic-ai/sdk";
import {
  getConversation, saveConversation,
  getProfile, getAllNotesText, getAllContactsText, getTasksText,
} from "./memory.js";
import { TOOLS, executeTool } from "./tools.js";
import { isCalendarReady, getUpcomingEventsText } from "./calendar.js";

const client = new Anthropic();

async function buildSystemPrompt(fromPhone) {
  const profile = getProfile();
  const notes = getAllNotesText();
  const contacts = getAllContactsText();
  const tasks = getTasksText("pending");
  const now = new Date().toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  let calendarSection = "";
  if (isCalendarReady()) {
    try {
      const events = await getUpcomingEventsText();
      calendarSection = `\n📅 לוח זמנים היום:\n${events}`;
    } catch { /* ignore */ }
  }

  const isOwner = profile.ownerPhone && fromPhone === profile.ownerPhone;

  let identity;
  if (profile.name) {
    if (isOwner) {
      identity = `אתה הסוכן האישי של ${profile.name}${profile.role ? ` (${profile.role})` : ""}.
${profile.name} עצמו מדבר איתך עכשיו.
עזור לו בכל: ניתוח מסמכים, קביעת פגישות, תזכורות, כתיבת טקסטים, מחקר, חישובים — הכל.`;
    } else {
      identity = `אתה ${profile.name}${profile.role ? `, ${profile.role}` : ""}.
מישהו שלח הודעה ל-${profile.name}. ענה בדיוק כמוהו — באותו סגנון, אותה שפה, אותה אישיות.
${profile.style ? `הסגנון שלו: ${profile.style}` : ""}
אל תזכיר שאתה AI. ענה בטבעיות כאילו אתה ${profile.name} עצמו.
אם השאלה דורשת מידע שאין לך — ענה בצורה כללית או אמור שתחזור עם תשובה.`;
    }
  } else {
    identity = `אתה סוכן AI אישי.
💡 שלח /profile כדי להגדיר את הפרופיל שלך — ואז אענה לאנשים בשמך.`;
  }

  return `${identity}

🕐 עכשיו: ${now}${calendarSection}

📋 זיכרון:
${notes}

👥 אנשי קשר:
${contacts}

✅ משימות פתוחות:
${tasks}

הנחיות:
- ענה בשפה שפונים אליך בה
- השתמש בכלים באופן יזום — "תזכיר לי" → set_reminder מיד, "תזכור ש" → save_to_memory מיד, "תקבע פגישה" → create_calendar_event
- כשמישהו מציין את שמו → save_contact
- הודעות WhatsApp — קצר, ברור, סעיפים קצרים עם אמוג'י`;
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
      tools: TOOLS,
      messages: working,
    });

    working.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "tool_use") {
      const results = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          console.log(`🔧 ${block.name}`, JSON.stringify(block.input).slice(0, 120));
          const result = await executeTool(block.name, block.input);
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
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

  // Persist text-only history (no thinking/tool blocks)
  const userSummary = typeof userContent === "string" ? userContent : userContent.summary;
  history.push({ role: "user", content: userSummary });
  history.push({ role: "assistant", content: reply });
  saveConversation(fromPhone, history);

  return reply;
}
