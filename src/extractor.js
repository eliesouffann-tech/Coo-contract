// Auto-extract tasks from Hebrew WhatsApp messages
import { scorePriority } from "./priority.js";

// Trigger keywords that indicate a task or action is needed
const TASK_TRIGGERS = [
  "צריך", "צריכה", "חייב", "חייבים", "נא ", "בבקשה", "אנא",
  "לטפל", "לסגור", "להזמין", "לתקן", "להוציא", "לבדוק",
  "לרכוש", "לשלוח", "לסדר", "לתאם", "להכין", "לוודא",
  "לדאוג", "לפנות", "לחדש", "להחליף", "לנקות", "לדווח",
  "יש לבצע", "יש לוודא", "יש לשלוח", "יש לטפל",
  "דחוף", "מיידי", "נפתחה קריאה", "קריאת שירות",
  "תקלה", "תיקון", "תחזוקה", "בעיה",
];

// Keywords that indicate the message is NOT a task (just info)
const EXCLUSION_PATTERNS = [
  /^(אוקי|בסדר|תודה|👍|✅|✔|הבנתי|קיבלתי|רק אומר|fyi)/i,
  /^(שאלה|שאלת)/i,
];

// Detect responsible person from common Hebrew patterns
const ASSIGNEE_PATTERNS = [
  /(?:אחראי|אחראית|מטפל|מטפלת|ביצוע)[:\s]+([א-ת\s]+?)(?:\.|,|$)/i,
  /ל([א-ת]+)\s+(?:לטפל|לבדוק|לתקן|לתאם)/i,
  /@([^\s]+)/,
];

export function shouldExtractTask(text) {
  if (!text || text.length < 8) return false;
  if (text.startsWith("/")) return false;

  for (const pat of EXCLUSION_PATTERNS) {
    if (pat.test(text.trim())) return false;
  }

  const lower = text.toLowerCase();
  return TASK_TRIGGERS.some(trigger => lower.includes(trigger));
}

export function extractTaskFromMessage(text, senderName, senderPhone) {
  if (!shouldExtractTask(text)) return null;

  const priority = scorePriority(text);

  // Try to detect who it's assigned to
  let assignee = null;
  for (const pat of ASSIGNEE_PATTERNS) {
    const m = text.match(pat);
    if (m) { assignee = m[1].trim(); break; }
  }

  // Clean up title — take first 100 chars
  const title = text.replace(/\n+/g, " ").slice(0, 100).trim();

  return {
    title,
    source: "whatsapp",
    senderName: senderName ?? senderPhone,
    senderPhone,
    assignee,
    priority: priority.level,
    priorityScore: priority.score,
    priorityReasons: priority.reasons,
    rawText: text,
    autoExtracted: true,
  };
}

// Analyze an array of messages for group insights
export function analyzeGroupMessages(messages) {
  const stats = {};

  for (const m of messages) {
    const k = m.phone;
    if (!stats[k]) {
      stats[k] = {
        phone: k, name: m.name ?? k, messageCount: 0,
        tasksMentioned: 0, questions: 0, responses: 0,
        avgResponseMin: null, firstSeen: m.timestamp, lastSeen: m.timestamp,
      };
    }
    const s = stats[k];
    s.messageCount++;
    s.lastSeen = m.timestamp;
    if (shouldExtractTask(m.text)) s.tasksMentioned++;
    if (/\?/.test(m.text) || /האם|מה|מי|מתי|כמה|איך|איפה|למה/.test(m.text)) s.questions++;
    if (/^(אוקי|בסדר|תודה|קיבלתי|הבנתי|✅|👍)/.test((m.text ?? "").trim())) s.responses++;
  }

  return Object.values(stats).sort((a, b) => b.messageCount - a.messageCount);
}

// Find unanswered requests in a message thread
export function findUnansweredRequests(messages) {
  const unanswered = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!shouldExtractTask(m.text)) continue;

    const after = messages.slice(i + 1, i + 10);
    const resolved = after.some(r =>
      /אוקי|בסדר|תטופל|טופל|בוצע|טיפלתי|תודה|✅|👍/.test(r.text ?? "")
    );
    if (!resolved) {
      unanswered.push({ ...m, daysSince: Math.round((Date.now() - new Date(m.timestamp)) / 86400000) });
    }
  }
  return unanswered.slice(0, 20);
}
