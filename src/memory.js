import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function read(file, def) {
  ensureDir();
  const p = join(DATA_DIR, file);
  if (!existsSync(p)) return def;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return def; }
}

function write(file, data) {
  ensureDir();
  writeFileSync(join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// ─── User Profile ─────────────────────────────────────────────────────────────
export function getProfile() {
  return read("profile.json", { name: "", role: "", style: "", ownerPhone: "" });
}

export function saveProfile(profile) {
  write("profile.json", profile);
}

// ─── Notes / Long-term memory ─────────────────────────────────────────────────
export function getNotes() {
  return read("notes.json", {});
}

export function saveNote(key, value) {
  const notes = getNotes();
  notes[key] = { value, savedAt: new Date().toISOString() };
  write("notes.json", notes);
}

export function deleteNote(key) {
  const notes = getNotes();
  delete notes[key];
  write("notes.json", notes);
}

export function getAllNotesText() {
  const entries = Object.entries(getNotes());
  if (entries.length === 0) return "אין מידע שמור";
  return entries.map(([k, v]) => `• ${k}: ${v.value}`).join("\n");
}

// ─── Conversation history (persistent, per user) ──────────────────────────────
export function getConversation(userId) {
  return read("conversations.json", {})[userId] ?? [];
}

export function saveConversation(userId, history) {
  const all = read("conversations.json", {});
  all[userId] = history.slice(-50); // keep last 50 messages
  write("conversations.json", all);
}

export function clearConversation(userId) {
  const all = read("conversations.json", {});
  delete all[userId];
  write("conversations.json", all);
}
