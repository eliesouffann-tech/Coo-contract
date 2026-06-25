import { getTasks } from "./memory.js";
import { getMessages, getEmployees, getDecisions as getDecisionsFromEntities } from "./entities.js";
import { scorePriority } from "./priority.js";

// ─── Task Analytics ───────────────────────────────────────────────────────────
export function getTaskAnalytics(days = 7) {
  const since = new Date(Date.now() - days * 86400000);
  const all = getTasks();
  const recent = all.filter(t => new Date(t.createdAt) >= since);

  const byPriority = { "קריטי": 0, "גבוה": 0, "בינוני": 0, "נמוך": 0, "ללא": 0 };
  for (const t of all.filter(t => !t.done)) {
    const p = t.priority ?? "ללא";
    byPriority[p] = (byPriority[p] ?? 0) + 1;
  }

  const overdue = all.filter(t => !t.done && t.dueDate && new Date(t.dueDate) < new Date());

  const avgCloseTime = (() => {
    const closed = all.filter(t => t.done && t.completedAt && t.createdAt);
    if (!closed.length) return null;
    const total = closed.reduce((s, t) =>
      s + (new Date(t.completedAt) - new Date(t.createdAt)), 0);
    return Math.round(total / closed.length / 3600000); // hours
  })();

  return {
    total: all.length,
    open: all.filter(t => !t.done).length,
    closed: all.filter(t => t.done).length,
    overdue: overdue.length,
    openedThisPeriod: recent.length,
    closedThisPeriod: recent.filter(t => t.done).length,
    byPriority,
    avgCloseTimeHours: avgCloseTime,
    overdueList: overdue.slice(0, 10).map(t => ({
      title: t.title, dueDate: t.dueDate,
      daysOverdue: Math.ceil((Date.now() - new Date(t.dueDate)) / 86400000),
    })),
  };
}

// ─── Pattern Detection ────────────────────────────────────────────────────────
export function detectPatterns() {
  const tasks = getTasks();
  const patterns = [];

  // Find recurring titles (similar words)
  const wordFreq = {};
  for (const t of tasks) {
    const words = t.title.split(/\s+/).filter(w => w.length > 3);
    for (const w of words) {
      wordFreq[w] = (wordFreq[w] ?? 0) + 1;
    }
  }

  const recurring = Object.entries(wordFreq)
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count, tasks: tasks.filter(t => t.title.includes(word)).slice(0, 3).map(t => t.title) }));

  if (recurring.length) {
    patterns.push({
      type: "recurring_keywords",
      description: "מילות מפתח שחוזרות במשימות",
      items: recurring,
    });
  }

  // Overdue rate analysis
  const overdueRate = tasks.length
    ? (tasks.filter(t => t.done && t.completedAt && t.dueDate && new Date(t.completedAt) > new Date(t.dueDate)).length / tasks.length * 100).toFixed(1)
    : 0;

  if (overdueRate > 20) {
    patterns.push({
      type: "high_overdue_rate",
      description: `${overdueRate}% מהמשימות נסגרות באיחור`,
      recommendation: "לשקול תאריכי יעד ריאליים יותר או חלוקת עומס",
    });
  }

  // Long-open tasks (>14 days)
  const stale = tasks.filter(t => !t.done && t.createdAt && (Date.now() - new Date(t.createdAt)) > 14 * 86400000);
  if (stale.length >= 3) {
    patterns.push({
      type: "stale_tasks",
      description: `${stale.length} משימות פתוחות מעל 14 יום`,
      items: stale.slice(0, 5).map(t => ({
        title: t.title,
        daysOpen: Math.ceil((Date.now() - new Date(t.createdAt)) / 86400000),
      })),
    });
  }

  return patterns;
}

// ─── Employee Insights ────────────────────────────────────────────────────────
export function getEmployeeInsights() {
  const employees = Object.values(getEmployees());
  if (!employees.length) return { message: "אין עובדים במערכת. הוסף עובדים דרך הסוכן." };

  const top = employees
    .filter(e => e.stats?.performanceScore != null)
    .sort((a, b) => b.stats.performanceScore - a.stats.performanceScore);

  return {
    total: employees.length,
    topPerformer: top[0] ? { name: top[0].name, score: top[0].stats.performanceScore } : null,
    needsAttention: top.slice(-3).filter(e => e.stats.performanceScore < 50).map(e => ({
      name: e.name, role: e.role, score: e.stats.performanceScore,
      overdueRate: e.stats.tasksAssigned > 0
        ? Math.round(e.stats.tasksOverdue / e.stats.tasksAssigned * 100) + "%"
        : "—",
    })),
    avgScore: employees.length ? Math.round(employees.reduce((s, e) => s + (e.stats?.performanceScore ?? 0), 0) / employees.length) : 0,
  };
}

// ─── Daily Report Data ────────────────────────────────────────────────────────
export function buildDailyReportData() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const all = getTasks();
  const openedToday = all.filter(t => new Date(t.createdAt) >= today);
  const closedToday = all.filter(t => t.done && t.completedAt && new Date(t.completedAt) >= today);
  const overdue = all.filter(t => !t.done && t.dueDate && new Date(t.dueDate) < new Date());
  const critical = all.filter(t => !t.done && t.priority === "קריטי");
  const high = all.filter(t => !t.done && t.priority === "גבוה");

  const messages = getMessages({ since: today.toISOString() });
  const patterns = detectPatterns();
  const employeeInsights = getEmployeeInsights();

  return {
    date: new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    tasks: {
      openedToday: openedToday.length,
      closedToday: closedToday.length,
      totalOpen: all.filter(t => !t.done).length,
      overdue: overdue.length,
      critical: critical.length,
      high: high.length,
      needsDecision: all.filter(t => !t.done && (t.notes ?? "").includes("החלטת מנהל")).length,
      overdueList: overdue.slice(0, 5),
      criticalList: critical.slice(0, 5),
    },
    messages: {
      todayCount: messages.length,
    },
    patterns: patterns.slice(0, 3),
    employeeInsights,
  };
}

// ─── Weekly Report Data ───────────────────────────────────────────────────────
export function buildWeeklyReportData() {
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const taskAnalytics = getTaskAnalytics(7);
  const patterns = detectPatterns();
  const employeeInsights = getEmployeeInsights();
  const decisions = getDecisionsFromEntities().filter(d => new Date(d.date) >= weekAgo);

  return {
    period: `${weekAgo.toLocaleDateString("he-IL")} – ${new Date().toLocaleDateString("he-IL")}`,
    tasks: taskAnalytics,
    patterns,
    employeeInsights,
    decisionsThisWeek: decisions.length,
    recommendations: buildRecommendations(taskAnalytics, patterns, employeeInsights),
  };
}

function buildRecommendations(tasks, patterns, empInsights) {
  const recs = [];
  if (tasks.overdue > 5) recs.push("⚠️ יש " + tasks.overdue + " משימות באיחור — לשקול חלוקת עומס מחדש.");
  if (tasks.byPriority["קריטי"] > 0) recs.push("🔴 " + tasks.byPriority["קריטי"] + " משימות קריטיות פתוחות — לטפל מיידית.");
  if (empInsights?.needsAttention?.length) {
    const names = empInsights.needsAttention.map(e => e.name).join(", ");
    recs.push(`👤 עובדים הדורשים תשומת לב: ${names}`);
  }
  for (const p of patterns) {
    if (p.recommendation) recs.push("💡 " + p.recommendation);
  }
  if (!recs.length) recs.push("✅ המצב התפעולי תקין. המשך כך!");
  return recs;
}
