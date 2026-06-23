import Anthropic from "@anthropic-ai/sdk";

let _client = null;
const MODEL = "claude-sonnet-4-6";

function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY לא מוגדר ב-.env — נדרש לניתוח מסמכים");
    }
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export function isAIReady() {
  return !!process.env.ANTHROPIC_API_KEY;
}

async function askClaude(systemPrompt, userContent, maxTokens = 2000) {
  const messages = Array.isArray(userContent)
    ? [{ role: "user", content: userContent }]
    : [{ role: "user", content: [{ type: "text", text: userContent }] }];

  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });
  return resp.content[0].text;
}

// ─── Document categorization ──────────────────────────────────────────────────

export async function categorizeDocument(text, fileName) {
  if (!text) return { category: "general", subcategory: null, summary: "מסמך ללא תוכן" };

  const prompt = `אתה מומחה לניהול בתי אבות. קרא את המסמך וסווג אותו.

ענה JSON בלבד, ללא הסברים נוספים:
{
  "category": "maintenance|safety|budget|projects|water|electricity|garden|quality|regulatory|hr|general",
  "subcategory": "תת-קטגוריה ספציפית",
  "summary": "תקציר של 2-3 משפטים בעברית",
  "documentDate": "YYYY-MM-DD או null",
  "isReport": true/false,
  "reportPeriod": "Q1 2025 / חציון 2025 / 2025 / null"
}`;

  try {
    const raw = await askClaude(prompt, `שם קובץ: ${fileName}\n\n${text.slice(0, 6000)}`, 500);
    const json = raw.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(json);
  } catch {
    return { category: "general", subcategory: null, summary: text.slice(0, 200) };
  }
}

// ─── Maintenance records extraction ──────────────────────────────────────────

export async function extractMaintenanceRecords(text, documentId) {
  if (!text) return [];

  const prompt = `אתה מנהל אחזקה בבית אבות. חלץ מהטקסט את כל קריאות השירות/האחזקה.

ענה JSON בלבד — מערך של אובייקטים:
[
  {
    "callNumber": "מספר קריאה או null",
    "dateOpened": "YYYY-MM-DD או null",
    "dateClosed": "YYYY-MM-DD או null",
    "department": "מחלקה",
    "location": "מיקום",
    "description": "תיאור התקלה",
    "worker": "שם הטכנאי/עובד",
    "status": "open|closed|in_progress",
    "resolutionTimeHours": מספר_שעות_או_null,
    "category": "חשמל|אינסטלציה|מיזוג|בנייה|גינה|ריהוט|ציוד|אחר"
  }
]

אם אין קריאות אחזקה, החזר [].`;

  try {
    const raw = await askClaude(prompt, text.slice(0, 8000), 3000);
    const json = raw.replace(/```json\n?|\n?```/g, "").trim();
    const records = JSON.parse(json);
    return records.map((r) => ({ ...r, documentId }));
  } catch {
    return [];
  }
}

// ─── Budget data extraction ───────────────────────────────────────────────────

export async function extractBudgetData(text, documentId) {
  if (!text) return [];

  const currentYear = new Date().getFullYear();

  const prompt = `אתה CFO בבית אבות. חלץ מהטקסט את כל פריטי התקציב.

ענה JSON בלבד — מערך:
[
  {
    "period": "Q1 2025 / 2025 / אפריל 2025",
    "year": ${currentYear},
    "quarter": 1-4_או_null,
    "month": 1-12_או_null,
    "category": "שם קטגוריה",
    "subcategory": "תת-קטגוריה",
    "plannedAmount": מספר_בשקלים,
    "actualAmount": מספר_בשקלים,
    "notes": "הערות"
  }
]

אם אין נתוני תקציב, החזר [].
חשוב: סכומים בשקלים ישראלים. ממש כמות בשקלים.`;

  try {
    const raw = await askClaude(prompt, text.slice(0, 8000), 3000);
    const json = raw.replace(/```json\n?|\n?```/g, "").trim();
    const items = JSON.parse(json);
    return items.map((i) => ({ ...i, documentId }));
  } catch {
    return [];
  }
}

// ─── Project data extraction ──────────────────────────────────────────────────

export async function extractProjectData(text, documentId) {
  if (!text) return [];

  const prompt = `אתה מנהל פרויקטים בבית אבות. חלץ פרויקטים מהטקסט.

ענה JSON בלבד — מערך:
[
  {
    "projectName": "שם הפרויקט",
    "status": "completed|active|planned|on_hold",
    "startDate": "YYYY-MM-DD או null",
    "endDate": "YYYY-MM-DD או null",
    "plannedBudget": מספר_בשקלים_או_null,
    "actualCost": מספר_בשקלים_או_null,
    "description": "תיאור הפרויקט",
    "department": "מחלקה רלוונטית",
    "contractor": "שם קבלן או null"
  }
]

אם אין פרויקטים, החזר [].`;

  try {
    const raw = await askClaude(prompt, text.slice(0, 8000), 2000);
    const json = raw.replace(/```json\n?|\n?```/g, "").trim();
    const projects = JSON.parse(json);
    return projects.map((p) => ({ ...p, documentId }));
  } catch {
    return [];
  }
}

// ─── Safety & regulatory extraction ──────────────────────────────────────────

export async function extractSafetyData(text, documentId) {
  if (!text) return [];

  const prompt = `אתה קצין בטיחות בבית אבות. חלץ אירועי בטיחות, ביקורות ורגולציה מהטקסט.

ענה JSON בלבד — מערך:
[
  {
    "date": "YYYY-MM-DD או null",
    "type": "תאונה|ביקורת|ליקוי|תרגיל|בטיחות_אש|נפילה|תלונה|אחר",
    "description": "תיאור",
    "severity": "high|medium|low",
    "location": "מיקום",
    "correctiveAction": "פעולה מתקנת שננקטה",
    "status": "open|closed|in_progress",
    "regulatoryBody": "משרד הבריאות|כבאות|עבודה|אחר|null"
  }
]

אם אין אירועים, החזר [].`;

  try {
    const raw = await askClaude(prompt, text.slice(0, 8000), 2000);
    const json = raw.replace(/```json\n?|\n?```/g, "").trim();
    const records = JSON.parse(json);
    return records.map((r) => ({ ...r, documentId }));
  } catch {
    return [];
  }
}

// ─── Image analysis ───────────────────────────────────────────────────────────

export async function analyzeImage(buffer, mimeType, fileName) {
  try {
    const base64 = buffer.toString("base64");
    const safeType = mimeType?.startsWith("image/") ? mimeType : "image/jpeg";

    const messages = [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: safeType, data: base64 },
        },
        {
          type: "text",
          text: `אתה מנהל תפעול בבית אבות. שם הקובץ: ${fileName}.
תאר את התמונה בעברית:
1. מה מצולם (חדר, ציוד, עבודה, גינה וכו')
2. האם זו תמונת "לפני" או "אחרי" עבודה/שיפוץ?
3. מצב כללי (טוב/רעוע/חדש/ישן)
4. האם ניכרת בעיה שדורשת טיפול?
5. לאיזה נושא שייכת (אחזקה/פרויקט/בטיחות/גינון/אחר)?

ענה בפסקה קצרה של 3-4 משפטים.`,
        },
      ],
    }];

    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages,
    });
    return resp.content[0].text;
  } catch (err) {
    console.warn("⚠️ Image analysis error:", err.message?.slice(0, 80));
    return `תמונה: ${fileName}`;
  }
}

// ─── Executive summary generation ─────────────────────────────────────────────

export async function generateExecutiveSummary(data, periodLabel) {
  // Fallback summary when AI is not available
  if (!isAIReady()) {
    return buildFallbackSummary(data, periodLabel);
  }

  const prompt = `אתה יועץ ניהולי בכיר המכין דוח הנהלה לבית אבות.
כתוב Executive Summary קצר ומקצועי בעברית עבור ${periodLabel}.

כתוב 4 קטגוריות:
1. **הישגים מרכזיים** (3 bullet points)
2. **אתגרים ונקודות לשיפור** (2-3 bullet points)
3. **מדדים מרכזיים** (KPIs - 4-5 מספרים)
4. **המלצות להמשך** (2-3 bullet points)

השתמש בשפה מקצועית ברמת דירקטוריון. היה ספציפי ומבוסס נתונים.`;

  const dataText = JSON.stringify(data, null, 2).slice(0, 4000);

  try {
    return await askClaude(prompt, `נתוני התקופה:\n${dataText}`, 1500);
  } catch {
    return buildFallbackSummary(data, periodLabel);
  }
}

function buildFallbackSummary(data, periodLabel) {
  const m = data.maintenanceStats ?? {};
  const b = data.budgetSummary ?? {};
  const p = data.projects ?? [];
  const s = data.safetyStats ?? {};

  const closureRate = m.total > 0 ? Math.round((m.closed / m.total) * 100) : 0;
  const budgetVariance = (b.totalActual ?? 0) - (b.totalPlanned ?? 0);
  const completedProjects = p.filter((x) => x.status === "completed").length;
  const openSafety = s.byStatus?.find((x) => x.status === "open")?.c ?? 0;

  return [
    `**הישגים מרכזיים — ${periodLabel}**`,
    `• שיעור סגירת קריאות אחזקה: ${closureRate}% (${m.closed ?? 0} מתוך ${m.total ?? 0})`,
    `• פרויקטים שהושלמו: ${completedProjects} מתוך ${p.length}`,
    budgetVariance <= 0
      ? `• חיסכון תקציבי: ₪${Math.round(-budgetVariance).toLocaleString("he-IL")}`
      : `• ביצוע תקציבי: ₪${Math.round(b.totalActual ?? 0).toLocaleString("he-IL")} מתוך ₪${Math.round(b.totalPlanned ?? 0).toLocaleString("he-IL")}`,
    ``,
    `**מדדים מרכזיים**`,
    `• קריאות אחזקה שנפתחו: ${m.total ?? 0}`,
    `• זמן טיפול ממוצע: ${m.avgHours ? Math.round(m.avgHours) + " שעות" : "—"}`,
    `• תקציב מתוכנן: ₪${Math.round(b.totalPlanned ?? 0).toLocaleString("he-IL")}`,
    `• אירועי בטיחות: ${s.total ?? 0} (${openSafety} פתוחים)`,
    ``,
    `**אתגרים ונקודות לשיפור**`,
    m.open > 0 ? `• ${m.open} קריאות אחזקה עדיין פתוחות` : `• כל קריאות האחזקה טופלו`,
    openSafety > 0 ? `• ${openSafety} ליקויי בטיחות ממתינים לסגירה` : `• אין ליקויי בטיחות פתוחים`,
    budgetVariance > 0 ? `• חריגה תקציבית של ₪${Math.round(budgetVariance).toLocaleString("he-IL")}` : `• התקציב בשליטה`,
    ``,
    `**המלצות להמשך**`,
    `• להמשיך לשפר את זמני הסגירה של קריאות האחזקה`,
    `• לסגור את כל ליקויי הבטיחות הפתוחים לפני הביקורת הבאה`,
    `• לעקוב אחר ביצוע התקציב ולהגיש דוח חריגות`,
  ].join("\n");
}

// ─── Trend analysis ───────────────────────────────────────────────────────────

export async function analyzeMaintenanceTrends(currentStats, previousStats) {
  if (!previousStats) return { trends: [], insights: [] };

  const prompt = `השווה נתוני אחזקה של שתי תקופות וזהה מגמות.

ענה JSON:
{
  "trends": ["מגמה 1", "מגמה 2"],
  "insights": ["תובנה 1", "תובנה 2"],
  "recommendations": ["המלצה 1", "המלצה 2"]
}`;

  try {
    const raw = await askClaude(
      prompt,
      `תקופה נוכחית: ${JSON.stringify(currentStats)}\nתקופה קודמת: ${JSON.stringify(previousStats)}`,
      800,
    );
    return JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
  } catch {
    return { trends: [], insights: [], recommendations: [] };
  }
}
