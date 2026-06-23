import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

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
  return read("profile.json", { name: "", role: "", style: "", ownerPhone: "", notifyOwner: true });
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

// ─── Contacts ─────────────────────────────────────────────────────────────────
export function getContacts() {
  return read("contacts.json", {});
}

export function saveContact(phone, name, notes = "") {
  const contacts = getContacts();
  contacts[phone] = { name, notes, savedAt: new Date().toISOString() };
  write("contacts.json", contacts);
}

export function getContactName(phone) {
  return getContacts()[phone]?.name ?? null;
}

export function getAllContactsText() {
  const entries = Object.entries(getContacts());
  if (entries.length === 0) return "אין אנשי קשר שמורים";
  return entries.map(([phone, c]) => `• ${c.name} — ${phone}${c.notes ? ` (${c.notes})` : ""}`).join("\n");
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
export function getTasks() {
  return read("tasks.json", []);
}

export function addTask({ title, dueDate = null, notes = "" }) {
  const tasks = getTasks();
  const task = { id: randomUUID(), title, dueDate, notes, done: false, createdAt: new Date().toISOString() };
  tasks.push(task);
  write("tasks.json", tasks);
  return task;
}

export function completeTask(id) {
  const tasks = getTasks();
  const task = tasks.find((t) => t.id === id);
  if (task) { task.done = true; task.completedAt = new Date().toISOString(); }
  write("tasks.json", tasks);
  return !!task;
}

export function deleteTask(id) {
  const tasks = getTasks();
  const updated = tasks.filter((t) => t.id !== id);
  write("tasks.json", updated);
  return tasks.length !== updated.length;
}

export function getPendingTasks() {
  return getTasks().filter((t) => !t.done);
}

export function getTasksText(filter = "pending") {
  const tasks = filter === "all" ? getTasks() : getPendingTasks();
  if (tasks.length === 0) return filter === "all" ? "אין משימות" : "אין משימות פתוחות";
  return tasks
    .map((t) => {
      const status = t.done ? "✅" : "⬜";
      const due = t.dueDate ? ` (עד ${new Date(t.dueDate).toLocaleDateString("he-IL")})` : "";
      return `${status} ${t.title}${due} [${t.id.slice(0, 6)}]`;
    })
    .join("\n");
}

// ─── Conversation history ─────────────────────────────────────────────────────
export function getConversation(userId) {
  return read("conversations.json", {})[userId] ?? [];
}

export function saveConversation(userId, history) {
  const all = read("conversations.json", {});
  all[userId] = history.slice(-50);
  write("conversations.json", all);
}

export function clearConversation(userId) {
  const all = read("conversations.json", {});
  delete all[userId];
  write("conversations.json", all);
}
