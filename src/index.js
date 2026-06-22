import "dotenv/config";
import express from "express";
import { parseIncomingMessage, sendMessage, markAsRead } from "./whatsapp.js";
import { chat } from "./claude.js";
import { clearHistory } from "./conversations.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Webhook verification (one-time setup by Meta)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Incoming WhatsApp messages
app.post("/webhook", async (req, res) => {
  // Acknowledge immediately so Meta doesn't retry
  res.sendStatus(200);

  const message = parseIncomingMessage(req.body);
  if (!message) return;

  const { from, messageId, text } = message;
  console.log(`[${from}]: ${text}`);

  // Mark as read
  await markAsRead(messageId);

  // Special command: clear conversation history
  if (text.trim().toLowerCase() === "/reset") {
    clearHistory(from);
    await sendMessage(from, "✅ השיחה אופסה. אפשר להתחיל מחדש!");
    return;
  }

  try {
    const reply = await chat(from, text);
    await sendMessage(from, reply);
  } catch (err) {
    console.error("Error processing message:", err?.message ?? err);
    await sendMessage(
      from,
      "⚠️ אירעה שגיאה. אנא נסה שוב."
    );
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`WhatsApp AI Agent running on port ${PORT}`);
});
