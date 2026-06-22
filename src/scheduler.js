import cron from "node-cron";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data");
const FILE = join(DATA_DIR, "reminders.json");

// sendMessage is injected at init to avoid circular imports
let _send;

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readAll() {
  ensureDir();
  if (!existsSync(FILE)) return [];
  try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return []; }
}

function writeAll(data) {
  ensureDir();
  writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export function addReminder({ id, phone, message, datetime }) {
  const all = readAll();
  all.push({ id, phone, message, datetime, done: false });
  writeAll(all);
}

export function removeReminder(id) {
  const all = readAll();
  const updated = all.filter((r) => r.id !== id);
  writeAll(updated);
  return all.length !== updated.length;
}

export function getUpcoming(phone) {
  const now = new Date();
  return readAll()
    .filter((r) => r.phone === phone && !r.done && new Date(r.datetime) > now)
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

export function initScheduler(sendFn) {
  _send = sendFn;

  // Fire any reminders that were missed while server was down
  fireOverdue();

  // Check every minute
  cron.schedule("* * * * *", fireOverdue, { timezone: "Asia/Jerusalem" });
  console.log("⏰ מערכת תזכורות פעילה");
}

async function fireOverdue() {
  const now = new Date();
  const all = readAll();
  let changed = false;

  for (const r of all) {
    if (r.done) continue;
    if (new Date(r.datetime) <= now) {
      try {
        await _send(r.phone, `🔔 *תזכורת:* ${r.message}`);
        r.done = true;
        changed = true;
        console.log(`🔔 תזכורת נשלחה ל-${r.phone}: ${r.message}`);
      } catch (err) {
        console.error("שגיאה בשליחת תזכורת:", err.message);
      }
    }
  }

  if (changed) writeAll(all);
}
