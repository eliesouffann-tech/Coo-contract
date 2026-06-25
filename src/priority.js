// Smart priority scoring for tasks
// Returns { score: 0-100, level: "קריטי"|"גבוה"|"בינוני"|"נמוך", reasons: [] }

const SAFETY_KEYWORDS = [
  "בטיחות", "סכנה", "חירום", "אמבולנס", "כיבוי אש", "עשן", "שריפה", "נפילה",
  "פציעה", "דם", "אוויר", "חשמל", "גז", "הצפה", "דליפה", "רעל",
];

const REGULATION_KEYWORDS = [
  "ביקורת", "משרד הבריאות", "רישיון", "תקן", "תקנה", "חוק", "אישור",
  "מכון התקנים", "כיבוי אש", "עירייה", "תעודה", "חידוש", "תם תוקף",
];

const RESIDENT_KEYWORDS = [
  "דייר", "מטופל", "תושב", "קשיש", "חולה", "נפגע", "פצוע", "אורח",
  "משפחה", "תלונה", "ייסורים", "כאב",
];

const URGENCY_KEYWORDS = [
  "דחוף", "מיידי", "עכשיו", "ברגע", "ASAP", "מהר", "הכי מהר",
  "לא יכול לחכות", "חייב היום",
];

const RECURRING_BONUS = 15;

export function scorePriority(text, options = {}) {
  const t = (text ?? "").toLowerCase();
  const reasons = [];
  let score = 20; // base

  // Safety (40 pts max)
  const safetyHits = SAFETY_KEYWORDS.filter(k => t.includes(k));
  if (safetyHits.length) {
    score += Math.min(40, safetyHits.length * 15);
    reasons.push(`⚠️ בטיחות: ${safetyHits.join(", ")}`);
  }

  // Regulation (25 pts max)
  const regHits = REGULATION_KEYWORDS.filter(k => t.includes(k));
  if (regHits.length) {
    score += Math.min(25, regHits.length * 12);
    reasons.push(`📋 רגולציה: ${regHits.join(", ")}`);
  }

  // Resident impact (20 pts max)
  const resHits = RESIDENT_KEYWORDS.filter(k => t.includes(k));
  if (resHits.length) {
    score += Math.min(20, resHits.length * 10);
    reasons.push(`👥 השפעה על דיירים: ${resHits.join(", ")}`);
  }

  // Urgency (15 pts max)
  const urgHits = URGENCY_KEYWORDS.filter(k => t.includes(k));
  if (urgHits.length) {
    score += Math.min(15, urgHits.length * 8);
    reasons.push(`🔴 דחיפות: ${urgHits.join(", ")}`);
  }

  // Recurring issue bonus
  if (options.isRecurring) {
    score += RECURRING_BONUS;
    reasons.push(`🔁 בעיה חוזרת (+${RECURRING_BONUS})`);
  }

  score = Math.min(100, score);

  let level;
  if (score >= 80) level = "קריטי";
  else if (score >= 55) level = "גבוה";
  else if (score >= 35) level = "בינוני";
  else level = "נמוך";

  return { score, level, reasons };
}

export function priorityEmoji(level) {
  return { "קריטי": "🔴", "גבוה": "🟠", "בינוני": "🟡", "נמוך": "🟢" }[level] ?? "⚪";
}
