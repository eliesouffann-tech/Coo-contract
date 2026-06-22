import Anthropic from "@anthropic-ai/sdk";
import { getHistory, addMessage } from "./conversations.js";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const SYSTEM_PROMPT = `אתה סוכן AI אישי המשרת את המשתמש דרך WhatsApp.
אתה עוזר בכל משימה: כתיבה, מחקר, תכנון, חישובים, עצות, תרגומים, ועוד.
ענה בשפה שבה המשתמש כותב אליך.
היה תמציתי וברור — הודעות WhatsApp צריכות להיות קצרות וקריאות.
אם צריך תשובה ארוכה, חלק אותה לסעיפים קצרים עם אמוג'י לנוחות קריאה.`;

export async function chat(userId, userMessage) {
  addMessage(userId, "user", userMessage);

  const history = getHistory(userId);

  const stream = client.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: history,
  });

  const finalMessage = await stream.finalMessage();

  // Extract text from response (skip thinking blocks)
  const replyText = finalMessage.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  addMessage(userId, "assistant", replyText);

  return replyText;
}
