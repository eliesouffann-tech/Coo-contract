import axios from "axios";
import OpenAI, { toFile } from "openai";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
// Import from lib path to avoid pdf-parse running its test suite on load
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

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

export async function parsePdfText(buffer) {
  const data = await pdfParse(buffer);
  const text = data.text.trim();
  // Truncate very long PDFs to avoid token limits
  if (text.length > 12000) {
    return text.slice(0, 12000) + "\n\n...[המסמך ארוך יותר, מוצגים 12,000 תווים ראשונים]";
  }
  return text;
}

// Build Gemini-compatible content parts for media
export function buildMediaContent(buffer, mimeType, caption = "") {
  const base64 = buffer.toString("base64");
  const parts = [];

  if (caption) parts.push({ text: caption });

  if (mimeType.startsWith("image/") || mimeType === "application/pdf") {
    parts.push({ inlineData: { mimeType, data: base64 } });
  } else {
    parts.push({ text: `[קובץ מסוג ${mimeType}${caption ? `: ${caption}` : ""}]` });
  }

  return parts;
}

// Short text summary of media content (for storing in history)
export function summarizeMedia(mimeType, caption) {
  if (mimeType.startsWith("image/")) return `[תמונה${caption ? `: ${caption}` : ""}]`;
  if (mimeType === "application/pdf") return `[מסמך PDF${caption ? `: ${caption}` : ""}]`;
  return `[קובץ: ${mimeType}${caption ? ` - ${caption}` : ""}]`;
}
