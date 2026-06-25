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

// gemma2-9b-it:            15K TPM, 500K TPD — handles large prompts ✅
// llama-3.1-8b-instant:    6K TPM (too small for our prompt+tools)
// llama-3.3-70b-versatile: 6K TPM, 100K TPD (hits daily limit fast)
const MODEL = process.env.GROQ_MODEL || "gemma2-9b-it";
const FALLBACK_MODEL = "llama-3.1-8b-instant";
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

  const notesShort = notes.length > 600 ? notes.slice(0, 600) + "…" : notes;
  const contactsShort = contacts.length > 400 ? contacts.slice(0, 400) + "…" : contacts;
  const tasksShort = tasks.length > 400 ? tasks.slice(0, 400) + "…" : tasks;

  return `אתה מנהל לשכה בכיר. ענה תמיד בעברית בלבד.
${orgName}עבור: ${ownerTitle} | ${senderCtx}
🕐 ${now}${calendarSection}
📋 זיכרון: ${notesShort}
👥 קשרים: ${contactsShort}
✅ משימות: ${tasksShort}${emailStatus}${visittStatus}

השתמש בכלים אוטומטית: תזכורות→set_reminder, זיכרון→save_to_memory, החלטות→log_decision, Visitt→visitt_get_stats/visitt_create_work_order, דוח→generate_daily_report.
עדיפות: בטיחות > רגולציה > דיירים > עלות. תגובות: קצר, עברית, אמוג'י, עד 200 מילה.`;
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
