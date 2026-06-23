import cron from "node-cron";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data");
const FILE = join(DATA_DIR, "reminders.json");

// injected at init to avoid circular imports
let _send;
let _getBriefing; // async fn that returns the morning briefing text

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

export function initScheduler(sendFn, getBriefingFn) {
  _send = sendFn;
  _getBriefing = getBriefingFn;

  // Fire missed reminders immediately on startup
  fireOverdue();

  // Check reminders every minute
  cron.schedule("* * * * *", fireOverdue, { timezone: "Asia/Jerusalem" });

  // Morning briefing — every day at 8:00 AM (Israel time)
  cron.schedule("0 8 * * *", fireMorningBriefing, { timezone: "Asia/Jerusalem" });

  console.log("⏰ מערכת תזכורות + בריפינג בוקר פעילים");
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
        console.log(`🔔 תזכורת → ${r.phone}: ${r.message}`);
      } catch (err) {
        console.error("שגיאה בשליחת תזכורת:", err.message);
      }
    }
  }

  if (changed) writeAll(all);
}

async function fireMorningBriefing() {
  try {
    const briefing = await _getBriefing();
    if (briefing) {
      console.log("☀️ שולח בריפינג בוקר...");
      await _send(briefing.phone, briefing.text);
    }
  } catch (err) {
    console.error("שגיאה בבריפינג בוקר:", err.message);
  }
}
