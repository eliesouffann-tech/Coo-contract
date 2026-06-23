import OpenAI from "openai";
import {
  getConversation, saveConversation,
  getProfile, getAllNotesText, getAllContactsText, getTasksText,
} from "./memory.js";
import { TOOLS, executeTool } from "./tools.js";
import { isCalendarReady, getUpcomingEventsText } from "./calendar.js";
import { isEmailReady } from "./email.js";
import { webSearch } from "./search.js";

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const MODEL = "llama3-70b-8192";
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description: "מחפש מידע עדכני ברשת. השתמש כשצריך נתונים עדכניים: מחירים, חדשות, מזג אוויר, כתובות.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "שאילתת חיפוש" },
      },
      required: ["query"],
    },
  },
};

function toGroqTool(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

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

export async function chat(fromPhone, userContent) {
  const history = getConversation(fromPhone);
  const systemPrompt = await buildSystemPrompt(fromPhone);

  const groqTools = [...TOOLS.map(toGroqTool), WEB_SEARCH_TOOL];

  // Handle image input: describe with vision model first, then pass description to main model
  let userText;
  if (userContent?.imageBase64) {
    try {
      const visionContent = [
        { type: "image_url", image_url: { url: `data:${userContent.mimeType};base64,${userContent.imageBase64}` } },
        { type: "text", text: userContent.caption || "תאר ונתח את התמונה בפירוט, בעברית." },
      ];
      const visionResp = await groq.chat.completions.create({
        model: VISION_MODEL,
        messages: [{ role: "user", content: visionContent }],
        max_tokens: 768,
      });
      const description = visionResp.choices[0].message.content ?? "";
      userText = `[תמונה]\n${description}${userContent.caption ? `\n\nהמשתמש כתב: ${userContent.caption}` : ""}`;
    } catch (err) {
      console.error("⚠️ vision error:", err.message?.slice(0, 100));
      userText = userContent.summary;
    }
  } else {
    userText = typeof userContent === "string" ? userContent : userContent.summary;
  }

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userText },
  ];

  async function callGroq(msgs, withTools = true) {
    const params = { model: MODEL, messages: msgs, max_tokens: 600 };
    if (withTools) {
      params.tools = groqTools;
      params.tool_choice = "auto";
    }
    try {
      return await groq.chat.completions.create(params);
    } catch (err) {
      if (withTools && err.status === 400) {
        console.warn("⚠️ Tool validation error, retrying without tools:", err.message?.slice(0, 120));
        return callGroq(msgs, false);
      }
      throw err;
    }
  }

  let response = await callGroq(messages);

  // Agentic tool-call loop
  while (response.choices[0].finish_reason === "tool_calls") {
    const toolCalls = response.choices[0].message.tool_calls ?? [];
    messages.push(response.choices[0].message);

    for (const call of toolCalls) {
      console.log(`🔧 ${call.function.name}`, call.function.arguments.slice(0, 120));
      let result;
      try {
        const args = JSON.parse(call.function.arguments);
        result = call.function.name === "web_search"
          ? await webSearch(args.query)
          : await executeTool(call.function.name, args);
      } catch (err) {
        result = { error: err.message };
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }

    response = await callGroq(messages);
  }

  const reply = response.choices[0].message.content ?? "";

  history.push({ role: "user", content: userText });
  history.push({ role: "assistant", content: reply });
  saveConversation(fromPhone, history);

  return reply;
}
