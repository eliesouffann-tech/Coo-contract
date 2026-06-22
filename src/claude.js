import Anthropic from "@anthropic-ai/sdk";
import { getConversation, saveConversation, getProfile, getAllNotesText } from "./memory.js";
import { TOOLS, executeTool } from "./tools.js";

const client = new Anthropic();

function buildSystemPrompt(fromPhone) {
  const profile = getProfile();
  const notes = getAllNotesText();
  const now = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
  const isOwner = profile.ownerPhone && fromPhone === profile.ownerPhone;

  let identity;

  if (profile.name) {
    if (isOwner) {
      identity = `אתה הסוכן האישי של ${profile.name}${profile.role ? ` (${profile.role})` : ""}.
כרגע ${profile.name} בעצמו מדבר איתך. עזור לו בכל מה שהוא צריך.
יכולותיך: לנתח מסמכים ותמונות, לקבוע תזכורות, לשמור מידע חשוב, לכתוב טקסטים, לחקור נושאים.`;
    } else {
      identity = `אתה ${profile.name}${profile.role ? `, ${profile.role}` : ""}.
מישהו שלח הודעה ל-${profile.name}. ענה בשמו — כאילו אתה הוא.
${profile.style ? `סגנון הכתיבה שלו: ${profile.style}` : ""}
אל תזכיר שאתה AI. ענה בטבעיות כאילו אתה ${profile.name} עצמו.`;
    }
  } else {
    identity = `אתה סוכן AI אישי.
💡 כדי שהסוכן יוכל לענות בשמך, שלח: /profile`;
  }

  return `${identity}

📋 מידע שמור בזיכרון:
${notes}

🕐 עכשיו: ${now}

הנחיות:
- ענה בשפה שהמשתמש כותב בה
- השתמש בכלים (תזכורות, זיכרון) באופן יזום — אם מישהו אומר "תזכיר לי", השתמש ב-set_reminder מיד
- אם מישהו אומר "תזכור ש...", השתמש ב-save_to_memory מיד
- הודעות WhatsApp — קצר ולעניין. סעיפים קצרים עם אמוג'י לנוחות קריאה`;
}

export async function chat(fromPhone, userContent) {
  const history = getConversation(fromPhone);

  // Build content for Claude (string or multimodal array)
  const contentForClaude = typeof userContent === "string"
    ? userContent
    : userContent.blocks; // { blocks: [...], summary: "..." }

  // Working messages for this turn (includes full thinking/tool blocks)
  const working = [
    ...history,
    { role: "user", content: contentForClaude },
  ];

  let reply = "";

  // Agentic loop
  while (true) {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: buildSystemPrompt(fromPhone),
      tools: TOOLS,
      messages: working,
    });

    // Add full response (including thinking blocks) to working for the loop
    working.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "tool_use") {
      const results = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          console.log(`🔧 ${block.name}`, JSON.stringify(block.input).slice(0, 100));
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

  // Persist only text (no thinking/tool blocks — keeps history compact)
  const userSummary = typeof userContent === "string"
    ? userContent
    : userContent.summary;

  history.push({ role: "user", content: userSummary });
  history.push({ role: "assistant", content: reply });
  saveConversation(fromPhone, history);

  return reply;
}
