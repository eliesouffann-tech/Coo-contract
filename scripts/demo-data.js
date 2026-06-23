#!/usr/bin/env node
/**
 * Populates the database with realistic nursing home demo data for testing.
 * Run with: node scripts/demo-data.js [year]
 *
 * This allows you to see a full report without connecting OneDrive.
 */

import "dotenv/config";
import {
  insertMaintenanceRecord,
  insertBudgetItem,
  upsertProject,
  insertSafetyRecord,
  upsertDocument,
  db,
} from "../src/database.js";

const year = parseInt(process.argv[2]) || new Date().getFullYear();

console.log(`\n🏥 טוען נתוני Demo לשנת ${year}...\n`);

// Clear existing demo data
db.prepare("DELETE FROM maintenance_records").run();
db.prepare("DELETE FROM budget_items").run();
db.prepare("DELETE FROM projects").run();
db.prepare("DELETE FROM safety_records").run();
db.prepare("DELETE FROM documents WHERE onedrive_id LIKE 'demo-%'").run();

// ─── Maintenance records — full year ─────────────────────────────────────────

const maintenanceData = [
  // January
  { callNumber: `${year}-001`, dateOpened: `${year}-01-07`, dateClosed: `${year}-01-09`, department: "קומה א", location: "חדר 12", description: "תקלת ברז דולף", worker: "יוסי לוי", status: "closed", resolutionTimeHours: 48, category: "אינסטלציה" },
  { callNumber: `${year}-002`, dateOpened: `${year}-01-12`, dateClosed: `${year}-01-13`, department: "קומה ב", location: "חדר 28", description: "נורה שרופה", worker: "דוד כהן", status: "closed", resolutionTimeHours: 4, category: "חשמל" },
  { callNumber: `${year}-003`, dateOpened: `${year}-01-15`, dateClosed: null, department: "מטבח", location: "מטבח ראשי", description: "מקרר תקול", worker: "יוסי לוי", status: "open", resolutionTimeHours: null, category: "ציוד" },
  { callNumber: `${year}-004`, dateOpened: `${year}-01-20`, dateClosed: `${year}-01-22`, department: "גינה", location: "חצר", description: "מערכת השקיה תקולה", worker: "רחל פרץ", status: "closed", resolutionTimeHours: 36, category: "גינה" },
  { callNumber: `${year}-005`, dateOpened: `${year}-01-25`, dateClosed: `${year}-01-26`, department: "קומה ג", location: "פרוזדור", description: "מיזוג לא מגיע קור", worker: "אבי גולן", status: "closed", resolutionTimeHours: 18, category: "מיזוג" },
  // February
  { callNumber: `${year}-006`, dateOpened: `${year}-02-03`, dateClosed: `${year}-02-05`, department: "קומה א", location: "חדר 8", description: "דלת לא נסגרת", worker: "יוסי לוי", status: "closed", resolutionTimeHours: 24, category: "בנייה" },
  { callNumber: `${year}-007`, dateOpened: `${year}-02-10`, dateClosed: `${year}-02-11`, department: "פיזיותרפיה", location: "חדר 2", description: "שולחן טיפולים תקול", worker: "דוד כהן", status: "closed", resolutionTimeHours: 8, category: "ריהוט" },
  { callNumber: `${year}-008`, dateOpened: `${year}-02-14`, dateClosed: `${year}-02-18`, department: "קומה ב", location: "חדר 35", description: "רצפה רופפת", worker: "יוסי לוי", status: "closed", resolutionTimeHours: 72, category: "בנייה" },
  { callNumber: `${year}-009`, dateOpened: `${year}-02-20`, dateClosed: `${year}-02-21`, department: "מחסן", location: "מחסן ראשי", description: "דלת נעילה תקולה", worker: "אבי גולן", status: "closed", resolutionTimeHours: 12, category: "אחר" },
  { callNumber: `${year}-010`, dateOpened: `${year}-02-25`, dateClosed: null, department: "קומה ד", location: "חדר 52", description: "שקע חשמל לא עובד", worker: "דוד כהן", status: "open", resolutionTimeHours: null, category: "חשמל" },
  // March
  { callNumber: `${year}-011`, dateOpened: `${year}-03-02`, dateClosed: `${year}-03-04`, department: "קומה א", location: "חדר 15", description: "מיטה חשמלית תקולה", worker: "יוסי לוי", status: "closed", resolutionTimeHours: 30, category: "ציוד" },
  { callNumber: `${year}-012`, dateOpened: `${year}-03-08`, dateClosed: `${year}-03-08`, department: "כניסה", location: "לובי", description: "נורות LED שרופות", worker: "דוד כהן", status: "closed", resolutionTimeHours: 2, category: "חשמל" },
  { callNumber: `${year}-013`, dateOpened: `${year}-03-12`, dateClosed: `${year}-03-15`, department: "קומה ב", location: "חדר 22", description: "רדיאטור לא חם", worker: "אבי גולן", status: "closed", resolutionTimeHours: 48, category: "מיזוג" },
  // April
  { callNumber: `${year}-014`, dateOpened: `${year}-04-03`, dateClosed: `${year}-04-04`, department: "גינה", location: "גינה קדמית", description: "ספסל שבור", worker: "רחל פרץ", status: "closed", resolutionTimeHours: 6, category: "גינה" },
  { callNumber: `${year}-015`, dateOpened: `${year}-04-08`, dateClosed: `${year}-04-10`, department: "קומה ג", location: "חדר 41", description: "ברז חם לא עובד", worker: "יוסי לוי", status: "closed", resolutionTimeHours: 36, category: "אינסטלציה" },
  { callNumber: `${year}-016`, dateOpened: `${year}-04-15`, dateClosed: null, department: "קומה ד", location: "חדר 58", description: "מיזוג מרעיש", worker: "אבי גולן", status: "open", resolutionTimeHours: null, category: "מיזוג" },
  { callNumber: `${year}-017`, dateOpened: `${year}-04-20`, dateClosed: `${year}-04-21`, department: "מחלקה ב", location: "פרוזדור", description: "מנורת חירום תקולה", worker: "דוד כהן", status: "closed", resolutionTimeHours: 12, category: "חשמל" },
  // May
  { callNumber: `${year}-018`, dateOpened: `${year}-05-05`, dateClosed: `${year}-05-07`, department: "קומה א", location: "חדר 9", description: "גלגלי מיטה שבורים", worker: "יוסי לוי", status: "closed", resolutionTimeHours: 24, category: "ריהוט" },
  { callNumber: `${year}-019`, dateOpened: `${year}-05-12`, dateClosed: `${year}-05-13`, department: "גינה", location: "גינה אחורית", description: "עץ שנפל קרוב לגדר", worker: "רחל פרץ", status: "closed", resolutionTimeHours: 8, category: "גינה" },
  { callNumber: `${year}-020`, dateOpened: `${year}-05-18`, dateClosed: `${year}-05-19`, department: "קומה ב", location: "חדר 30", description: "מראה שבורה", worker: "יוסי לוי", status: "closed", resolutionTimeHours: 10, category: "בנייה" },
  { callNumber: `${year}-021`, dateOpened: `${year}-05-22`, dateClosed: `${year}-05-24`, department: "מטבח", location: "מטבח", description: "מדיח כלים לא מנקה", worker: "דוד כהן", status: "closed", resolutionTimeHours: 36, category: "ציוד" },
  // June
  { callNumber: `${year}-022`, dateOpened: `${year}-06-04`, dateClosed: `${year}-06-05`, department: "קומה ג", location: "חדר 44", description: "ריח ביוב", worker: "יוסי לוי", status: "closed", resolutionTimeHours: 18, category: "אינסטלציה" },
  { callNumber: `${year}-023`, dateOpened: `${year}-06-10`, dateClosed: `${year}-06-11`, department: "קומה א", location: "חדר 18", description: "מסך טלויזיה לא דולק", worker: "דוד כהן", status: "closed", resolutionTimeHours: 6, category: "ציוד" },
  { callNumber: `${year}-024`, dateOpened: `${year}-06-17`, dateClosed: null, department: "קומה ד", location: "חדר 60", description: "מיטה חשמלית תקולה", worker: "יוסי לוי", status: "open", resolutionTimeHours: null, category: "ציוד" },
];

let mCount = 0;
for (const r of maintenanceData) {
  insertMaintenanceRecord(r);
  mCount++;
}
console.log(`✅ קריאות אחזקה: ${mCount}`);

// ─── Budget data ──────────────────────────────────────────────────────────────

const budgetData = [
  // Q1
  { period: `Q1 ${year}`, year, quarter: 1, category: "אחזקה שוטפת", plannedAmount: 55000, actualAmount: 48000 },
  { period: `Q1 ${year}`, year, quarter: 1, category: "חשמל ותאורה", plannedAmount: 35000, actualAmount: 38500 },
  { period: `Q1 ${year}`, year, quarter: 1, category: "גינון", plannedAmount: 18000, actualAmount: 14200 },
  { period: `Q1 ${year}`, year, quarter: 1, category: "ניקיון", plannedAmount: 42000, actualAmount: 41000 },
  { period: `Q1 ${year}`, year, quarter: 1, category: "ציוד רפואי", plannedAmount: 28000, actualAmount: 31000 },
  { period: `Q1 ${year}`, year, quarter: 1, category: "מזון ומסעדה", plannedAmount: 120000, actualAmount: 118500 },
  { period: `Q1 ${year}`, year, quarter: 1, category: "כ״א — שעות נוספות", plannedAmount: 25000, actualAmount: 28000 },
  // Q2
  { period: `Q2 ${year}`, year, quarter: 2, category: "אחזקה שוטפת", plannedAmount: 55000, actualAmount: 52000 },
  { period: `Q2 ${year}`, year, quarter: 2, category: "חשמל ותאורה", plannedAmount: 38000, actualAmount: 36000 },
  { period: `Q2 ${year}`, year, quarter: 2, category: "גינון", plannedAmount: 22000, actualAmount: 24500 },
  { period: `Q2 ${year}`, year, quarter: 2, category: "ניקיון", plannedAmount: 42000, actualAmount: 42000 },
  { period: `Q2 ${year}`, year, quarter: 2, category: "ציוד רפואי", plannedAmount: 28000, actualAmount: 26500 },
  { period: `Q2 ${year}`, year, quarter: 2, category: "מזון ומסעדה", plannedAmount: 122000, actualAmount: 119000 },
  { period: `Q2 ${year}`, year, quarter: 2, category: "כ״א — שעות נוספות", plannedAmount: 25000, actualAmount: 22000 },
  // Q3
  { period: `Q3 ${year}`, year, quarter: 3, category: "אחזקה שוטפת", plannedAmount: 55000, actualAmount: 59000 },
  { period: `Q3 ${year}`, year, quarter: 3, category: "חשמל ותאורה", plannedAmount: 45000, actualAmount: 51000 },
  { period: `Q3 ${year}`, year, quarter: 3, category: "גינון", plannedAmount: 25000, actualAmount: 22000 },
  { period: `Q3 ${year}`, year, quarter: 3, category: "ניקיון", plannedAmount: 42000, actualAmount: 43500 },
  { period: `Q3 ${year}`, year, quarter: 3, category: "ציוד רפואי", plannedAmount: 30000, actualAmount: 28000 },
  { period: `Q3 ${year}`, year, quarter: 3, category: "מזון ומסעדה", plannedAmount: 125000, actualAmount: 124000 },
  { period: `Q3 ${year}`, year, quarter: 3, category: "כ״א — שעות נוספות", plannedAmount: 25000, actualAmount: 29000 },
];

for (const item of budgetData) insertBudgetItem(item);
console.log(`✅ פריטי תקציב: ${budgetData.length}`);

// ─── Projects ─────────────────────────────────────────────────────────────────

const projectsData = [
  {
    projectName: "שיפוץ חדר אוכל ראשי",
    status: "completed",
    startDate: `${year}-01-05`,
    endDate: `${year}-02-28`,
    plannedBudget: 120000,
    actualCost: 113500,
    description: "שיפוץ מלא של חדר האוכל כולל צביעה, ריצוף חדש, ריהוט ותאורה",
    department: "כללי",
    contractor: "שיפוצי כהן בע״מ",
  },
  {
    projectName: "התקנת מצלמות אבטחה — שלב א",
    status: "completed",
    startDate: `${year}-02-01`,
    endDate: `${year}-03-15`,
    plannedBudget: 65000,
    actualCost: 68000,
    description: "התקנת 24 מצלמות אבטחה בכל קומות המבנה + מרכז שליטה",
    department: "בטיחות",
    contractor: "אבטחה טכנולוגיות בע״מ",
  },
  {
    projectName: "שיפוץ חדרי רחצה — קומה א",
    status: "active",
    startDate: `${year}-04-10`,
    endDate: null,
    plannedBudget: 280000,
    actualCost: 145000,
    description: "שיפוץ 12 חדרי רחצה בקומה א כולל כלים סניטריים, ריצוף ורמפות נגישות",
    department: "קומה א",
    contractor: "שרון שיפוצים בע״מ",
  },
  {
    projectName: "מערכת סולארית על הגג",
    status: "planned",
    startDate: `${year}-10-01`,
    endDate: null,
    plannedBudget: 450000,
    actualCost: null,
    description: "התקנת מערכת סולארית 120KW לחיסכון בחשמל — צפי חיסכון 35%",
    department: "כללי",
    contractor: "תמ שמש בע״מ",
  },
  {
    projectName: "שדרוג מטבח — ציוד",
    status: "completed",
    startDate: `${year}-03-01`,
    endDate: `${year}-04-30`,
    plannedBudget: 95000,
    actualCost: 92000,
    description: "החלפת כיריים תעשייתיות, תנורים ומקררים במטבח הראשי",
    department: "מטבח",
    contractor: "קרן ציוד מסעדות",
  },
  {
    projectName: "נגישות — הכנסה ורמפות",
    status: "active",
    startDate: `${year}-05-01`,
    endDate: null,
    plannedBudget: 75000,
    actualCost: 38000,
    description: "הרחבת שבילים והוספת רמפות לנגישות מוחלטת לפי תקן 1458",
    department: "כללי",
    contractor: "נגישות ישראל בע״מ",
  },
];

for (const p of projectsData) upsertProject(p);
console.log(`✅ פרויקטים: ${projectsData.length}`);

// ─── Safety records ───────────────────────────────────────────────────────────

const safetyData = [
  {
    date: `${year}-01-18`,
    type: "נפילה",
    description: "דייר נפל בחדר הרחצה — ללא פציעה",
    severity: "medium",
    location: "קומה א — חדר 12",
    correctiveAction: "הוספת מחזיקי יד נוספים + רצפות אנטי-החלקה",
    status: "closed",
    regulatoryBody: "משרד הבריאות",
  },
  {
    date: `${year}-02-05`,
    type: "ביקורת",
    description: "ביקורת שגרתית של משרד הבריאות — 2 ליקויים קלים",
    severity: "low",
    location: "כל המוסד",
    correctiveAction: "תיקון שלטי הכיוון + ניקיון מחסן תרופות",
    status: "closed",
    regulatoryBody: "משרד הבריאות",
  },
  {
    date: `${year}-03-22`,
    type: "אש",
    description: "אזעקת עשן — כלי בישול על הכיריים ללא השגחה",
    severity: "medium",
    location: "מטבח ראשי",
    correctiveAction: "תדריך לצוות + נהלי מטבח מחמירים",
    status: "closed",
    regulatoryBody: "כבאות",
  },
  {
    date: `${year}-04-30`,
    type: "ביקורת",
    description: "ביקורת כיבוי אש — תפוגת יציאות חירום",
    severity: "high",
    location: "כל הקומות",
    correctiveAction: "חידוש שילוט יציאות חירום + תרגיל פינוי",
    status: "closed",
    regulatoryBody: "כבאות",
  },
  {
    date: `${year}-05-15`,
    type: "נפילה",
    description: "דייר נפל בפרוזדור — שריטה קלה ביד",
    severity: "low",
    location: "קומה ב — פרוזדור",
    correctiveAction: "בדיקת תאורת הפרוזדור",
    status: "closed",
    regulatoryBody: null,
  },
  {
    date: `${year}-06-10`,
    type: "ליקוי",
    description: "ליקוי בדוד מים חמים — מתחת לטמפרטורה",
    severity: "medium",
    location: "חדר מכונות",
    correctiveAction: "טיפול בטכנאי — בטיפול",
    status: "open",
    regulatoryBody: "משרד הבריאות",
  },
];

for (const r of safetyData) insertSafetyRecord(r);
console.log(`✅ אירועי בטיחות: ${safetyData.length}`);

// ─── Demo documents ───────────────────────────────────────────────────────────

const docData = [
  { onedriveId: "demo-001", fileName: `דוח אחזקה ינואר ${year}.xlsx`, filePath: `אחזקה/דוח אחזקה ינואר ${year}.xlsx`, fileType: "xlsx", category: "maintenance", contentSummary: "דוח קריאות שירות ינואר", processed: true },
  { onedriveId: "demo-002", fileName: `תקציב Q1 ${year}.xlsx`, filePath: `תקציב/תקציב Q1 ${year}.xlsx`, fileType: "xlsx", category: "budget", contentSummary: "תקציב רבעון 1", processed: true },
  { onedriveId: "demo-003", fileName: `פרויקט שיפוץ חדר אוכל.pdf`, filePath: `פרויקטים/פרויקט שיפוץ חדר אוכל.pdf`, fileType: "pdf", category: "projects", contentSummary: "מסמכי פרויקט שיפוץ", processed: true },
  { onedriveId: "demo-004", fileName: `ביקורת משרד הבריאות ${year}.pdf`, filePath: `בטיחות/ביקורת משרד הבריאות ${year}.pdf`, fileType: "pdf", category: "regulatory", contentSummary: "ממצאי ביקורת רגולטורית", processed: true },
];

for (const d of docData) upsertDocument({ ...d, dateDocument: `${year}-01-01`, dateModified: new Date().toISOString() });
console.log(`✅ מסמכים: ${docData.length}`);

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ נתוני Demo נטענו בהצלחה לשנת ${year}!

כעת תוכל:
  1. לראות את ה-Dashboard: http://localhost:3000/dashboard
  2. לייצר דוח: node scripts/generate-report.js Q1 ${year}
     או מה-Dashboard לחץ "צור דוח"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

process.exit(0);
