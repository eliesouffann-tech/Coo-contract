import OpenAI from "openai";
import {
  getConversation, saveConversation,
  getProfile, getAllNotesText, getAllContactsText, getTasksText,
} from "./memory.js";
import { TOOLS, executeTool } from "./tools.js";
import { isCalendarReady, getUpcomingEventsText } from "./calendar.js";
import { isEmailReady } from "./email.js";
import { isN8nReady } from "./n8n.js";
import { isVisittReady } from "./visitt.js";
import { webSearch } from "./search.js";

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// llama-3.1-8b-instant: ~500K TPD free, fast, tool-capable
// llama-3.3-70b-versatile: 100K TPD free, smarter but hits limit fast
const MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const FALLBACK_MODEL = "llama-3.3-70b-versatile";
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

  const orgName = profile.orgName ? `ארגון: ${profile.orgName}\n` : "";
  const ownerTitle = profile.name ? `${profile.name}${profile.role ? ` — ${profile.role}` : ""}` : "המנהל";

  const emailStatus = isEmailReady() ? "" : "\n⚠️ מייל: הוסף EMAIL_ADDRESS ו-EMAIL_APP_PASSWORD ל-.env";
  const n8nStatus = isN8nReady() ? "\n🔀 n8n: trigger_n8n_workflow זמין לאוטומציות." : "";
  const visittStatus = isVisittReady()
    ? "\n🔧 Visitt מחובר — visitt_get_work_orders / visitt_create_work_order / visitt_get_stats / visitt_update_work_order זמינים."
    : "";

  let senderCtx;
  if (isOwner) {
    senderCtx = `המנהל עצמו (${ownerTitle}) מדבר איתך.`;
  } else {
    senderCtx = `הודעה נכנסת מ-${fromPhone}. ענה בשם הארגון.`;
  }

  return `אתה מנהל לשכה ומנהל תפעול בכיר עם ניסיון של 30 שנה.
${orgName}אתה עובד עבור: ${ownerTitle}
${senderCtx}

🕐 עכשיו: ${now}${calendarSection}

📋 זיכרון ארגוני:
${notes}

👥 אנשי קשר:
${contacts}

✅ משימות פתוחות:
${tasks}${emailStatus}${n8nStatus}${visittStatus}

━━━ עקרונות עבודה ━━━

CRITICAL: ענה תמיד בעברית בלבד. אסור לענות באנגלית בשום מצב.

כמנהל לשכה בכיר, בכל תשובה עליך:
1. להבין את ההקשר הארגוני המלא
2. להציע פתרונות קונקרטיים — לא רק לענות
3. לזהות סיכונים ולהציג אותם
4. להציע פעולות המשך
5. לתעד כל החלטה ב-log_decision
6. לפעול יזום — לא לחכות לשאלה

שימוש בכלים — פעל אוטומטית:
• "תזכיר לי" → set_reminder
• "תזכור ש" → save_to_memory
• "תקבע פגישה" → create_calendar_event
• "שלח מייל" → send_email
• "הוסף עובד / ספק" → save_employee / save_vendor
• "פרויקט חדש" → create_project
• "הוחלט ש" → log_decision
• "מה ביקש X?" → search_history
• "הפק דוח" → generate_daily_report / generate_weekly_report
• "ביקורת" → generate_audit_report
• משימה עם מילות דחיפות/בטיחות → add_task_with_priority
• "כמה קריאות פתוחות?" / "תקלה חדשה" → visitt_get_stats / visitt_create_work_order
• "עדכן/סגור קריאה Visitt" → visitt_update_work_order
• לחיפוש מידע עדכני → web_search

עדיפות בסיס: בטיחות > רגולציה > דיירים/מטופלים > עלות > דחיפות
הודעות WhatsApp: קצר, ברור, אמוג'י למבנה, עד 300 מילה`;
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

  // Keep last 20 messages to limit token usage on free tier
  const recentHistory = history.slice(-20);
  const messages = [
    { role: "system", content: systemPrompt },
    ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userText },
  ];

  async function callGroq(msgs, withTools = true, modelOverride = null) {
    const model = modelOverride ?? MODEL;
    const params = { model, messages: msgs, max_tokens: 500 };
    if (withTools) {
      params.tools = groqTools;
      params.tool_choice = "auto";
    }
    try {
      return await groq.chat.completions.create(params);
    } catch (err) {
      const status = err.status ?? err.response?.status;
      if (withTools && (status === 400 || status === 422)) {
        console.warn("⚠️ Tool validation error, retrying without tools:", err.message?.slice(0, 120));
        return callGroq(msgs, false, modelOverride);
      }
      // If primary model fails, try fallback model
      if (!modelOverride && model !== FALLBACK_MODEL && (status === 404 || status === 503 || status === 500)) {
        console.warn(`⚠️ Model ${model} failed (${status}), trying fallback: ${FALLBACK_MODEL}`);
        return callGroq(msgs, false, FALLBACK_MODEL);
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
