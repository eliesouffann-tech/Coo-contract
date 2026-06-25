import { buildDailyReportData, buildWeeklyReportData } from "./analytics.js";
import { getTasksText, getTasks } from "./memory.js";
import { getEmployeeRanking, getDecisions } from "./entities.js";
import { priorityEmoji } from "./priority.js";

// ─── Daily Briefing ───────────────────────────────────────────────────────────
export function generateDailyReport() {
  const d = buildDailyReportData();
  const { tasks } = d;

  let report = `☀️ *בריפינג יומי — ${d.date}*\n`;
  report += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Task summary
  report += `📊 *סטטוס משימות:*\n`;
  report += `• נפתחו היום: ${tasks.openedToday}\n`;
  report += `• נסגרו היום: ${tasks.closedToday}\n`;
  report += `• סה"כ פתוחות: ${tasks.totalOpen}\n`;
  if (tasks.overdue) report += `• ⚠️ באיחור: ${tasks.overdue}\n`;
  if (tasks.critical) report += `• 🔴 קריטי: ${tasks.critical}\n`;
  if (tasks.high) report += `• 🟠 גבוה: ${tasks.high}\n`;
  if (tasks.needsDecision) report += `• 🤔 דורש החלטת מנהל: ${tasks.needsDecision}\n`;

  // Critical tasks list
  if (tasks.criticalList?.length) {
    report += `\n🔴 *משימות קריטיות:*\n`;
    for (const t of tasks.criticalList) {
      report += `• ${t.title}\n`;
    }
  }

  // Overdue list
  if (tasks.overdueList?.length) {
    report += `\n⚠️ *משימות באיחור:*\n`;
    for (const t of tasks.overdueList) {
      const days = t.dueDate ? Math.ceil((Date.now() - new Date(t.dueDate)) / 86400000) : "?";
      report += `• ${t.title} (${days} ימים)\n`;
    }
  }

  // Patterns & alerts
  if (d.patterns?.length) {
    report += `\n🔍 *תובנות:*\n`;
    for (const p of d.patterns) {
      report += `• ${p.description}\n`;
    }
  }

  report += `\nלמידע מלא: /report-weekly`;
  return report;
}

// ─── Weekly Management Report ─────────────────────────────────────────────────
export function generateWeeklyReport() {
  const d = buildWeeklyReportData();
  const { tasks, patterns, employeeInsights, recommendations } = d;

  let report = `📊 *דוח ניהולי שבועי*\n`;
  report += `📅 ${d.period}\n`;
  report += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // KPIs
  report += `📈 *KPIs:*\n`;
  report += `| מדד | ערך |\n`;
  report += `| משימות נפתחו | ${tasks.openedThisPeriod} |\n`;
  report += `| משימות נסגרו | ${tasks.closedThisPeriod} |\n`;
  report += `| משימות פתוחות | ${tasks.open} |\n`;
  report += `| באיחור | ${tasks.overdue} |\n`;
  report += `| זמן סגירה ממוצע | ${tasks.avgCloseTimeHours ?? "—"} שעות |\n\n`;

  // Task breakdown by priority
  report += `🎯 *חלוקה לפי עדיפות:*\n`;
  for (const [level, count] of Object.entries(tasks.byPriority)) {
    if (count > 0) report += `${priorityEmoji(level)} ${level}: ${count}\n`;
  }

  // Employee ranking
  const ranking = getEmployeeRanking();
  if (ranking.length) {
    report += `\n👥 *דירוג עובדים:*\n`;
    for (const e of ranking.slice(0, 5)) {
      report += `${e.rank}. ${e.name} (${e.role}) — ציון: ${e.score}/100\n`;
      report += `   ✅ ${e.tasksCompleted}/${e.tasksAssigned} משימות | ⚠️ ${e.tasksOverdue} איחורים\n`;
    }
  }

  // Needs attention
  if (employeeInsights?.needsAttention?.length) {
    report += `\n⚠️ *דורשים תשומת לב:*\n`;
    for (const e of employeeInsights.needsAttention) {
      report += `• ${e.name} (${e.role}) — ציון: ${e.score}\n`;
    }
  }

  // Patterns
  if (patterns.length) {
    report += `\n🔍 *דפוסים שזוהו:*\n`;
    for (const p of patterns) {
      report += `• ${p.description}\n`;
      if (p.items?.length) {
        for (const item of p.items.slice(0, 3)) {
          report += `  – ${typeof item === "string" ? item : item.word ?? item.title ?? JSON.stringify(item)}\n`;
        }
      }
    }
  }

  // Decisions this week
  if (d.decisionsThisWeek > 0) {
    report += `\n📝 *החלטות השבוע:* ${d.decisionsThisWeek}\n`;
  }

  // Recommendations
  if (recommendations?.length) {
    report += `\n💡 *המלצות:*\n`;
    for (const r of recommendations) {
      report += `${r}\n`;
    }
  }

  return report;
}

// ─── Audit Mode Report ────────────────────────────────────────────────────────
export function generateAuditReport(topic = "כללי") {
  const tasks = getTasks();
  const decisions = getDecisions();
  const now = new Date().toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });

  let report = `📋 *תיק ביקורת — ${topic}*\n`;
  report += `📅 הופק: ${now}\n`;
  report += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Open tasks by category
  const open = tasks.filter(t => !t.done);
  const byPriority = {
    "קריטי": open.filter(t => t.priority === "קריטי"),
    "גבוה": open.filter(t => t.priority === "גבוה"),
    "בינוני": open.filter(t => t.priority === "בינוני"),
  };

  report += `📊 *סטטוס משימות:*\n`;
  report += `• סה"כ פתוחות: ${open.length}\n`;
  report += `• קריטיות: ${byPriority["קריטי"].length}\n`;
  report += `• גבוהות: ${byPriority["גבוה"].length}\n\n`;

  if (byPriority["קריטי"].length) {
    report += `🔴 *משימות קריטיות:*\n`;
    for (const t of byPriority["קריטי"]) {
      const days = Math.ceil((Date.now() - new Date(t.createdAt)) / 86400000);
      report += `• ${t.title}\n  (פתוחה ${days} ימים)\n`;
    }
    report += "\n";
  }

  // Recent decisions
  const recent = decisions.slice(0, 10);
  if (recent.length) {
    report += `📝 *החלטות אחרונות:*\n`;
    for (const d of recent) {
      const date = new Date(d.date).toLocaleDateString("he-IL");
      report += `• [${date}] ${d.topic}: ${d.content.slice(0, 80)}\n`;
    }
  }

  report += `\n_תיק זה הופק אוטומטית ע"י מנהל הלשכה ה-AI_`;
  return report;
}
