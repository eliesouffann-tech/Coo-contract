import express from "express";
import { randomUUID } from "crypto";
import { sendMessage } from "./whatsapp.js";
import {
  getNotes, saveNote, deleteNote,
  getTasks, addTask, completeTask, deleteTask,
  getContacts, saveContact,
  getProfile, saveProfile,
} from "./memory.js";
import { getUpcoming, addReminder, removeReminder } from "./scheduler.js";
import { getEmployeeRanking, getVendors, getProjects, getDecisions } from "./entities.js";
import { detectPatterns, getTaskAnalytics } from "./analytics.js";
import { isVisittReady, getWorkOrders, getStats as getVisittStats, createWorkOrder, updateWorkOrder } from "./visitt.js";

export const apiRouter = express.Router();

function authMiddleware(req, res, next) {
  const apiKey = process.env.N8N_API_KEY;
  if (!apiKey) return next();
  const provided = req.headers["x-api-key"] ?? req.query.api_key;
  if (provided !== apiKey) return res.status(401).json({ error: "Unauthorized" });
  next();
}

apiRouter.use(authMiddleware);

// ── Profile ────────────────────────────────────────────────────────────────────
apiRouter.get("/profile", (_req, res) => res.json(getProfile()));

apiRouter.put("/profile", (req, res) => {
  saveProfile({ ...getProfile(), ...req.body });
  res.json({ success: true });
});

// ── Messaging ──────────────────────────────────────────────────────────────────
apiRouter.post("/send", async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: "phone and message required" });
  try {
    await sendMessage(phone, message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Broadcast to multiple phones
apiRouter.post("/broadcast", async (req, res) => {
  const { phones, message } = req.body;
  if (!Array.isArray(phones) || !message) return res.status(400).json({ error: "phones[] and message required" });
  const results = await Promise.allSettled(phones.map((p) => sendMessage(p, message)));
  const summary = results.map((r, i) => ({
    phone: phones[i],
    ok: r.status === "fulfilled",
    error: r.reason?.message,
  }));
  res.json({ sent: summary.filter((s) => s.ok).length, total: phones.length, results: summary });
});

// ── Memory (notes) ─────────────────────────────────────────────────────────────
apiRouter.get("/memory", (_req, res) => res.json(getNotes()));

apiRouter.post("/memory", (req, res) => {
  const { key, value } = req.body;
  if (!key || !value) return res.status(400).json({ error: "key and value required" });
  saveNote(key, value);
  res.json({ success: true });
});

apiRouter.delete("/memory/:key", (req, res) => {
  deleteNote(decodeURIComponent(req.params.key));
  res.json({ success: true });
});

// ── Tasks ──────────────────────────────────────────────────────────────────────
apiRouter.get("/tasks", (req, res) => {
  const all = getTasks();
  res.json(req.query.filter === "pending" ? all.filter((t) => !t.done) : all);
});

apiRouter.post("/tasks", (req, res) => {
  const { title, due_date, notes } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  const task = addTask({ title, dueDate: due_date, notes });
  res.json({ success: true, task });
});

apiRouter.patch("/tasks/:id/complete", (req, res) => {
  const task = getTasks().find((t) => t.id.startsWith(req.params.id));
  if (!task) return res.status(404).json({ error: "Task not found" });
  completeTask(task.id);
  res.json({ success: true });
});

apiRouter.delete("/tasks/:id", (req, res) => {
  const task = getTasks().find((t) => t.id.startsWith(req.params.id));
  if (!task) return res.status(404).json({ error: "Task not found" });
  deleteTask(task.id);
  res.json({ success: true });
});

// ── Contacts ───────────────────────────────────────────────────────────────────
apiRouter.get("/contacts", (_req, res) => res.json(getContacts()));

apiRouter.post("/contacts", (req, res) => {
  const { phone, name, notes } = req.body;
  if (!phone || !name) return res.status(400).json({ error: "phone and name required" });
  saveContact(phone, name, notes ?? "");
  res.json({ success: true });
});

// ── Reminders ──────────────────────────────────────────────────────────────────
apiRouter.get("/reminders", (req, res) => {
  const phone = req.query.phone ?? getProfile().ownerPhone;
  res.json(getUpcoming(phone));
});

apiRouter.post("/reminders", (req, res) => {
  const { phone, message, datetime } = req.body;
  if (!phone || !message || !datetime) {
    return res.status(400).json({ error: "phone, message, and datetime required" });
  }
  const id = randomUUID();
  addReminder({ id, phone, message, datetime });
  res.json({ success: true, id });
});

apiRouter.delete("/reminders/:id", (req, res) => {
  const found = removeReminder(req.params.id);
  res.json({ success: found });
});

// ── Analytics & Entities (dashboard) ──────────────────────────────────────────
apiRouter.get("/employee-ranking", (_req, res) => {
  res.json({ ranking: getEmployeeRanking() });
});

apiRouter.get("/vendors", (_req, res) => {
  res.json({ vendors: Object.values(getVendors()) });
});

apiRouter.get("/projects", (_req, res) => {
  const ps = Object.values(getProjects());
  res.json({ projects: ps.map(p => ({ name: p.name, status: p.status, owner: p.owner, updatedAt: p.updatedAt, lastUpdate: p.updates?.slice(-1)[0]?.update ?? "—" })) });
});

apiRouter.get("/decisions", (req, res) => {
  const all = getDecisions();
  res.json(all.slice(0, parseInt(req.query.limit ?? "20")));
});

apiRouter.get("/analytics/tasks", (req, res) => {
  res.json(getTaskAnalytics(parseInt(req.query.days ?? "7")));
});

apiRouter.get("/analytics/patterns", (_req, res) => {
  res.json({ patterns: detectPatterns() });
});

// ── Visitt (real-time) ─────────────────────────────────────────────────────────
apiRouter.get("/visitt/work-orders", async (req, res) => {
  if (!isVisittReady()) return res.status(503).json({ error: "VISITT_API_TOKEN not configured" });
  try {
    const orders = await getWorkOrders({ status: req.query.status, priority: req.query.priority, limit: parseInt(req.query.limit ?? "50") });
    res.json({ count: orders.length, work_orders: orders });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

apiRouter.get("/visitt/stats", async (_req, res) => {
  if (!isVisittReady()) return res.status(503).json({ error: "VISITT_API_TOKEN not configured", visittReady: false });
  try { res.json({ ...(await getVisittStats()), visittReady: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

apiRouter.post("/visitt/work-orders", async (req, res) => {
  if (!isVisittReady()) return res.status(503).json({ error: "VISITT_API_TOKEN not configured" });
  try {
    const wo = await createWorkOrder(req.body);
    res.json({ success: true, work_order: wo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

apiRouter.patch("/visitt/work-orders/:id", async (req, res) => {
  if (!isVisittReady()) return res.status(503).json({ error: "VISITT_API_TOKEN not configured" });
  try {
    const wo = await updateWorkOrder(req.params.id, req.body);
    res.json({ success: true, work_order: wo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
