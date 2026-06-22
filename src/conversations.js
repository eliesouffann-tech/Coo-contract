// In-memory conversation history per user (phone number)
// Each entry: { role: "user" | "assistant", content: string }
const conversations = new Map();

const MAX_HISTORY = 50; // max messages per user

export function getHistory(userId) {
  if (!conversations.has(userId)) {
    conversations.set(userId, []);
  }
  return conversations.get(userId);
}

export function addMessage(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content });

  // Trim oldest messages if limit exceeded (keep pairs)
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

export function clearHistory(userId) {
  conversations.set(userId, []);
}
