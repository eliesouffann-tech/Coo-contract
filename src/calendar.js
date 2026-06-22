import { google } from "googleapis";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data");
const TOKEN_FILE = join(DATA_DIR, "google-token.json");

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    `http://localhost:${process.env.PORT || 3000}/oauth2callback`
  );

  if (existsSync(TOKEN_FILE)) {
    const tokens = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
    client.setCredentials(tokens);
    // Auto-save refreshed tokens
    client.on("tokens", (newTokens) => {
      const current = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
      writeFileSync(TOKEN_FILE, JSON.stringify({ ...current, ...newTokens }, null, 2));
    });
  }

  return client;
}

export function isCalendarReady() {
  return !!(process.env.GOOGLE_CLIENT_ID && existsSync(TOKEN_FILE));
}

export function getAuthUrl() {
  const client = getOAuthClient();
  if (!client) return null;
  return client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar"],
    prompt: "consent",
  });
}

export async function saveTokenFromCode(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

export async function createEvent({ title, startDatetime, endDatetime, description = "", attendees = [] }) {
  const auth = getOAuthClient();
  if (!auth || !existsSync(TOKEN_FILE)) throw new Error("Google Calendar לא מחובר");

  const calendar = google.calendar({ version: "v3", auth });
  const event = {
    summary: title,
    description,
    start: { dateTime: startDatetime, timeZone: "Asia/Jerusalem" },
    end: { dateTime: endDatetime, timeZone: "Asia/Jerusalem" },
    attendees: attendees.map((email) => ({ email })),
    reminders: { useDefault: true },
  };

  const res = await calendar.events.insert({ calendarId: "primary", resource: event });
  return { id: res.data.id, link: res.data.htmlLink, title: res.data.summary };
}

export async function listEvents(date) {
  const auth = getOAuthClient();
  if (!auth || !existsSync(TOKEN_FILE)) throw new Error("Google Calendar לא מחובר");

  const calendar = google.calendar({ version: "v3", auth });
  const day = date ? new Date(date) : new Date();
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });

  return (res.data.items ?? []).map((e) => ({
    id: e.id,
    title: e.summary,
    start: e.start.dateTime ?? e.start.date,
    end: e.end.dateTime ?? e.end.date,
    attendees: (e.attendees ?? []).map((a) => a.email),
    location: e.location,
  }));
}

export async function deleteEvent(eventId) {
  const auth = getOAuthClient();
  if (!auth || !existsSync(TOKEN_FILE)) throw new Error("Google Calendar לא מחובר");
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({ calendarId: "primary", eventId });
  return { success: true };
}

export async function getUpcomingEventsText() {
  const events = await listEvents();
  if (events.length === 0) return "אין אירועים היום";
  return events
    .map((e) => {
      const time = e.start
        ? new Date(e.start).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" })
        : "";
      return `• ${time} ${e.title}${e.location ? ` (${e.location})` : ""}`;
    })
    .join("\n");
}
