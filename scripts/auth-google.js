#!/usr/bin/env node
// One-time Google Calendar OAuth2 authorization

import "dotenv/config";
import { createInterface } from "readline";
import { getAuthUrl } from "../src/calendar.js";
import http from "http";
import { URL } from "url";

const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

console.log(`
${BOLD}${CYAN}╔══════════════════════════════════════════════╗
║        חיבור Google Calendar               ║
╚══════════════════════════════════════════════╝${RESET}
`);

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.log(`${YELLOW}${BOLD}קודם כל — צור OAuth2 credentials ב-Google:${RESET}

1. כנס ל: ${CYAN}https://console.cloud.google.com/${RESET}
2. צור פרויקט חדש (או השתמש בקיים)
3. לך ל: ${BOLD}APIs & Services → Library${RESET}
   חפש "Google Calendar API" ולחץ ${BOLD}Enable${RESET}
4. לך ל: ${BOLD}APIs & Services → Credentials${RESET}
5. לחץ ${BOLD}"+ Create Credentials" → "OAuth client ID"${RESET}
6. בחר: ${BOLD}Web application${RESET}
7. ב-"Authorized redirect URIs" הוסף:
   ${CYAN}http://localhost:${process.env.PORT || 3000}/oauth2callback${RESET}
8. לחץ Create → העתק את ${BOLD}Client ID${RESET} ו-${BOLD}Client Secret${RESET}

הוסף לקובץ ${BOLD}.env${RESET} שלך:
${CYAN}GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here${RESET}

ואז הפעל שוב: ${BOLD}npm run auth-google${RESET}
`);
  process.exit(0);
}

const authUrl = getAuthUrl();
if (!authUrl) {
  console.error("שגיאה ביצירת URL. בדוק ש-GOOGLE_CLIENT_ID ו-GOOGLE_CLIENT_SECRET מוגדרים.");
  process.exit(1);
}

console.log(`${BOLD}פתח את הקישור הבא בדפדפן:${RESET}

${CYAN}${authUrl}${RESET}

לחץ ${BOLD}Allow${RESET} → הדפדפן יועבר חזרה לשרת המקומי → הטוקן יישמר אוטומטית.
`);

// Start a temporary server to catch the OAuth callback
const port = parseInt(process.env.PORT || "3000");
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname !== "/oauth2callback") return;

  const code = url.searchParams.get("code");
  if (!code) {
    res.end("שגיאה: לא התקבל code.");
    return;
  }

  try {
    const { saveTokenFromCode } = await import("../src/calendar.js");
    await saveTokenFromCode(code);

    res.end(`
      <html><body style="font-family:sans-serif;text-align:center;padding:50px;background:#f0f9f0">
        <h2 style="color:#2d7a2d">✅ Google Calendar מחובר בהצלחה!</h2>
        <p>אפשר לסגור חלון זה.</p>
      </body></html>
    `);

    console.log(`\n${GREEN}${BOLD}✅ Google Calendar מחובר!${RESET}`);
    console.log(`\nהפעל כעת: ${CYAN}npm start${RESET}\n`);
    server.close();
    process.exit(0);
  } catch (err) {
    res.status(500).end("שגיאה: " + err.message);
    console.error("❌ שגיאה:", err.message);
    server.close();
    process.exit(1);
  }
});

server.listen(port, () => {
  console.log(`ממתין לאישור בפורט ${port}...\n`);
});

// Timeout after 5 minutes
setTimeout(() => {
  console.log("\n⌛ פסק זמן — הפעל שוב: npm run auth-google");
  server.close();
  process.exit(1);
}, 5 * 60 * 1000);
