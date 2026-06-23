import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  getConversation, saveConversation,
  getProfile, getAllNotesText, getAllContactsText, getTasksText,
} from "./memory.js";
import { GEMINI_TOOLS, executeTool } from "./tools.js";
import { isCalendarReady, getUpcomingEventsText } from "./calendar.js";
import { isEmailReady } from "./email.js";
import { webSearch } from "./search.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const WEB_SEARCH_TOOL = {
  name: "web_search",
  description: "מחפש מידע עדכני ברשת. השתמש כשצריך נתונים עדכניים: מחירים, חדשות, מזג אוויר, כתובות.",
  parameters: {
    type: "OBJECT",
    properties: {
      query: { type: "STRING", description: "שאילתת חיפוש" },
    },
    required: ["query"],
  },
};

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
    } catch { /* skip */ }
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

function toGeminiHistory(history) {
  return history.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));
}

export async function chat(fromPhone, userContent) {
  const history = getConversation(fromPhone);
  const systemPrompt = await buildSystemPrompt(fromPhone);

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: [...GEMINI_TOOLS, WEB_SEARCH_TOOL] }],
  });

  const session = model.startChat({ history: toGeminiHistory(history) });

  const userParts = typeof userContent === "string"
    ? userContent
    : userContent.blocks;

  let response = await session.sendMessage(userParts);

  // Agentic tool-call loop
  while (true) {
    const calls = response.response.functionCalls?.() ?? [];
    if (!calls.length) break;

    const functionResponses = [];
    for (const call of calls) {
      console.log(`🔧 ${call.name}`, JSON.stringify(call.args).slice(0, 120));
      let result;
      try {
        result = call.name === "web_search"
          ? await webSearch(call.args.query)
          : await executeTool(call.name, call.args);
      } catch (err) {
        result = { error: err.message };
      }
      functionResponses.push({
        functionResponse: {
          name: call.name,
          response: { result: JSON.stringify(result) },
        },
      });
    }

    response = await session.sendMessage(functionResponses);
  }

  const reply = response.response.text?.() ?? "";

  // Persist text-only history
  const userSummary = typeof userContent === "string" ? userContent : userContent.summary;
  history.push({ role: "user", content: userSummary });
  history.push({ role: "assistant", content: reply });
  saveConversation(fromPhone, history);

  return reply;
}
