import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

const MAX_TEXT_LENGTH = 12000;

// ─── PDF ──────────────────────────────────────────────────────────────────────

export async function extractPdfText(buffer) {
  try {
    const { text } = await pdfParse(buffer);
    return text.slice(0, MAX_TEXT_LENGTH).trim();
  } catch (err) {
    console.warn("⚠️ PDF parse error:", err.message);
    return null;
  }
}

// ─── Word (.docx) ─────────────────────────────────────────────────────────────

export async function extractWordText(buffer) {
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    return value.slice(0, MAX_TEXT_LENGTH).trim();
  } catch (err) {
    console.warn("⚠️ Word parse error:", err.message);
    return null;
  }
}

// ─── Excel (.xlsx / .xls / .csv) ─────────────────────────────────────────────

export function extractExcelData(buffer, extension = "xlsx") {
  try {
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
      cellText: false,
    });

    const sheets = {};
    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: "",
        blankrows: false,
        raw: false,
        dateNF: "DD/MM/YYYY",
      });
      // Remove completely empty rows
      const filteredRows = rows.filter((row) =>
        row.some((cell) => cell !== null && cell !== undefined && cell !== "")
      );
      if (filteredRows.length > 0) sheets[sheetName] = filteredRows;
    }

    // Convert to readable text for AI analysis
    let text = "";
    for (const [name, rows] of Object.entries(sheets)) {
      text += `\n=== גיליון: ${name} ===\n`;
      for (const row of rows.slice(0, 200)) {
        text += row.join(" | ") + "\n";
      }
    }
    return { text: text.slice(0, MAX_TEXT_LENGTH), sheets };
  } catch (err) {
    console.warn("⚠️ Excel parse error:", err.message);
    return null;
  }
}

// ─── Text files ───────────────────────────────────────────────────────────────

export function extractPlainText(buffer) {
  try {
    return buffer.toString("utf8").slice(0, MAX_TEXT_LENGTH);
  } catch {
    return null;
  }
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export async function extractContent(buffer, extension) {
  const ext = extension.toLowerCase().replace(".", "");

  switch (ext) {
    case "pdf":
      return { type: "text", content: await extractPdfText(buffer) };

    case "docx":
    case "doc":
      return { type: "text", content: await extractWordText(buffer) };

    case "xlsx":
    case "xls":
    case "csv": {
      const result = extractExcelData(buffer, ext);
      return result ? { type: "excel", content: result.text, sheets: result.sheets } : { type: "text", content: null };
    }

    case "txt":
      return { type: "text", content: extractPlainText(buffer) };

    case "jpg":
    case "jpeg":
    case "png":
    case "gif":
    case "bmp":
    case "webp":
      return { type: "image", content: null, buffer };

    case "pptx":
    case "ppt":
      return { type: "presentation", content: "[מצגת PowerPoint — לא ניתן לחלץ טקסט אוטומטית]" };

    default:
      return { type: "unknown", content: null };
  }
}

// ─── Document metadata helpers ────────────────────────────────────────────────

export function detectDocumentDate(text, fileName) {
  if (!text) return null;

  // Look for Hebrew/Israeli date patterns: DD/MM/YYYY or YYYY-MM-DD
  const patterns = [
    /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/,
    /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/,
    /(\d{1,2})\s+ב?(ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)\s+(\d{4})/i,
  ];

  const hebrewMonths = {
    ינואר: "01", פברואר: "02", מרץ: "03", מרס: "03", אפריל: "04",
    מאי: "05", יוני: "06", יולי: "07", אוגוסט: "08",
    ספטמבר: "09", אוקטובר: "10", נובמבר: "11", דצמבר: "12",
  };

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        if (pattern.source.includes("ינואר")) {
          const [, day, month, year] = match;
          const mm = hebrewMonths[month] ?? "01";
          return `${year}-${mm}-${day.padStart(2, "0")}`;
        }
        const [, a, b, c] = match;
        if (c.length === 4) return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
        if (a.length === 4) return `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}`;
      } catch { /* continue */ }
    }
  }

  // Try to extract year from filename
  const yearMatch = fileName.match(/20\d{2}/);
  if (yearMatch) return `${yearMatch[0]}-01-01`;

  return null;
}

export function guessCategory(fileName, text) {
  const name = fileName.toLowerCase();
  const content = (text ?? "").toLowerCase();
  const combined = `${name} ${content.slice(0, 500)}`;

  const rules = [
    ["maintenance", ["אחזקה", "תקלה", "קריאת שירות", "תיקון", "חשמל", "אינסטלציה", "מיזוג", "מעלית", "visitt"]],
    ["safety",      ["בטיחות", "תאונה", "אש", "נפילה", "חדר מיון", "חירום", "דליקה", "כיבוי"]],
    ["budget",      ["תקציב", "הוצאות", "הכנסות", "חשבונית", "הצעת מחיר", "ביצוע", "עלות", "מחיר", "שקל", "₪"]],
    ["projects",    ["פרויקט", "שיפוץ", "בנייה", "התקנה", "שדרוג", "החלפה", "חידוש"]],
    ["water",       ["מים", "ביוב", "צנרת", "טיהור", "לגיונלה"]],
    ["electricity", ["חשמל", "גנרטור", "לוח חשמל", "מתח", "קוט״ש", "קווט", "kwh"]],
    ["garden",      ["גינה", "גינון", "עצים", "ריסוס", "דשן", "השקיה"]],
    ["quality",     ["איכות", "בקרת איכות", "iso", "תלונות", "שביעות רצון"]],
    ["regulatory",  ["משרד הבריאות", "ביקורת", "ליקויים", "רגולציה", "רישוי", "בדיקה"]],
    ["hr",          ["כוח אדם", "עובדים", "שכר", "נוכחות", "משמרות"]],
  ];

  for (const [cat, keywords] of rules) {
    if (keywords.some((kw) => combined.includes(kw))) return cat;
  }
  return "general";
}
