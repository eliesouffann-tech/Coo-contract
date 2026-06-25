import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data");

function ensure() { if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true }); }
function read(f, d) { ensure(); const p = join(DATA_DIR, f); if (!existsSync(p)) return d; try { return JSON.parse(readFileSync(p, "utf8")); } catch { return d; } }
function write(f, d) { ensure(); writeFileSync(join(DATA_DIR, f), JSON.stringify(d, null, 2)); }

// ─── EMPLOYEES ────────────────────────────────────────────────────────────────
export function getEmployees() { return read("employees.json", {}); }
export function getEmployee(idOrPhone) {
  const all = getEmployees();
  return all[idOrPhone] ?? Object.values(all).find(e => e.phone === idOrPhone) ?? null;
}

export function saveEmployee({ id, name, phone, role, department, startDate, notes }) {
  const all = getEmployees();
  const key = id ?? phone ?? randomUUID();
  all[key] = {
    id: key, name, phone: phone ?? "", role: role ?? "", department: department ?? "",
    startDate: startDate ?? new Date().toISOString().slice(0, 10),
    notes: notes ?? "",
    stats: all[key]?.stats ?? {
      tasksAssigned: 0, tasksCompleted: 0, tasksOverdue: 0,
      avgResponseMin: null, responseCount: 0, responseTotal: 0,
      onTimeRate: 100, performanceScore: 100,
    },
    performanceLog: all[key]?.performanceLog ?? [],
    updatedAt: new Date().toISOString(),
  };
  write("employees.json", all);
  return all[key];
}

export function logEmployeeEvent(phone, type, data = {}) {
  const all = getEmployees();
  const emp = Object.values(all).find(e => e.phone === phone);
  if (!emp) return;
  const key = emp.id;
  const stats = all[key].stats;

  if (type === "task_assigned") stats.tasksAssigned++;
  if (type === "task_completed") { stats.tasksCompleted++; }
  if (type === "task_overdue") { stats.tasksOverdue++; }
  if (type === "response" && data.minutes != null) {
    stats.responseCount++;
    stats.responseTotal += data.minutes;
    stats.avgResponseMin = Math.round(stats.responseTotal / stats.responseCount);
  }

  // Recalculate performance score (0-100)
  const completionRate = stats.tasksAssigned > 0 ? stats.tasksCompleted / stats.tasksAssigned : 1;
  const overdueRate = stats.tasksAssigned > 0 ? stats.tasksOverdue / stats.tasksAssigned : 0;
  stats.performanceScore = Math.round(Math.max(0, Math.min(100,
    completionRate * 60 + (1 - overdueRate) * 30 + (data.note ? 10 : 0)
  )));

  if (data.note) {
    all[key].performanceLog.push({ date: new Date().toISOString(), type, note: data.note });
    all[key].performanceLog = all[key].performanceLog.slice(-100);
  }

  write("employees.json", all);
}

export function getEmployeeRanking() {
  return Object.values(getEmployees())
    .sort((a, b) => (b.stats?.performanceScore ?? 0) - (a.stats?.performanceScore ?? 0))
    .map((e, i) => ({
      rank: i + 1, name: e.name, role: e.role, department: e.department,
      score: e.stats?.performanceScore ?? "—",
      tasksAssigned: e.stats?.tasksAssigned ?? 0,
      tasksCompleted: e.stats?.tasksCompleted ?? 0,
      tasksOverdue: e.stats?.tasksOverdue ?? 0,
      avgResponseMin: e.stats?.avgResponseMin ?? "—",
    }));
}

// ─── VENDORS ─────────────────────────────────────────────────────────────────
export function getVendors() { return read("vendors.json", {}); }

export function saveVendor({ id, name, contact, phone, email, services, rating, notes }) {
  const all = getVendors();
  const key = id ?? randomUUID();
  all[key] = {
    id: key, name, contact: contact ?? "", phone: phone ?? "", email: email ?? "",
    services: services ?? [], rating: rating ?? null, notes: notes ?? "",
    history: all[key]?.history ?? [],
    updatedAt: new Date().toISOString(),
  };
  write("vendors.json", all);
  return all[key];
}

export function rateVendor(id, rating, note) {
  const all = getVendors();
  if (!all[id]) return null;
  all[id].rating = rating;
  all[id].history.push({ date: new Date().toISOString(), rating, note: note ?? "" });
  write("vendors.json", all);
  return all[id];
}

// ─── PROJECTS ─────────────────────────────────────────────────────────────────
export function getProjects() { return read("projects.json", {}); }

export function saveProject({ id, name, status, owner, team, budget, startDate, endDate, description }) {
  const all = getProjects();
  const key = id ?? randomUUID();
  all[key] = {
    id: key, name, status: status ?? "פעיל",
    owner: owner ?? "", team: team ?? [],
    budget: budget ?? null, spent: all[key]?.spent ?? 0,
    startDate: startDate ?? new Date().toISOString().slice(0, 10),
    endDate: endDate ?? null,
    description: description ?? "",
    updates: all[key]?.updates ?? [],
    tasksCount: all[key]?.tasksCount ?? 0,
    updatedAt: new Date().toISOString(),
  };
  write("projects.json", all);
  return all[key];
}

export function addProjectUpdate(id, update, author) {
  const all = getProjects();
  if (!all[id]) return null;
  all[id].updates.push({ date: new Date().toISOString(), update, author: author ?? "" });
  all[id].updatedAt = new Date().toISOString();
  write("projects.json", all);
  return all[id];
}

// ─── DECISIONS LOG ────────────────────────────────────────────────────────────
export function getDecisions() { return read("decisions.json", []); }

export function logDecision({ topic, content, madeBy, context, followUp }) {
  const all = getDecisions();
  const dec = {
    id: randomUUID(),
    date: new Date().toISOString(),
    topic: topic ?? "", content, madeBy: madeBy ?? "",
    context: context ?? "", followUp: followUp ?? "",
    status: "פעיל",
  };
  all.unshift(dec);
  write("decisions.json", all.slice(0, 500));
  return dec;
}

export function searchDecisions(query) {
  const q = query.toLowerCase();
  return getDecisions().filter(d =>
    d.topic.toLowerCase().includes(q) ||
    d.content.toLowerCase().includes(q) ||
    d.madeBy.toLowerCase().includes(q) ||
    d.context.toLowerCase().includes(q)
  ).slice(0, 10);
}

// ─── MESSAGE LOG (for group analysis) ────────────────────────────────────────
export function logMessage({ phone, name, group, text, type, timestamp }) {
  const file = "messages_log.json";
  const all = read(file, []);
  all.push({
    phone, name: name ?? phone, group: group ?? null,
    text: text ?? "", type: type ?? "text",
    timestamp: timestamp ?? new Date().toISOString(),
  });
  // Keep last 5000 messages
  write(file, all.slice(-5000));
}

export function getMessages({ phone, group, since, limit = 100 } = {}) {
  let msgs = read("messages_log.json", []);
  if (phone) msgs = msgs.filter(m => m.phone === phone);
  if (group) msgs = msgs.filter(m => m.group === group);
  if (since) msgs = msgs.filter(m => new Date(m.timestamp) >= new Date(since));
  return msgs.slice(-limit);
}

export function searchMessages(query) {
  const q = query.toLowerCase();
  return read("messages_log.json", [])
    .filter(m => m.text?.toLowerCase().includes(q))
    .slice(-50);
}
