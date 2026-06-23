#!/usr/bin/env node
/**
 * Setup script for Microsoft OneDrive authentication.
 * Run with: npm run setup-onedrive
 *
 * Prerequisites:
 * 1. Register an Azure AD app at https://portal.azure.com
 * 2. Add "Files.Read.All" and "Files.ReadWrite.All" delegated permissions
 * 3. Enable "Allow public client flows" (for device code flow)
 * 4. Copy the Application (client) ID to MICROSOFT_CLIENT_ID in .env
 */

import "dotenv/config";
import { startDeviceCodeFlow, pollDeviceCodeToken } from "../src/onedrive.js";
import * as readline from "readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║          🔗 חיבור OneDrive — Microsoft Graph API            ║
╚══════════════════════════════════════════════════════════════╝

לפני שמתחילים, וודא שביצעת את הצעדים הבאים:

1. גש ל: https://portal.azure.com
2. Azure Active Directory → App registrations → New registration
3. שם: "Nursing Home Reporter" (או כל שם אחר)
4. Supported account types: "Accounts in any organizational directory and personal"
5. לחץ Register
6. בהגדרות: Authentication → Add platform → Mobile and desktop
7. בחר: urn:ietf:wg:oauth:2.0:oob
8. הפעל: "Allow public client flows"
9. API permissions → Add → Microsoft Graph → Delegated:
   ✓ Files.Read.All
   ✓ Files.ReadWrite.All
   ✓ User.Read
   ✓ offline_access
10. העתק את Application (client) ID ל-.env כ-MICROSOFT_CLIENT_ID
`);

  if (!process.env.MICROSOFT_CLIENT_ID) {
    console.error("❌ MICROSOFT_CLIENT_ID חסר ב-.env\n   הוסף: MICROSOFT_CLIENT_ID=your_app_id\n");
    process.exit(1);
  }

  console.log(`✅ Client ID: ${process.env.MICROSOFT_CLIENT_ID}\n`);
  await ask("לחץ Enter כדי להמשיך...");

  try {
    console.log("\n⏳ מייצר קוד אימות...");
    const deviceAuth = await startDeviceCodeFlow();

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    הוראות אימות                             ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  1. פתח דפדפן וגש ל:                                        ║
║     ${deviceAuth.verification_uri.padEnd(52)}║
║                                                              ║
║  2. הכנס את הקוד:                                            ║
║     ${deviceAuth.user_code.padEnd(52)}║
║                                                              ║
║  3. התחבר עם חשבון Microsoft שיש לו גישה ל-OneDrive         ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

    console.log("⏳ ממתין לאימות...");
    await pollDeviceCodeToken(deviceAuth.device_code, deviceAuth.interval ?? 5);

    console.log(`
✅ OneDrive חובר בהצלחה!

הצעד הבא — הגדר את התיקיות לסריקה ב-.env:
ONEDRIVE_SCAN_FOLDERS=["מסמכים", "תקציב", "בטיחות", "פרויקטים"]

לאחר מכן הפעל את השרת: npm start
`);
  } catch (err) {
    console.error("\n❌ שגיאה:", err.message);
    if (err.message?.includes("CLIENT_ID")) {
      console.log("   וודא ש-MICROSOFT_CLIENT_ID מוגדר ב-.env");
    }
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
