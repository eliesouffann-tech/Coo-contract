import axios from "axios";
import OpenAI, { toFile } from "openai";

let _openai;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_openai) _openai = new OpenAI();
  return _openai;
}

export function isTranscriptionReady() {
  return !!process.env.OPENAI_API_KEY;
}

export async function transcribeAudio(buffer, mimeType) {
  const client = getOpenAI();
  if (!client) throw new Error("OPENAI_API_KEY לא מוגדר");

  // Determine file extension from mime type
  const ext = mimeType.includes("ogg") ? "ogg"
    : mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a"
    : mimeType.includes("mpeg") || mimeType.includes("mp3") ? "mp3"
    : mimeType.includes("wav") ? "wav"
    : mimeType.includes("webm") ? "webm"
    : "ogg";

  const file = await toFile(buffer, `voice.${ext}`, { type: mimeType });

  const result = await client.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "text",
  });

  return result.trim();
}

export async function downloadWhatsAppMedia(mediaId) {
  const token = process.env.WHATSAPP_TOKEN;

  const { data: info } = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const response = await axios.get(info.url, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: "arraybuffer",
  });

  return {
    buffer: Buffer.from(response.data),
    mimeType: info.mime_type ?? "application/octet-stream",
  };
}

// Build Claude-compatible content blocks for media
export function buildMediaContent(buffer, mimeType, caption = "") {
  const base64 = buffer.toString("base64");
  const blocks = [];

  if (mimeType.startsWith("image/")) {
    if (caption) blocks.push({ type: "text", text: caption });
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: mimeType, data: base64 },
    });
  } else if (mimeType === "application/pdf") {
    if (caption) blocks.push({ type: "text", text: caption });
    blocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64 },
    });
  } else {
    // For unsupported types, describe them
    blocks.push({ type: "text", text: `[קובץ מסוג ${mimeType}${caption ? `: ${caption}` : ""}]` });
  }

  return blocks;
}

// Short text summary of media content (for storing in history)
export function summarizeMedia(mimeType, caption) {
  if (mimeType.startsWith("image/")) return `[תמונה${caption ? `: ${caption}` : ""}]`;
  if (mimeType === "application/pdf") return `[מסמך PDF${caption ? `: ${caption}` : ""}]`;
  return `[קובץ: ${mimeType}${caption ? ` - ${caption}` : ""}]`;
}
