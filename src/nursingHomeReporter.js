import cron from "node-cron";
import { generateReport, getReportsDirectory } from "./reportGenerator.js";
import { performDeltaScan, processUnprocessedDocuments, getScanStatus } from "./nursingHomeScanner.js";
import { getMaintenanceStats, getBudgetSummary, getProjects, getSafetyStats, getReportHistory } from "./database.js";
import { readFileSync } from "fs";
import { sendEmail, isEmailReady } from "./email.js";
import { sendDailyReport } from "./dailyReport.js";

const REPORT_TYPES = ["Q1", "Q2", "Q3", "Q4", "H1", "H2", "annual"];

// Quarter → months mapping for cron scheduling
const QUARTER_END_CRONS = {
  Q1: "0 8 1 4 *",   // April 1st (end of Q1)
  Q2: "0 8 1 7 *",   // July 1st (end of Q2/H1)
  Q3: "0 8 1 10 *",  // October 1st (end of Q3)
  Q4: "0 8 2 1 *",   // January 2nd (end of Q4/annual)
};

// ─── Schedule all automatic report generation ─────────────────────────────────

export function scheduleReports(sendMessageFn = null) {
  // ── Daily report — every day at 7:00 AM ─────────────────────────────────────
  const dailyTime = process.env.DAILY_REPORT_TIME ?? "7:00";
  const [dailyHour, dailyMin] = dailyTime.split(":").map(Number);
  const dailyCron = `${dailyMin ?? 0} ${dailyHour ?? 7} * * *`;

  cron.schedule(dailyCron, async () => {
    console.log("📊 שולח דוח יומי...");
    const ownerPhone = process.env.OWNER_PHONE;
    try {
      await sendDailyReport(sendMessageFn, ownerPhone);
    } catch (err) {
      console.error("❌ שגיאת דוח יומי:", err.message);
    }
  }, { timezone: "Asia/Jerusalem" });

  // ── OneDrive delta sync — every day at 6:00 AM (before daily report) ────────
  cron.schedule("0 6 * * *", async () => {
    console.log("🔄 סריקת שינויים יומית...");
    try {
      await performDeltaScan();
      await processUnprocessedDocuments(30);
    } catch (err) {
      console.error("❌ שגיאת סריקה יומית:", err.message);
    }
  }, { timezone: "Asia/Jerusalem" });

  // ── Weekly full processing — every Sunday at 5:00 AM ────────────────────────
  cron.schedule("0 5 * * 0", async () => {
    console.log("📋 עיבוד שבועי...");
    try {
      await processUnprocessedDocuments(100);
    } catch (err) {
      console.error("❌ שגיאת עיבוד שבועי:", err.message);
    }
  }, { timezone: "Asia/Jerusalem" });

  // Quarterly reports
  for (const [type, cronExpr] of Object.entries(QUARTER_END_CRONS)) {
    cron.schedule(cronExpr, async () => {
      const year = new Date().getFullYear();
      const prevYear = type === "Q4" ? year - 1 : year;
      console.log(`📊 יצירת דוח אוטומטי: ${type} ${prevYear}`);

      try {
        const result = await generateReport(type, prevYear);
        await notifyReportReady(result, sendMessageFn);

        // Also generate annual at end of year
        if (type === "Q4") {
          const annualResult = await generateReport("annual", prevYear);
          await notifyReportReady(annualResult, sendMessageFn);
        }
        // Also generate H1 at end of Q2
        if (type === "Q2") {
          const h1Result = await generateReport("H1", prevYear);
          await notifyReportReady(h1Result, sendMessageFn);
        }
      } catch (err) {
        console.error(`❌ שגיאת יצירת דוח ${type}:`, err.message);
      }
    }, { timezone: "Asia/Jerusalem" });
  }

  console.log("📅 לוח הזמנים לדוחות פעיל");
}

// ─── Manual report generation ─────────────────────────────────────────────────

export async function createReport(reportType, year = null) {
  if (!REPORT_TYPES.includes(reportType)) {
    throw new Error(`סוג דוח לא מוכר: ${reportType}. אפשרויות: ${REPORT_TYPES.join(", ")}`);
  }
  const reportYear = year ?? new Date().getFullYear();
  return generateReport(reportType, reportYear);
}

// ─── Notification ─────────────────────────────────────────────────────────────

async function notifyReportReady(result, sendMessageFn) {
  const { fileName, slideCount, periodLabel, year, filePath } = result;

  console.log(`📢 דוח מוכן: ${fileName}`);

  // Send WhatsApp notification
  if (sendMessageFn && process.env.OWNER_PHONE) {
    const msg =
      `📊 *דוח מוכן לאישור*\n\n` +
      `📋 ${periodLabel} ${year}\n` +
      `📄 ${slideCount} שקופיות\n` +
      `📁 ${fileName}\n\n` +
      `לשליחה במייל: /sendreport ${result.year}`;

    await sendMessageFn(process.env.OWNER_PHONE, msg).catch(() => {});
  }

  // Send email if configured
  const reportEmail = process.env.REPORT_EMAIL;
  if (isEmailReady() && reportEmail) {
    try {
      const buffer = readFileSync(filePath);
      await sendEmail({
        to: reportEmail,
        subject: `דוח ${periodLabel} ${year} — טיוטה לאישור`,
        body: buildEmailBody(result),
        attachments: [{ filename: fileName, content: buffer }],
      });
      console.log(`📧 דוח נשלח למייל: ${reportEmail}`);
    } catch (err) {
      console.error("⚠️ שגיאת שליחת מייל:", err.message);
    }
  }
}

function buildEmailBody(result) {
  return `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1B3A6B; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0;">📊 דוח ${result.periodLabel} ${result.year}</h2>
        <p style="margin: 5px 0 0;">הופק אוטומטית על ידי מערכת הדיווח</p>
      </div>
      <div style="background: #f8f9fa; padding: 20px; border: 1px solid #dee2e6;">
        <p>מצורף דוח <strong>${result.periodLabel} ${result.year}</strong> הכולל <strong>${result.slideCount} שקופיות</strong>.</p>
        <p>הדוח כולל:</p>
        <ul>
          <li>Executive Summary</li>
          <li>מדדי ביצוע (KPIs)</li>
          <li>ניתוח תקציבי</li>
          <li>דוח אחזקה</li>
          <li>סטטוס פרויקטים</li>
          <li>בטיחות ורגולציה</li>
          <li>תוכנית עבודה קדימה</li>
        </ul>
        <p style="color: #666; font-size: 12px;">הופק: ${new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}</p>
      </div>
    </div>
  `;
}

// ─── Dashboard summary (text) ─────────────────────────────────────────────────

export function getDashboardText(year = null) {
  const y = year ?? new Date().getFullYear();
  const now = new Date();
  const currentQ = Math.ceil((now.getMonth() + 1) / 3);

  const maintenance = getMaintenanceStats(y, currentQ);
  const budget      = getBudgetSummary(y, currentQ);
  const projects    = getProjects(y);
  const safety      = getSafetyStats(y, currentQ);
  const history     = getReportHistory(3);

  const closureRate = maintenance.total > 0
    ? Math.round((maintenance.closed / maintenance.total) * 100)
    : 0;

  const budgetVariance = budget.totalActual - budget.totalPlanned;
  const openSafety = safety.byStatus.find((s) => s.status === "open")?.c ?? 0;
  const completedProjects = projects.filter((p) => p.status === "completed").length;

  return (
    `📊 *Dashboard — ${y} Q${currentQ}*\n\n` +
    `⚙️ *אחזקה:*\n` +
    `  • קריאות: ${maintenance.total} (${maintenance.closed} נסגרו)\n` +
    `  • שיעור סגירה: ${closureRate}%\n` +
    `  • ממוצע סגירה: ${maintenance.avgHours ? Math.round(maintenance.avgHours) + " שעות" : "—"}\n\n` +
    `💰 *תקציב:*\n` +
    `  • מתוכנן: ₪${Math.round(budget.totalPlanned ?? 0).toLocaleString("he-IL")}\n` +
    `  • ביצוע: ₪${Math.round(budget.totalActual ?? 0).toLocaleString("he-IL")}\n` +
    `  • ${budgetVariance <= 0 ? `חיסכון: ₪${Math.round(-budgetVariance).toLocaleString("he-IL")}` : `חריגה: ₪${Math.round(budgetVariance).toLocaleString("he-IL")}`}\n\n` +
    `🏗️ *פרויקטים:*\n` +
    `  • פעילים: ${projects.filter((p) => p.status === "active").length}\n` +
    `  • הושלמו: ${completedProjects} מתוך ${projects.length}\n\n` +
    `🛡️ *בטיחות:*\n` +
    `  • ליקויים פתוחים: ${openSafety}\n` +
    `  • סה״כ אירועים: ${safety.total}\n\n` +
    `📋 *דוחות אחרונים:*\n` +
    (history.length
      ? history.map((r) => `  • ${r.report_type} ${r.year} — ${r.generated_at?.slice(0, 10)}`).join("\n")
      : "  אין דוחות עדיין")
  );
}

export { REPORT_TYPES };
