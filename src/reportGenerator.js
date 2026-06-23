import PptxGenJS from "pptxgenjs";
import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  getMaintenanceStats,
  getBudgetSummary,
  getProjects,
  getSafetyStats,
  getReportHistory,
  logReport,
} from "./database.js";
import { generateExecutiveSummary } from "./aiAnalyzer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, "..", "reports");
mkdirSync(REPORTS_DIR, { recursive: true });

// ─── Design system ────────────────────────────────────────────────────────────

const C = {
  navy:      "1B3A6B",
  gold:      "C5A028",
  green:     "2D6A4F",
  red:       "C1121F",
  amber:     "E76F51",
  white:     "FFFFFF",
  lightGray: "F0F2F5",
  darkGray:  "2B2D42",
  midGray:   "6C757D",
  teal:      "0077B6",
  chartBlue: "1B3A6B",
  chartGreen:"2D6A4F",
  chartGold: "C5A028",
  chartRed:  "E63946",
  chartTeal: "0077B6",
};

const FONT = "Arial";

const PERIOD_LABELS = {
  Q1: "רבעון 1 (ינואר–מרץ)",
  Q2: "רבעון 2 (אפריל–יוני)",
  Q3: "רבעון 3 (יולי–ספטמבר)",
  Q4: "רבעון 4 (אוקטובר–דצמבר)",
  H1: "חציון ראשון (ינואר–יוני)",
  H2: "חציון שני (יולי–דצמבר)",
  annual: "דוח שנתי",
};

const QUARTER_MAP = { Q1: 1, Q2: 2, Q3: 3, Q4: 4, H1: null, H2: null, annual: null };

function fmt(n, prefix = "₪") {
  if (n == null || isNaN(n)) return "—";
  return `${prefix}${Math.round(n).toLocaleString("he-IL")}`;
}

function fmtHours(h) {
  if (!h) return "—";
  if (h < 1) return `${Math.round(h * 60)} דקות`;
  return `${Math.round(h)} שעות`;
}

function pct(actual, planned) {
  if (!planned) return "—";
  return `${Math.round((actual / planned) * 100)}%`;
}

// ─── Slide helpers ─────────────────────────────────────────────────────────────

function addSlide(prs, layout = "LAYOUT_WIDE") {
  const slide = prs.addSlide();
  slide.background = { color: C.white };
  return slide;
}

function addHeader(slide, title, subtitle = null) {
  // Header bar
  slide.addShape("rect", {
    x: 0, y: 0, w: "100%", h: 1.2,
    fill: { color: C.navy },
  });

  // Title text
  slide.addText(title, {
    x: 0.3, y: 0.1, w: 9.1, h: 0.7,
    fontSize: 24, bold: true, color: C.white,
    fontFace: FONT, rtlMode: true, align: "right",
  });

  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.3, y: 0.78, w: 9.1, h: 0.35,
      fontSize: 12, color: C.gold,
      fontFace: FONT, rtlMode: true, align: "right",
    });
  }
}

function addFooter(slide, pageNum, totalPages, periodLabel, year) {
  slide.addShape("rect", {
    x: 0, y: 7.1, w: "100%", h: 0.4,
    fill: { color: C.lightGray },
  });
  slide.addText(`${periodLabel} | ${year}`, {
    x: 0.3, y: 7.12, w: 6, h: 0.3,
    fontSize: 9, color: C.midGray, fontFace: FONT, rtlMode: true, align: "right",
  });
  slide.addText(`${pageNum} / ${totalPages}`, {
    x: 7, y: 7.12, w: 2.5, h: 0.3,
    fontSize: 9, color: C.midGray, fontFace: FONT, align: "left",
  });
}

function addKpiBox(slide, x, y, w, h, label, value, subtext = null, color = C.navy) {
  slide.addShape("rect", {
    x, y, w, h, fill: { color: C.lightGray },
    line: { color: color, width: 2 },
    shadow: { type: "outer", blur: 3, offset: 2, angle: 45, color: "AAAAAA" },
  });
  slide.addText(value, {
    x: x + 0.1, y: y + 0.15, w: w - 0.2, h: h * 0.45,
    fontSize: 28, bold: true, color: color,
    fontFace: FONT, align: "center",
  });
  slide.addText(label, {
    x: x + 0.1, y: y + h * 0.55, w: w - 0.2, h: h * 0.25,
    fontSize: 11, color: C.darkGray,
    fontFace: FONT, align: "center", rtlMode: true,
  });
  if (subtext) {
    slide.addText(subtext, {
      x: x + 0.1, y: y + h * 0.8, w: w - 0.2, h: h * 0.18,
      fontSize: 9, color: C.midGray,
      fontFace: FONT, align: "center", rtlMode: true,
    });
  }
}

function varianceColor(variance) {
  if (variance > 0) return C.green;
  if (variance < -5000) return C.red;
  return C.amber;
}

// ─── Cover slide ──────────────────────────────────────────────────────────────

function buildCoverSlide(prs, config) {
  const slide = prs.addSlide();
  slide.background = { color: C.navy };

  // Top stripe
  slide.addShape("rect", {
    x: 0, y: 0, w: "100%", h: 0.15, fill: { color: C.gold },
  });

  // Decorative circle
  slide.addShape("ellipse", {
    x: -0.5, y: 5, w: 3, h: 3,
    fill: { color: C.teal, alpha: 20 },
    line: { color: C.teal, width: 0 },
  });

  // Institution name
  slide.addText(config.institutionName ?? "בית האבות", {
    x: 0.5, y: 1.2, w: 9, h: 0.9,
    fontSize: 32, bold: true, color: C.gold,
    fontFace: FONT, rtlMode: true, align: "center",
  });

  // Divider
  slide.addShape("rect", {
    x: 2, y: 2.3, w: 6, h: 0.06, fill: { color: C.gold },
  });

  // Report title
  slide.addText(config.reportTitle, {
    x: 0.5, y: 2.5, w: 9, h: 0.8,
    fontSize: 26, bold: true, color: C.white,
    fontFace: FONT, rtlMode: true, align: "center",
  });

  // Period
  slide.addText(config.periodLabel, {
    x: 0.5, y: 3.4, w: 9, h: 0.6,
    fontSize: 20, color: C.lightGray,
    fontFace: FONT, rtlMode: true, align: "center",
  });

  slide.addText(String(config.year), {
    x: 0.5, y: 4.0, w: 9, h: 0.5,
    fontSize: 18, color: C.gold,
    fontFace: FONT, align: "center",
  });

  // Prepared by
  slide.addText(`הוכן על ידי: ${config.preparedBy ?? "מנהל התפעול"}`, {
    x: 0.5, y: 5.5, w: 9, h: 0.4,
    fontSize: 13, color: C.lightGray,
    fontFace: FONT, rtlMode: true, align: "center",
  });

  slide.addText(`הופק אוטומטית: ${new Date().toLocaleDateString("he-IL")}`, {
    x: 0.5, y: 5.95, w: 9, h: 0.35,
    fontSize: 11, color: C.midGray,
    fontFace: FONT, rtlMode: true, align: "center",
  });

  // Bottom stripe
  slide.addShape("rect", {
    x: 0, y: 7.3, w: "100%", h: 0.2, fill: { color: C.gold },
  });
}

// ─── Executive Summary slide ──────────────────────────────────────────────────

function buildExecutiveSummarySlide(prs, summaryText, periodLabel, year) {
  const slide = addSlide(prs);
  addHeader(slide, "Executive Summary — סיכום ניהולי", periodLabel);

  slide.addText(summaryText, {
    x: 0.4, y: 1.35, w: 9.2, h: 5.6,
    fontSize: 13, color: C.darkGray,
    fontFace: FONT, rtlMode: true, align: "right",
    valign: "top",
    breakLine: true,
    paraSpaceAfter: 6,
  });
  return slide;
}

// ─── KPI Dashboard slide ──────────────────────────────────────────────────────

function buildKpiSlide(prs, maintenanceStats, budgetSummary, safetyStats, projects, periodLabel, year) {
  const slide = addSlide(prs);
  addHeader(slide, "מדדי ביצוע מרכזיים (KPIs)", periodLabel);

  const closureRate = maintenanceStats.total > 0
    ? Math.round((maintenanceStats.closed / maintenanceStats.total) * 100)
    : 0;

  const budgetVariancePct = budgetSummary.totalPlanned > 0
    ? Math.round(((budgetSummary.totalActual - budgetSummary.totalPlanned) / budgetSummary.totalPlanned) * 100)
    : 0;

  const completedProjects = projects.filter((p) => p.status === "completed").length;
  const openSafety = safetyStats.byStatus.find((s) => s.status === "open")?.c ?? 0;

  const kpis = [
    { label: "קריאות אחזקה שנפתחו", value: String(maintenanceStats.total), sub: "סה״כ קריאות", color: C.navy },
    { label: "שיעור סגירת קריאות", value: `${closureRate}%`, sub: `${maintenanceStats.closed} נסגרו`, color: closureRate >= 80 ? C.green : C.amber },
    { label: "זמן טיפול ממוצע", value: fmtHours(maintenanceStats.avgHours), sub: "ממוצע לסגירה", color: C.teal },
    { label: "ביצוע תקציבי", value: budgetVariancePct > 0 ? `+${budgetVariancePct}%` : `${budgetVariancePct}%`, sub: budgetVariancePct <= 0 ? "חיסכון" : "חריגה", color: budgetVariancePct <= 0 ? C.green : C.red },
    { label: "פרויקטים הושלמו", value: String(completedProjects), sub: `מתוך ${projects.length} פרויקטים`, color: C.green },
    { label: "ליקויי בטיחות פתוחים", value: String(openSafety), sub: "ממתינים לטיפול", color: openSafety === 0 ? C.green : C.red },
  ];

  const positions = [
    [0.25, 1.4], [3.45, 1.4], [6.65, 1.4],
    [0.25, 4.05], [3.45, 4.05], [6.65, 4.05],
  ];

  kpis.forEach(({ label, value, sub, color }, i) => {
    const [x, y] = positions[i];
    addKpiBox(slide, x, y, 2.9, 2.4, label, value, sub, color);
  });
}

// ─── Budget slides ────────────────────────────────────────────────────────────

function buildBudgetSlides(prs, budgetSummary, periodLabel, year) {
  // Overview slide
  const slide1 = addSlide(prs);
  addHeader(slide1, "תקציב — סקירה כללית", periodLabel);

  const variance = budgetSummary.totalActual - budgetSummary.totalPlanned;
  const varPct = budgetSummary.totalPlanned > 0
    ? Math.round((variance / budgetSummary.totalPlanned) * 100)
    : 0;

  // Summary boxes
  addKpiBox(slide1, 0.3, 1.4, 2.8, 1.8, "תקציב מתוכנן", fmt(budgetSummary.totalPlanned), null, C.navy);
  addKpiBox(slide1, 3.5, 1.4, 2.8, 1.8, "ביצוע בפועל", fmt(budgetSummary.totalActual), null, C.teal);
  addKpiBox(slide1, 6.7, 1.4, 2.8, 1.8, "חיסכון / חריגה",
    variance <= 0 ? fmt(-variance) : `+${fmt(variance)}`,
    variance <= 0 ? "חיסכון" : "חריגה",
    variance <= 0 ? C.green : C.red,
  );

  // Bar chart — planned vs actual by category
  if (budgetSummary.byCategory?.length > 0) {
    const chartData = [
      {
        name: "תקציב מתוכנן",
        labels: budgetSummary.byCategory.map((c) => c.category ?? "אחר"),
        values: budgetSummary.byCategory.map((c) => Math.round(c.planned ?? 0)),
      },
      {
        name: "ביצוע בפועל",
        labels: budgetSummary.byCategory.map((c) => c.category ?? "אחר"),
        values: budgetSummary.byCategory.map((c) => Math.round(c.actual ?? 0)),
      },
    ];

    slide1.addChart("bar", chartData, {
      x: 0.3, y: 3.4, w: 9.4, h: 3.5,
      chartColors: [C.chartBlue, C.chartTeal],
      dataLabelFontSize: 9,
      showTitle: false,
      showLegend: true,
      legendPos: "b",
      valAxisDisplayUnit: "thousands",
      valAxisDisplayUnitLabel: true,
    });
  } else {
    slide1.addText("אין נתוני תקציב לתקופה זו", {
      x: 0.3, y: 3.5, w: 9.4, h: 2,
      fontSize: 16, color: C.midGray, align: "center", fontFace: FONT,
    });
  }

  // Variance table slide
  if (budgetSummary.byCategory?.length > 0) {
    const slide2 = addSlide(prs);
    addHeader(slide2, "תקציב — פירוט לפי קטגוריה", periodLabel);

    const rows = [
      [
        { text: "קטגוריה", options: { bold: true, color: C.white, fill: C.navy, align: "center" } },
        { text: "מתוכנן", options: { bold: true, color: C.white, fill: C.navy, align: "center" } },
        { text: "ביצוע", options: { bold: true, color: C.white, fill: C.navy, align: "center" } },
        { text: "חריגה/חיסכון", options: { bold: true, color: C.white, fill: C.navy, align: "center" } },
        { text: "% ביצוע", options: { bold: true, color: C.white, fill: C.navy, align: "center" } },
      ],
      ...budgetSummary.byCategory.map((cat, i) => {
        const v = cat.variance ?? 0;
        const vColor = v >= 0 ? C.green : C.red;
        const bg = i % 2 === 0 ? "F8F9FA" : C.white;
        return [
          { text: cat.category ?? "—", options: { fill: bg, rtlMode: true, align: "right" } },
          { text: fmt(cat.planned), options: { fill: bg, align: "center" } },
          { text: fmt(cat.actual), options: { fill: bg, align: "center" } },
          { text: v >= 0 ? fmt(v) : `-${fmt(-v)}`, options: { fill: bg, color: vColor, bold: true, align: "center" } },
          { text: pct(cat.actual, cat.planned), options: { fill: bg, align: "center" } },
        ];
      }),
    ];

    slide2.addTable(rows, {
      x: 0.3, y: 1.4, w: 9.4,
      fontSize: 11, fontFace: FONT,
      border: { type: "solid", color: "DDDDDD", pt: 0.5 },
      rowH: 0.42,
    });
  }
}

// ─── Maintenance slides ───────────────────────────────────────────────────────

function buildMaintenanceSlides(prs, stats, periodLabel, year) {
  const slide1 = addSlide(prs);
  addHeader(slide1, "אחזקה — סקירה כללית", periodLabel);

  const closureRate = stats.total > 0 ? Math.round((stats.closed / stats.total) * 100) : 0;

  // KPIs
  const kpiData = [
    { l: "קריאות שנפתחו", v: String(stats.total), c: C.navy },
    { l: "קריאות שנסגרו", v: String(stats.closed), c: C.green },
    { l: "קריאות פתוחות", v: String(stats.open), c: stats.open > 10 ? C.red : C.amber },
    { l: "שיעור סגירה", v: `${closureRate}%`, c: closureRate >= 80 ? C.green : C.amber },
  ];
  kpiData.forEach(({ l, v, c }, i) => {
    addKpiBox(slide1, 0.25 + i * 2.45, 1.4, 2.2, 1.8, l, v, null, c);
  });

  slide1.addText(`ממוצע סגירה: ${fmtHours(stats.avgHours)}`, {
    x: 0.3, y: 3.35, w: 9.4, h: 0.4,
    fontSize: 14, bold: true, color: C.navy,
    fontFace: FONT, rtlMode: true, align: "center",
  });

  // Monthly trend chart
  if (stats.monthlyTrend?.length > 0) {
    const monthNames = ["", "ינו׳","פבר׳","מרץ","אפר׳","מאי","יוני","יולי","אוג׳","ספט׳","אוק׳","נוב׳","דצמ׳"];
    const chartData = [{
      name: "קריאות שנפתחו",
      labels: stats.monthlyTrend.map((m) => monthNames[parseInt(m.m)] ?? m.m),
      values: stats.monthlyTrend.map((m) => m.c),
    }];

    slide1.addChart("line", chartData, {
      x: 0.3, y: 3.85, w: 9.4, h: 2.9,
      chartColors: [C.chartBlue],
      lineDataSymbol: "circle",
      lineDataSymbolSize: 8,
      dataLabelFontSize: 10,
      showLegend: false,
      showTitle: false,
    });
  }

  // By department slide
  if (stats.byDepartment?.length > 0) {
    const slide2 = addSlide(prs);
    addHeader(slide2, "אחזקה — חלוקה לפי מחלקה ועובד", periodLabel);

    // By department chart
    slide2.addText("לפי מחלקה", {
      x: 0.3, y: 1.35, w: 4.5, h: 0.4,
      fontSize: 14, bold: true, color: C.navy, fontFace: FONT, rtlMode: true,
    });

    slide2.addChart("bar", [{
      name: "קריאות",
      labels: stats.byDepartment.slice(0, 8).map((d) => d.department ?? "לא ידוע"),
      values: stats.byDepartment.slice(0, 8).map((d) => d.c),
    }], {
      x: 0.3, y: 1.8, w: 4.5, h: 4.8,
      chartColors: [C.chartBlue],
      barDir: "bar",
      showLegend: false,
      showTitle: false,
      dataLabelFontSize: 10,
    });

    // By worker table
    if (stats.byWorker?.length > 0) {
      slide2.addText("לפי עובד", {
        x: 5.2, y: 1.35, w: 4.5, h: 0.4,
        fontSize: 14, bold: true, color: C.navy, fontFace: FONT, rtlMode: true,
      });

      const rows = [
        [
          { text: "עובד", options: { bold: true, color: C.white, fill: C.navy } },
          { text: "קריאות", options: { bold: true, color: C.white, fill: C.navy, align: "center" } },
        ],
        ...stats.byWorker.slice(0, 10).map((w, i) => [
          { text: w.worker ?? "לא ידוע", options: { fill: i % 2 === 0 ? "F8F9FA" : C.white, rtlMode: true } },
          { text: String(w.c), options: { fill: i % 2 === 0 ? "F8F9FA" : C.white, align: "center" } },
        ]),
      ];

      slide2.addTable(rows, {
        x: 5.2, y: 1.8, w: 4.5,
        fontSize: 11, fontFace: FONT,
        border: { type: "solid", color: "DDDDDD", pt: 0.5 },
        rowH: 0.38,
      });
    }
  }

  // By category chart
  if (stats.byCategory?.length > 0) {
    const slide3 = addSlide(prs);
    addHeader(slide3, "אחזקה — חלוקה לפי סוג תקלה", periodLabel);

    slide3.addChart("pie", [{
      name: "קריאות",
      labels: stats.byCategory.map((c) => c.category ?? "אחר"),
      values: stats.byCategory.map((c) => c.c),
    }], {
      x: 0.5, y: 1.4, w: 5, h: 5.5,
      chartColors: [C.chartBlue, C.chartGreen, C.chartGold, C.chartRed, C.chartTeal, "9B5DE5", "F15BB5"],
      showLegend: true,
      legendPos: "r",
      dataLabelFontSize: 11,
      showTitle: false,
    });

    // Category breakdown table
    const rows = [
      [
        { text: "קטגוריה", options: { bold: true, color: C.white, fill: C.navy } },
        { text: "כמות", options: { bold: true, color: C.white, fill: C.navy, align: "center" } },
        { text: "אחוז", options: { bold: true, color: C.white, fill: C.navy, align: "center" } },
      ],
      ...stats.byCategory.map((cat, i) => [
        { text: cat.category ?? "אחר", options: { fill: i % 2 === 0 ? "F8F9FA" : C.white, rtlMode: true } },
        { text: String(cat.c), options: { fill: i % 2 === 0 ? "F8F9FA" : C.white, align: "center" } },
        { text: pct(cat.c, stats.total), options: { fill: i % 2 === 0 ? "F8F9FA" : C.white, align: "center" } },
      ]),
    ];

    slide3.addTable(rows, {
      x: 5.8, y: 1.4, w: 3.9,
      fontSize: 11, fontFace: FONT,
      border: { type: "solid", color: "DDDDDD", pt: 0.5 },
      rowH: 0.4,
    });
  }
}

// ─── Projects slides ──────────────────────────────────────────────────────────

function buildProjectsSlides(prs, projects, periodLabel, year) {
  if (projects.length === 0) return;

  const slide = addSlide(prs);
  addHeader(slide, "פרויקטים — סטטוס וסיכום", periodLabel);

  const statusLabel = {
    completed: { label: "הושלם", color: C.green },
    active:    { label: "פעיל",  color: C.teal },
    planned:   { label: "מתוכנן", color: C.navy },
    on_hold:   { label: "מוקפא", color: C.amber },
  };

  // Status summary
  const byStatus = {};
  for (const p of projects) {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  }

  let x = 0.3;
  for (const [status, count] of Object.entries(byStatus)) {
    const s = statusLabel[status] ?? { label: status, color: C.navy };
    addKpiBox(slide, x, 1.35, 2.1, 1.5, s.label, String(count), "פרויקטים", s.color);
    x += 2.3;
  }

  // Projects table
  const rows = [
    [
      { text: "שם הפרויקט", options: { bold: true, color: C.white, fill: C.navy } },
      { text: "סטטוס", options: { bold: true, color: C.white, fill: C.navy, align: "center" } },
      { text: "תקציב", options: { bold: true, color: C.white, fill: C.navy, align: "center" } },
      { text: "עלות בפועל", options: { bold: true, color: C.white, fill: C.navy, align: "center" } },
      { text: "מחלקה", options: { bold: true, color: C.white, fill: C.navy, align: "center" } },
    ],
    ...projects.slice(0, 12).map((p, i) => {
      const s = statusLabel[p.status] ?? { label: p.status, color: C.navy };
      const bg = i % 2 === 0 ? "F8F9FA" : C.white;
      const hasOverrun = p.actual_cost > p.planned_budget * 1.1;
      return [
        { text: p.project_name ?? "—", options: { fill: bg, rtlMode: true, align: "right" } },
        { text: s.label, options: { fill: bg, color: s.color, bold: true, align: "center" } },
        { text: fmt(p.planned_budget), options: { fill: bg, align: "center" } },
        { text: fmt(p.actual_cost), options: { fill: bg, color: hasOverrun ? C.red : C.darkGray, align: "center" } },
        { text: p.department ?? "—", options: { fill: bg, rtlMode: true, align: "center" } },
      ];
    }),
  ];

  slide.addTable(rows, {
    x: 0.3, y: 2.95, w: 9.4,
    fontSize: 10.5, fontFace: FONT,
    border: { type: "solid", color: "DDDDDD", pt: 0.5 },
    rowH: 0.4,
  });

  // Budget chart for projects
  const projectsWithBudget = projects.filter((p) => p.planned_budget || p.actual_cost).slice(0, 8);
  if (projectsWithBudget.length > 0) {
    const slide2 = addSlide(prs);
    addHeader(slide2, "פרויקטים — תקציב מול ביצוע", periodLabel);

    slide2.addChart("bar", [
      {
        name: "תקציב מאושר",
        labels: projectsWithBudget.map((p) => (p.project_name ?? "").slice(0, 20)),
        values: projectsWithBudget.map((p) => Math.round(p.planned_budget ?? 0)),
      },
      {
        name: "עלות בפועל",
        labels: projectsWithBudget.map((p) => (p.project_name ?? "").slice(0, 20)),
        values: projectsWithBudget.map((p) => Math.round(p.actual_cost ?? 0)),
      },
    ], {
      x: 0.3, y: 1.4, w: 9.4, h: 5.8,
      chartColors: [C.chartBlue, C.chartGold],
      showLegend: true,
      legendPos: "t",
      dataLabelFontSize: 9,
      valAxisDisplayUnit: "thousands",
    });
  }
}

// ─── Safety & Regulatory slides ───────────────────────────────────────────────

function buildSafetySlides(prs, safetyStats, periodLabel, year) {
  const slide = addSlide(prs);
  addHeader(slide, "בטיחות ורגולציה", periodLabel);

  const closed = safetyStats.byStatus.find((s) => s.status === "closed")?.c ?? 0;
  const open   = safetyStats.byStatus.find((s) => s.status === "open")?.c ?? 0;
  const inProg = safetyStats.byStatus.find((s) => s.status === "in_progress")?.c ?? 0;
  const highSeverity = safetyStats.bySeverity.find((s) => s.severity === "high")?.c ?? 0;

  addKpiBox(slide, 0.25,  1.35, 2.1, 1.5, "סה״כ אירועים", String(safetyStats.total), null, C.navy);
  addKpiBox(slide, 2.55,  1.35, 2.1, 1.5, "פתוחים", String(open), null, open > 0 ? C.red : C.green);
  addKpiBox(slide, 4.85,  1.35, 2.1, 1.5, "סגורים", String(closed), null, C.green);
  addKpiBox(slide, 7.15,  1.35, 2.1, 1.5, "חומרה גבוהה", String(highSeverity), null, highSeverity > 0 ? C.red : C.green);

  // Open items table
  if (safetyStats.openItems?.length > 0) {
    slide.addText("פריטים פתוחים הדורשים טיפול:", {
      x: 0.3, y: 2.95, w: 9.4, h: 0.4,
      fontSize: 13, bold: true, color: C.red, fontFace: FONT, rtlMode: true,
    });

    const rows = [
      [
        { text: "תאריך", options: { bold: true, color: C.white, fill: C.red } },
        { text: "סוג", options: { bold: true, color: C.white, fill: C.red } },
        { text: "תיאור", options: { bold: true, color: C.white, fill: C.red } },
        { text: "חומרה", options: { bold: true, color: C.white, fill: C.red, align: "center" } },
        { text: "סטטוס", options: { bold: true, color: C.white, fill: C.red, align: "center" } },
      ],
      ...safetyStats.openItems.slice(0, 10).map((item, i) => {
        const bg = i % 2 === 0 ? "FFF5F5" : C.white;
        return [
          { text: item.date ?? "—", options: { fill: bg, align: "center" } },
          { text: item.type ?? "—", options: { fill: bg, rtlMode: true } },
          { text: (item.description ?? "").slice(0, 60), options: { fill: bg, rtlMode: true } },
          { text: item.severity ?? "—", options: { fill: bg, color: item.severity === "high" ? C.red : C.amber, bold: true, align: "center" } },
          { text: item.status ?? "—", options: { fill: bg, align: "center" } },
        ];
      }),
    ];

    slide.addTable(rows, {
      x: 0.3, y: 3.4, w: 9.4,
      fontSize: 10, fontFace: FONT,
      border: { type: "solid", color: "DDDDDD", pt: 0.5 },
      rowH: 0.4,
    });
  } else {
    slide.addText("✓ אין ליקויי בטיחות פתוחים", {
      x: 0.3, y: 3.5, w: 9.4, h: 0.7,
      fontSize: 18, bold: true, color: C.green, fontFace: FONT, align: "center",
    });
  }
}

// ─── Looking ahead slide ──────────────────────────────────────────────────────

function buildLookingAheadSlide(prs, data, periodLabel, year, nextPeriodLabel) {
  const slide = addSlide(prs);
  addHeader(slide, `תוכנית עבודה — ${nextPeriodLabel}`, `מבט קדימה`);

  const items = [
    { icon: "⚙️", title: "אחזקה", items: [
      `סגירת ${data.maintenanceStats?.open ?? 0} קריאות פתוחות`,
      "תוכנית אחזקה מונעת רבעונית",
      "הכשרת צוות טכנאים",
    ]},
    { icon: "💰", title: "תקציב", items: [
      "סקירת הסטיות מהתקציב",
      "הכנת תקציב לרבעון הבא",
      "מכרזים לחידוש חוזים",
    ]},
    { icon: "🏗️", title: "פרויקטים", items: [
      `השלמת ${data.projects?.filter((p) => p.status === "active").length ?? 0} פרויקטים פעילים`,
      "תכנון פרויקטים חדשים",
      "בדיקת ספקים וקבלנים",
    ]},
    { icon: "🛡️", title: "בטיחות ורגולציה", items: [
      `סגירת ${data.safetyStats?.byStatus?.find((s) => s.status === "open")?.c ?? 0} ליקויים פתוחים`,
      "תרגיל פינוי רבעוני",
      "הכנה לביקורת משרד הבריאות",
    ]},
  ];

  items.forEach(({ icon, title, items: bullets }, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = col === 0 ? 0.25 : 5.1;
    const y = 1.4 + row * 2.9;

    slide.addShape("rect", {
      x, y, w: 4.5, h: 2.6,
      fill: { color: C.lightGray },
      line: { color: C.navy, width: 1.5 },
    });

    slide.addText(`${icon} ${title}`, {
      x: x + 0.15, y: y + 0.1, w: 4.2, h: 0.45,
      fontSize: 14, bold: true, color: C.navy, fontFace: FONT, rtlMode: true, align: "right",
    });

    slide.addShape("rect", {
      x, y: y + 0.55, w: 4.5, h: 0.03, fill: { color: C.gold },
    });

    bullets.forEach((b, bi) => {
      slide.addText(`• ${b}`, {
        x: x + 0.15, y: y + 0.65 + bi * 0.55, w: 4.2, h: 0.5,
        fontSize: 11, color: C.darkGray, fontFace: FONT, rtlMode: true, align: "right",
      });
    });
  });
}

// ─── Main report generator ────────────────────────────────────────────────────

export async function generateReport(reportType, year) {
  const periodLabel = PERIOD_LABELS[reportType] ?? reportType;
  const quarter = QUARTER_MAP[reportType] ?? null;
  const nextPeriodLabel = getNextPeriodLabel(reportType, year);

  console.log(`\n📊 מייצר דוח: ${periodLabel} ${year}...`);

  // Gather all data
  const maintenanceStats = getMaintenanceStats(year, quarter);
  const budgetSummary    = getBudgetSummary(year, quarter);
  const projects         = getProjects(year);
  const safetyStats      = getSafetyStats(year, quarter);

  const data = { maintenanceStats, budgetSummary, projects, safetyStats };

  // Generate executive summary using AI
  console.log("🤖 מייצר Executive Summary...");
  const summaryText = await generateExecutiveSummary(data, `${periodLabel} ${year}`);

  // Build presentation
  const prs = new PptxGenJS();
  prs.layout = "LAYOUT_WIDE";
  prs.author  = process.env.NURSING_HOME_MANAGER ?? "מנהל תפעול";
  prs.company = process.env.NURSING_HOME_NAME ?? "בית האבות";
  prs.subject = `דוח ${periodLabel} ${year}`;
  prs.title   = `${prs.company} — ${periodLabel} ${year}`;

  const config = {
    institutionName: prs.company,
    reportTitle: `דוח ${periodLabel}`,
    periodLabel,
    year,
    preparedBy: prs.author,
  };

  // Build all slides
  buildCoverSlide(prs, config);
  buildExecutiveSummarySlide(prs, summaryText, periodLabel, year);
  buildKpiSlide(prs, maintenanceStats, budgetSummary, safetyStats, projects, periodLabel, year);
  buildBudgetSlides(prs, budgetSummary, periodLabel, year);
  buildMaintenanceSlides(prs, maintenanceStats, periodLabel, year);
  buildProjectsSlides(prs, projects, periodLabel, year);
  buildSafetySlides(prs, safetyStats, periodLabel, year);
  buildLookingAheadSlide(prs, data, periodLabel, year, nextPeriodLabel);

  // Save
  const fileName = `report_${reportType}_${year}_${Date.now()}.pptx`;
  const filePath = join(REPORTS_DIR, fileName);
  await prs.writeFile({ fileName: filePath });

  // Count slides
  const slideCount = prs.slides?.length ?? 0;

  logReport(reportType, periodLabel, year, filePath, slideCount, "success");
  console.log(`✅ דוח נשמר: ${filePath} (${slideCount} שקופיות)`);

  return { filePath, fileName, slideCount, periodLabel, year };
}

function getNextPeriodLabel(current, year) {
  const next = {
    Q1: `רבעון 2 ${year}`,
    Q2: `רבעון 3 ${year}`,
    Q3: `רבעון 4 ${year}`,
    Q4: `רבעון 1 ${year + 1}`,
    H1: `חציון שני ${year}`,
    H2: `רבעון 1 ${year + 1}`,
    annual: `שנת ${year + 1}`,
  };
  return next[current] ?? "הרבעון הבא";
}

export function getReportsDirectory() {
  return REPORTS_DIR;
}
