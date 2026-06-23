import { db } from "./database.js";
import { sendEmail, isEmailReady } from "./email.js";

// ─── Raw queries for daily operational snapshot ───────────────────────────────

function getOpenCalls() {
  return db.prepare(`
    SELECT * FROM maintenance_records
    WHERE status = 'open' OR status = 'in_progress'
    ORDER BY date_opened ASC
  `).all();
}

function getCallsOpenedToday() {
  return db.prepare(`
    SELECT * FROM maintenance_records
    WHERE date(date_opened) = date('now', 'localtime')
  `).all();
}

function getCallsOpenedYesterday() {
  return db.prepare(`
    SELECT * FROM maintenance_records
    WHERE date(date_opened) = date('now', '-1 day', 'localtime')
  `).all();
}

function getCallsClosedYesterday() {
  return db.prepare(`
    SELECT * FROM maintenance_records
    WHERE date(date_closed) = date('now', '-1 day', 'localtime')
  `).all();
}

function getStaleOpenCalls(thresholdHours = 72) {
  return db.prepare(`
    SELECT *,
      ROUND((julianday('now') - julianday(date_opened)) * 24) AS hours_open
    FROM maintenance_records
    WHERE (status = 'open' OR status = 'in_progress')
      AND date_opened IS NOT NULL
      AND (julianday('now') - julianday(date_opened)) * 24 > ?
    ORDER BY hours_open DESC
  `).all(thresholdHours);
}

function getOpenSafetyItems() {
  return db.prepare(`
    SELECT * FROM safety_records
    WHERE status != 'closed'
    ORDER BY severity DESC, date ASC
  `).all();
}

function getActiveProjects() {
  return db.prepare(`
    SELECT *,
      CASE
        WHEN planned_budget > 0 AND actual_cost > 0
          THEN ROUND((actual_cost / planned_budget) * 100)
        ELSE NULL
      END AS budget_pct
    FROM projects
    WHERE status = 'active'
    ORDER BY start_date ASC
  `).all();
}

function getBudgetYTD() {
  const year = new Date().getFullYear();
  return db.prepare(`
    SELECT
      SUM(planned_amount) AS planned,
      SUM(actual_amount)  AS actual
    FROM budget_items
    WHERE year = ?
  `).get(year) ?? { planned: 0, actual: 0 };
}

function getMonthlyCallCount() {
  return db.prepare(`
    SELECT COUNT(*) c FROM maintenance_records
    WHERE strftime('%Y-%m', date_opened) = strftime('%Y-%m', 'now')
  `).get().c;
}

function getThisWeekCallCount() {
  return db.prepare(`
    SELECT COUNT(*) c FROM maintenance_records
    WHERE date_opened >= date('now', 'weekday 0', '-7 days', 'localtime')
  `).get().c;
}

// ─── Build daily data snapshot ────────────────────────────────────────────────

export function buildDailySnapshot() {
  const openCalls       = getOpenCalls();
  const openedToday     = getCallsOpenedToday();
  const openedYesterday = getCallsOpenedYesterday();
  const closedYesterday = getCallsClosedYesterday();
  const staleCalls      = getStaleOpenCalls(72);
  const openSafety      = getOpenSafetyItems();
  const activeProjects  = getActiveProjects();
  const budgetYTD       = getBudgetYTD();
  const monthlyCount    = getMonthlyCallCount();
  const weeklyCount     = getThisWeekCallCount();

  const budgetPct  = budgetYTD.planned > 0 ? Math.round((budgetYTD.actual / budgetYTD.planned) * 100) : null;
  const budgetDiff = (budgetYTD.actual ?? 0) - (budgetYTD.planned ?? 0);

  return {
    openCalls,
    openedToday,
    openedYesterday,
    closedYesterday,
    staleCalls,
    openSafety,
    activeProjects,
    budgetYTD,
    budgetPct,
    budgetDiff,
    monthlyCount,
    weeklyCount,
    generatedAt: new Date(),
  };
}

// ─── WhatsApp message (concise) ────────────────────────────────────────────────

export function buildWhatsAppDaily(snap) {
  const date = snap.generatedAt;
  const dayNames = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
  const dayHe = dayNames[date.getDay()];
  const dateStr = date.toLocaleDateString("he-IL", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jerusalem",
  });

  const lines = [
    `☀️ *בוקר טוב! דוח יומי — יום ${dayHe}, ${dateStr}*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  // ── Maintenance ──
  lines.push(`\n⚙️ *אחזקה:*`);
  lines.push(`• קריאות פתוחות: *${snap.openCalls.length}*`);
  lines.push(`• נפתחו אתמול: ${snap.openedYesterday.length}`);
  lines.push(`• נסגרו אתמול: ${snap.closedYesterday.length}`);
  lines.push(`• נפתחו החודש: ${snap.monthlyCount}`);

  if (snap.staleCalls.length > 0) {
    lines.push(`\n⚠️ *קריאות מעל 72 שעות — דורשות טיפול דחוף:*`);
    for (const c of snap.staleCalls.slice(0, 4)) {
      const hrs = c.hours_open ?? "?";
      lines.push(`  🔴 ${c.description?.slice(0, 45) ?? "—"}\n     📍 ${c.location ?? c.department ?? "—"} | ${hrs}ש׳ | ${c.worker ?? "לא שויך"}`);
    }
    if (snap.staleCalls.length > 4) {
      lines.push(`  ... ועוד ${snap.staleCalls.length - 4} קריאות`);
    }
  }

  if (snap.openedYesterday.length > 0) {
    lines.push(`\n📋 *נפתחו אתמול:*`);
    for (const c of snap.openedYesterday.slice(0, 3)) {
      lines.push(`  • ${c.description?.slice(0, 50) ?? "—"} (${c.department ?? "—"})`);
    }
  }

  // ── Budget ──
  if (snap.budgetYTD.planned) {
    lines.push(`\n💰 *תקציב (YTD):*`);
    const pct = snap.budgetPct ?? 0;
    const diff = snap.budgetDiff;
    lines.push(`• ביצוע: ₪${fmt(snap.budgetYTD.actual)} מתוך ₪${fmt(snap.budgetYTD.planned)} (${pct}%)`);
    lines.push(diff <= 0
      ? `• ✅ חיסכון: ₪${fmt(-diff)}`
      : `• ⚠️ חריגה: ₪${fmt(diff)}`);
  }

  // ── Projects ──
  if (snap.activeProjects.length > 0) {
    lines.push(`\n🏗️ *פרויקטים פעילים: ${snap.activeProjects.length}*`);
    for (const p of snap.activeProjects.slice(0, 4)) {
      const pct = p.budget_pct ? ` — ${p.budget_pct}% ביצוע תקציבי` : "";
      lines.push(`  • ${p.project_name?.slice(0, 40) ?? "—"}${pct}`);
    }
  }

  // ── Safety ──
  lines.push(`\n🛡️ *בטיחות:*`);
  if (snap.openSafety.length === 0) {
    lines.push(`• ✅ אין ליקויים פתוחים`);
  } else {
    lines.push(`• ⚠️ ${snap.openSafety.length} ליקויים פתוחים:`);
    for (const s of snap.openSafety.slice(0, 3)) {
      const sev = s.severity === "high" ? "🔴" : s.severity === "medium" ? "🟡" : "🟢";
      lines.push(`  ${sev} ${s.description?.slice(0, 50) ?? "—"}`);
    }
  }

  lines.push(`\n━━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`📊 לדשבורד מלא: /dashboard`);
  lines.push(`📄 לדוח רבעוני: /report Q${Math.ceil((date.getMonth() + 1) / 3)}`);

  return lines.join("\n");
}

// ─── Email HTML (detailed) ─────────────────────────────────────────────────────

export function buildEmailDailyHtml(snap) {
  const date = snap.generatedAt;
  const dateStr = date.toLocaleDateString("he-IL", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    timeZone: "Asia/Jerusalem",
  });

  const instName = process.env.NURSING_HOME_NAME ?? "בית האבות";

  // Helpers
  const row = (label, value, color = "#2B2D42") =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #EEF0F3;color:#6C757D;font-weight:600">${label}</td>
     <td style="padding:8px 12px;border-bottom:1px solid #EEF0F3;color:${color};font-weight:700">${value}</td></tr>`;

  const kpi = (label, value, sub, color = "#1B3A6B") =>
    `<div style="background:#F0F2F5;border-radius:10px;padding:16px;border-top:4px solid ${color};text-align:center;min-width:130px">
      <div style="font-size:11px;color:#6C757D;font-weight:600;margin-bottom:4px">${label}</div>
      <div style="font-size:28px;font-weight:800;color:${color};line-height:1">${value}</div>
      ${sub ? `<div style="font-size:10px;color:#6C757D;margin-top:4px">${sub}</div>` : ""}
    </div>`;

  const badge = (text, bg, color) =>
    `<span style="background:${bg};color:${color};padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600">${text}</span>`;

  const budgetPct = snap.budgetPct ?? 0;
  const budgetColor = snap.budgetDiff <= 0 ? "#2D6A4F" : "#C1121F";

  // Stale calls table
  let staleTable = "";
  if (snap.staleCalls.length > 0) {
    const rows = snap.staleCalls.slice(0, 8).map((c, i) => `
      <tr style="background:${i % 2 === 0 ? "#FFF5F5" : "white"}">
        <td style="padding:8px 12px;border-bottom:1px solid #FEE2E2">${c.call_number ?? "—"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #FEE2E2">${(c.description ?? "").slice(0, 55)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #FEE2E2">${c.location ?? c.department ?? "—"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #FEE2E2">${c.worker ?? "לא שויך"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #FEE2E2;color:#C1121F;font-weight:700">${c.hours_open ?? "?"}ש׳</td>
      </tr>`).join("");

    staleTable = `
      <div style="margin-bottom:24px">
        <div style="background:#C1121F;color:white;padding:10px 16px;border-radius:8px 8px 0 0;font-weight:700;font-size:14px">
          ⚠️ קריאות מעל 72 שעות — דורשות טיפול דחוף (${snap.staleCalls.length})
        </div>
        <div style="border:1px solid #FEE2E2;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
          <table width="100%" cellspacing="0" style="font-size:13px">
            <thead><tr style="background:#FEF2F2">
              <th style="padding:8px 12px;text-align:right;color:#6C757D">מספר</th>
              <th style="padding:8px 12px;text-align:right;color:#6C757D">תיאור</th>
              <th style="padding:8px 12px;text-align:right;color:#6C757D">מיקום</th>
              <th style="padding:8px 12px;text-align:right;color:#6C757D">עובד</th>
              <th style="padding:8px 12px;text-align:right;color:#6C757D">שעות פתוח</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  // Active projects table
  let projectsTable = "";
  if (snap.activeProjects.length > 0) {
    const rows = snap.activeProjects.map((p, i) => {
      const pct = p.budget_pct;
      const overrun = p.actual_cost > p.planned_budget * 1.1;
      const barColor = overrun ? "#C1121F" : "#2D6A4F";
      const bar = pct != null
        ? `<div style="background:#EEF0F3;border-radius:4px;height:8px;overflow:hidden">
             <div style="background:${barColor};width:${Math.min(pct, 100)}%;height:8px"></div>
           </div><div style="font-size:11px;color:${barColor};font-weight:600;margin-top:2px">${pct}%</div>`
        : "—";
      return `<tr style="background:${i % 2 === 0 ? "#F8F9FA" : "white"}">
        <td style="padding:9px 12px;border-bottom:1px solid #EEF0F3">${p.project_name ?? "—"}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #EEF0F3">${p.department ?? "—"}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #EEF0F3">₪${fmt(p.planned_budget)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #EEF0F3;color:${overrun?"#C1121F":"inherit"};font-weight:${overrun?700:400}">₪${fmt(p.actual_cost)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #EEF0F3;min-width:120px">${bar}</td>
      </tr>`;
    }).join("");

    projectsTable = `
      <div style="margin-bottom:24px">
        <div style="background:#1B3A6B;color:white;padding:10px 16px;border-radius:8px 8px 0 0;font-weight:700;font-size:14px">
          🏗️ פרויקטים פעילים (${snap.activeProjects.length})
        </div>
        <div style="border:1px solid #DEE2E6;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
          <table width="100%" cellspacing="0" style="font-size:13px">
            <thead><tr style="background:#F0F2F5">
              <th style="padding:8px 12px;text-align:right;color:#6C757D">פרויקט</th>
              <th style="padding:8px 12px;text-align:right;color:#6C757D">מחלקה</th>
              <th style="padding:8px 12px;text-align:right;color:#6C757D">תקציב</th>
              <th style="padding:8px 12px;text-align:right;color:#6C757D">ביצוע</th>
              <th style="padding:8px 12px;text-align:right;color:#6C757D">% תקציב</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  // Safety items
  let safetySection = "";
  if (snap.openSafety.length > 0) {
    const items = snap.openSafety.slice(0, 6).map(s => {
      const color = s.severity === "high" ? "#C1121F" : s.severity === "medium" ? "#E76F51" : "#2D6A4F";
      const icon  = s.severity === "high" ? "🔴" : s.severity === "medium" ? "🟡" : "🟢";
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #EEF0F3">${s.date ?? "—"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #EEF0F3">${s.type ?? "—"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #EEF0F3">${(s.description ?? "").slice(0, 60)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #EEF0F3;color:${color};font-weight:700">${icon} ${s.severity === "high" ? "גבוהה" : s.severity === "medium" ? "בינונית" : "נמוכה"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #EEF0F3">${s.location ?? "—"}</td>
      </tr>`;
    }).join("");

    safetySection = `
      <div style="margin-bottom:24px">
        <div style="background:#E76F51;color:white;padding:10px 16px;border-radius:8px 8px 0 0;font-weight:700;font-size:14px">
          🛡️ ליקויי בטיחות פתוחים (${snap.openSafety.length})
        </div>
        <div style="border:1px solid #FDDCCC;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
          <table width="100%" cellspacing="0" style="font-size:13px">
            <thead><tr style="background:#FFF5EF">
              <th style="padding:8px 12px;text-align:right;color:#6C757D">תאריך</th>
              <th style="padding:8px 12px;text-align:right;color:#6C757D">סוג</th>
              <th style="padding:8px 12px;text-align:right;color:#6C757D">תיאור</th>
              <th style="padding:8px 12px;text-align:right;color:#6C757D">חומרה</th>
              <th style="padding:8px 12px;text-align:right;color:#6C757D">מיקום</th>
            </tr></thead>
            <tbody>${items}</tbody>
          </table>
        </div>
      </div>`;
  } else {
    safetySection = `
      <div style="background:#DCFCE7;border:1px solid #BBF7D0;border-radius:8px;padding:14px 16px;margin-bottom:24px;text-align:center;color:#2D6A4F;font-weight:700">
        ✅ אין ליקויי בטיחות פתוחים
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#EAECF0;font-family:Arial,sans-serif;direction:rtl">
<div style="max-width:700px;margin:0 auto;background:white">

  <!-- Header -->
  <div style="background:#1B3A6B;padding:24px;text-align:center">
    <div style="color:#C5A028;font-size:13px;font-weight:600;margin-bottom:4px">📊 דוח יומי</div>
    <div style="color:white;font-size:22px;font-weight:800">${instName}</div>
    <div style="color:#99B3D0;font-size:13px;margin-top:4px">${dateStr}</div>
  </div>

  <!-- Gold line -->
  <div style="height:4px;background:#C5A028"></div>

  <div style="padding:24px">

    <!-- KPIs -->
    <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-bottom:28px">
      ${kpi("קריאות פתוחות", snap.openCalls.length, "סה״כ", snap.openCalls.length > 10 ? "#E76F51" : "#1B3A6B")}
      ${kpi("נפתחו אתמול", snap.openedYesterday.length, "קריאות", "#0077B6")}
      ${kpi("נסגרו אתמול", snap.closedYesterday.length, "קריאות", "#2D6A4F")}
      ${kpi("ליקויי בטיחות", snap.openSafety.length, "פתוחים", snap.openSafety.length > 0 ? "#C1121F" : "#2D6A4F")}
      ${kpi("פרויקטים פעילים", snap.activeProjects.length, "בתהליך", "#0077B6")}
      ${kpi("ביצוע תקציבי", budgetPct !== null ? budgetPct + "%" : "—", "YTD", budgetColor)}
    </div>

    <!-- Budget bar -->
    ${snap.budgetYTD.planned ? `
    <div style="background:#F0F2F5;border-radius:10px;padding:16px;margin-bottom:24px">
      <div style="font-size:14px;font-weight:700;color:#1B3A6B;margin-bottom:10px">💰 תקציב שנתי (YTD)</div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#6C757D;margin-bottom:6px">
        <span>ביצוע: ₪${fmt(snap.budgetYTD.actual)}</span>
        <span>מתוכנן: ₪${fmt(snap.budgetYTD.planned)}</span>
      </div>
      <div style="background:#DEE2E6;border-radius:6px;height:12px;overflow:hidden">
        <div style="background:${budgetColor};width:${Math.min(budgetPct ?? 0, 100)}%;height:12px;border-radius:6px"></div>
      </div>
      <div style="font-size:12px;margin-top:8px;font-weight:700;color:${budgetColor}">
        ${snap.budgetDiff <= 0 ? `✅ חיסכון: ₪${fmt(-snap.budgetDiff)}` : `⚠️ חריגה: ₪${fmt(snap.budgetDiff)}`}
      </div>
    </div>` : ""}

    <!-- Stale calls -->
    ${staleTable}

    <!-- Yesterday's calls -->
    ${snap.openedYesterday.length > 0 ? `
    <div style="margin-bottom:24px">
      <div style="background:#0077B6;color:white;padding:10px 16px;border-radius:8px 8px 0 0;font-weight:700;font-size:14px">
        📋 קריאות שנפתחו אתמול (${snap.openedYesterday.length})
      </div>
      <div style="border:1px solid #DBEAFE;border-top:none;border-radius:0 0 8px 8px">
        ${snap.openedYesterday.map((c, i) => `
          <div style="padding:10px 16px;${i > 0 ? "border-top:1px solid #EEF0F3" : ""};background:${i % 2 === 0 ? "#F0F8FF" : "white"}">
            <strong style="color:#1B3A6B">${(c.description ?? "").slice(0, 60)}</strong>
            <span style="color:#6C757D;font-size:12px"> — ${c.location ?? ""} ${c.department ?? ""} | ${c.worker ?? "לא שויך"}</span>
          </div>`).join("")}
      </div>
    </div>` : ""}

    <!-- Projects -->
    ${projectsTable}

    <!-- Safety -->
    ${safetySection}

  </div>

  <!-- Footer -->
  <div style="background:#F0F2F5;padding:16px 24px;text-align:center;border-top:1px solid #DEE2E6">
    <div style="color:#6C757D;font-size:11px">
      הופק אוטומטית · ${snap.generatedAt.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })} · ${instName}
    </div>
  </div>

</div>
</body>
</html>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null || isNaN(n)) return "—";
  return Math.round(n).toLocaleString("he-IL");
}

// ─── Send daily report ────────────────────────────────────────────────────────

export async function sendDailyReport(sendWhatsAppFn, ownerPhone) {
  const snap = buildDailySnapshot();

  // WhatsApp
  if (sendWhatsAppFn && ownerPhone) {
    const msg = buildWhatsAppDaily(snap);
    await sendWhatsAppFn(ownerPhone, msg).catch((e) =>
      console.error("⚠️ Daily WhatsApp error:", e.message)
    );
    console.log("📱 דוח יומי נשלח ב-WhatsApp");
  }

  // Email
  const reportEmail = process.env.REPORT_EMAIL ?? process.env.EMAIL_ADDRESS;
  if (isEmailReady() && reportEmail) {
    const date = snap.generatedAt.toLocaleDateString("he-IL", {
      weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem",
    });
    await sendEmail({
      to: reportEmail,
      subject: `📊 דוח יומי — ${date}`,
      body: buildEmailDailyHtml(snap),
    }).catch((e) => console.error("⚠️ Daily email error:", e.message));
    console.log("📧 דוח יומי נשלח במייל");
  }

  return snap;
}

// ─── Text summary for WhatsApp /daily command ────────────────────────────────

export function getDailySummaryText() {
  return buildWhatsAppDaily(buildDailySnapshot());
}
