import axios from "axios";

const BASE_URL = "https://graph.facebook.com/v19.0";

// Parse any incoming WhatsApp message into a unified format
export function parseIncomingMessage(body) {
  try {
    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return null;

    const base = { from: message.from, messageId: message.id, type: message.type };

    switch (message.type) {
      case "text":
        return { ...base, text: message.text.body };

      case "image":
        return {
          ...base,
          mediaId: message.image.id,
          mimeType: "image/jpeg",
          caption: message.image.caption || "",
        };

      case "document":
        return {
          ...base,
          mediaId: message.document.id,
          mimeType: message.document.mime_type,
          caption: message.document.caption || message.document.filename || "",
        };

      case "audio":
        return { ...base, mediaId: message.audio.id, mimeType: "audio/ogg" };

      case "video":
        return {
          ...base,
          mediaId: message.video.id,
          mimeType: "video/mp4",
          caption: message.video.caption || "",
        };

      default:
        return null;
    }
  } catch {
    return null;
  }
}

// Send one or more messages (auto-splits long text)
export async function sendMessage(to, text) {
  for (const chunk of splitMessage(text)) {
    await _post(to, { type: "text", text: { body: chunk } });
  }
}

export async function markAsRead(messageId) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  await axios
    .post(
      `${BASE_URL}/${phoneNumberId}/messages`,
      { messaging_product: "whatsapp", status: "read", message_id: messageId },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    )
    .catch(() => {}); // non-critical
}

async function _post(to, payload) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  await axios.post(
    `${BASE_URL}/${phoneNumberId}/messages`,
    { messaging_product: "whatsapp", to, ...payload },
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
  );
}

function splitMessage(text, max = 4000) {
  if (text.length <= max) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    let cut = remaining.lastIndexOf("\n", max);
    if (cut <= 0) cut = max;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  return chunks;
}
