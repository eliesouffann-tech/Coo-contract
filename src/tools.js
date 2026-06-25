import { randomUUID } from "crypto";
import { addReminder, removeReminder, getUpcoming } from "./scheduler.js";
import {
  saveNote, deleteNote, getAllNotesText,
  getProfile, saveProfile,
  saveContact, getContactName, getAllContactsText,
  addTask, completeTask, deleteTask, getTasksText, getTasks,
} from "./memory.js";
import { createEvent, listEvents, deleteEvent, isCalendarReady } from "./calendar.js";
import { sendEmail, isEmailReady } from "./email.js";
import { triggerN8nWorkflow, isN8nReady } from "./n8n.js";
import {
  saveEmployee, getEmployee, getEmployees, logEmployeeEvent, getEmployeeRanking,
  saveVendor, getVendors, rateVendor,
  saveProject, getProjects, addProjectUpdate,
  logDecision, searchDecisions,
  searchMessages, getMessages,
} from "./entities.js";
import { getTaskAnalytics, detectPatterns, getEmployeeInsights } from "./analytics.js";
import { generateDailyReport, generateWeeklyReport, generateAuditReport } from "./report.js";
import { scorePriority } from "./priority.js";
import {
  isVisittReady, getWorkOrders, createWorkOrder, updateWorkOrder,
  getStats as getVisittStats, getCategories,
  statusHe, priorityHe, priorityEmoji as visittPriorityEmoji,
} from "./visitt.js";

// Core tools only — trimmed to reduce token usage (full execution logic kept below)
export const TOOLS = [
  { name: "save_to_memory", description: "שמור מידע לזיכרון", input_schema: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] } },
  { name: "get_memory", description: "הצג זיכרון שמור", input_schema: { type: "object", properties: {} } },
  { name: "save_contact", description: "שמור איש קשר", input_schema: { type: "object", properties: { phone: { type: "string" }, name: { type: "string" }, notes: { type: "string" } }, required: ["phone", "name"] } },
  { name: "add_task", description: "הוסף משימה", input_schema: { type: "object", properties: { title: { type: "string" }, due_date: { type: "string" }, notes: { type: "string" } }, required: ["title"] } },
  { name: "add_task_with_priority", description: "הוסף משימה עם ניתוח עדיפות (בטיחות/רגולציה/דיירים/עלות)", input_schema: { type: "object", properties: { title: { type: "string" }, due_date: { type: "string" }, notes: { type: "string" }, assignee: { type: "string" } }, required: ["title"] } },
  { name: "complete_task", description: "סמן משימה כהושלמה", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "list_tasks", description: "הצג משימות", input_schema: { type: "object", properties: { filter: { type: "string", enum: ["pending", "all"] } } } },
  { name: "set_reminder", description: "קבע תזכורת WhatsApp", input_schema: { type: "object", properties: { message: { type: "string" }, datetime: { type: "string", description: "ISO 8601" }, phone: { type: "string" } }, required: ["message", "datetime", "phone"] } },
  { name: "cancel_reminder", description: "בטל תזכורת", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "send_email", description: "שלח מייל", input_schema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] } },
  { name: "log_decision", description: "תעד החלטה ניהולית", input_schema: { type: "object", properties: { topic: { type: "string" }, content: { type: "string" }, made_by: { type: "string" }, follow_up: { type: "string" } }, required: ["topic", "content"] } },
  { name: "search_decisions", description: "חפש בהחלטות", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "search_history", description: "חפש בהיסטוריה", input_schema: { type: "object", properties: { query: { type: "string" }, person: { type: "string" } }, required: ["query"] } },
  { name: "save_employee", description: "שמור עובד", input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, role: { type: "string" }, department: { type: "string" }, notes: { type: "string" } }, required: ["name"] } },
  { name: "list_employees", description: "הצג עובדים", input_schema: { type: "object", properties: { department: { type: "string" } } } },
  { name: "visitt_get_stats", description: "סטטיסטיקות Visitt: קריאות פתוחות, באיחור, קריטיות", input_schema: { type: "object", properties: {} } },
  { name: "visitt_create_work_order", description: "פתח קריאת שירות ב-Visitt", input_schema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, location: { type: "string" }, priority: { type: "string", enum: ["critical", "urgent", "high", "normal", "low"] } }, required: ["title"] } },
  { name: "visitt_update_work_order", description: "עדכן קריאת Visitt", input_schema: { type: "object", properties: { work_order_id: { type: "string" }, status: { type: "string" }, note: { type: "string" } }, required: ["work_order_id"] } },
  { name: "generate_daily_report", description: "הפק דוח יומי", input_schema: { type: "object", properties: {} } },
  { name: "generate_weekly_report", description: "הפק דוח שבועי", input_schema: { type: "object", properties: {} } },
];

export async function executeTool(name, input) {
  switch (name) {
    // Memory
    case "save_to_memory":
      saveNote(input.key, input.value);
      return { success: true };
    case "delete_from_memory":
      deleteNote(input.key);
      return { success: true };
    case "get_memory":
      return { notes: getAllNotesText() };

    // Contacts
    case "save_contact":
      saveContact(input.phone, input.name, input.notes ?? "");
      return { success: true };
    case "get_all_contacts":
      return { contacts: getAllContactsText() };

    // Tasks
    case "add_task": {
      const task = addTask({ title: input.title, dueDate: input.due_date, notes: input.notes });
      return { success: true, id: task.id.slice(0, 6) };
    }
    case "list_tasks":
      return { tasks: getTasksText(input.filter ?? "pending") };
    case "complete_task": {
      // Match by partial ID
      const tasks = (await import("./memory.js")).getTasks();
      const task = tasks.find((t) => t.id.startsWith(input.id));
      if (task) { completeTask(task.id); return { success: true }; }
      return { success: false, error: "משימה לא נמצאה" };
    }
    case "delete_task": {
      const tasks2 = (await import("./memory.js")).getTasks();
      const task2 = tasks2.find((t) => t.id.startsWith(input.id));
      if (task2) { deleteTask(task2.id); return { success: true }; }
      return { success: false };
    }

    // Reminders
    case "set_reminder": {
      const id = randomUUID();
      addReminder({ id, phone: input.phone, message: input.message, datetime: input.datetime });
      return {
        success: true,
        id,
        scheduledFor: new Date(input.datetime).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" }),
      };
    }
    case "cancel_reminder": {
      const found = removeReminder(input.id);
      return { success: found };
    }
    case "list_reminders": {
      const list = getUpcoming(input.phone);
      return {
        reminders: list.map((r) => ({
          id: r.id,
          message: r.message,
          scheduledFor: new Date(r.datetime).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" }),
        })),
      };
    }

    // Calendar
    case "create_calendar_event": {
      if (!isCalendarReady()) return { error: "Google Calendar לא מחובר. הפעל: npm run auth-google" };
      const event = await createEvent({
        title: input.title,
        startDatetime: input.start_datetime,
        endDatetime: input.end_datetime,
        description: input.description ?? "",
        attendees: input.attendees ?? [],
      });
      return { success: true, ...event };
    }
    case "list_calendar_events": {
      if (!isCalendarReady()) return { error: "Google Calendar לא מחובר. הפעל: npm run auth-google" };
      const events = await listEvents(input.date);
      return { events };
    }
    case "delete_calendar_event": {
      if (!isCalendarReady()) return { error: "Google Calendar לא מחובר" };
      return await deleteEvent(input.event_id);
    }

    // Email
    case "send_email": {
      if (!isEmailReady()) return { error: "אימייל לא מוגדר. הוסף EMAIL_ADDRESS ו-EMAIL_APP_PASSWORD ל-.env" };
      return await sendEmail({
        to: input.to,
        subject: input.subject,
        body: input.body,
        replyTo: input.reply_to,
      });
    }

    // Profile
    case "update_profile": {
      const current = getProfile();
      saveProfile({ ...current, ...input });
      return { success: true };
    }

    // ── Visitt ─────────────────────────────────────────────────────────────────
    case "visitt_get_work_orders": {
      if (!isVisittReady()) return { error: "VISITT_API_TOKEN לא מוגדר ב-.env" };
      const orders = await getWorkOrders({ status: input.status, priority: input.priority, limit: input.limit ?? 20 });
      return {
        count: orders.length,
        work_orders: orders.map(w => ({
          id: w._id,
          title: w.title,
          status: statusHe(w.status),
          priority: priorityHe(w.priority),
          priorityEmoji: visittPriorityEmoji(w.priority),
          category: w.category?.name ?? "—",
          location: w.location ?? "—",
          assignedTo: w.assignedTo?.name ?? "לא שויך",
          dueDate: w.dueDate ?? "—",
          createdAt: w.createdAt,
        })),
      };
    }

    case "visitt_get_stats": {
      if (!isVisittReady()) return { error: "VISITT_API_TOKEN לא מוגדר ב-.env" };
      const stats = await getVisittStats();
      return {
        open: stats.open,
        overdue: stats.overdue,
        critical: stats.critical,
        total: stats.total,
        byStatus: stats.byStatus,
        byPriority: stats.byPriority,
        topCategories: Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5),
        overdueList: stats.overdueList.map(w => ({ id: w._id, title: w.title, dueDate: w.dueDate })),
        criticalList: stats.criticalList.map(w => ({ id: w._id, title: w.title, status: statusHe(w.status) })),
      };
    }

    case "visitt_create_work_order": {
      if (!isVisittReady()) return { error: "VISITT_API_TOKEN לא מוגדר ב-.env" };
      const wo = await createWorkOrder({
        title: input.title,
        description: input.description,
        location: input.location,
        priority: input.priority ?? "normal",
        dueDate: input.due_date,
      });
      console.log(`🔧 Visitt WO created: ${wo._id} — ${input.title}`);
      return { success: true, id: wo._id, title: wo.title, status: statusHe(wo.status) };
    }

    case "visitt_update_work_order": {
      if (!isVisittReady()) return { error: "VISITT_API_TOKEN לא מוגדר ב-.env" };
      const wo = await updateWorkOrder(input.work_order_id, {
        status: input.status,
        priority: input.priority,
        note: input.note,
      });
      return { success: true, id: wo?._id, status: statusHe(wo?.status), updatedAt: wo?.updatedAt };
    }

    case "visitt_get_categories": {
      if (!isVisittReady()) return { error: "VISITT_API_TOKEN לא מוגדר ב-.env" };
      const cats = await getCategories();
      return { categories: cats.map(c => ({ id: c._id, name: c.name, subcategories: c.subcategories?.map(s => s.name) ?? [] })) };
    }

    // n8n
    case "trigger_n8n_workflow": {
      if (!isN8nReady()) return { error: "n8n לא מוגדר. הוסף N8N_WEBHOOK_URL ל-.env" };
      console.log(`🔀 n8n trigger: ${input.description ?? input.webhook_path}`);
      return await triggerN8nWorkflow(input.webhook_path, input.data ?? {});
    }

    // ── Employees ──────────────────────────────────────────────────────────────
    case "save_employee":
      return { success: true, employee: saveEmployee({ name: input.name, phone: input.phone, role: input.role, department: input.department, notes: input.notes, startDate: input.start_date }) };

    case "get_employee": {
      const q = input.query;
      const all = Object.values(getEmployees());
      const emp = all.find(e =>
        e.name?.includes(q) || e.phone === q || e.role?.includes(q) || e.department?.includes(q)
      );
      if (!emp) return { error: `עובד לא נמצא: ${q}` };
      return emp;
    }

    case "list_employees": {
      const all = Object.values(getEmployees());
      const filtered = input.department ? all.filter(e => e.department?.includes(input.department)) : all;
      return { employees: filtered.map(e => ({ name: e.name, role: e.role, department: e.department, score: e.stats?.performanceScore ?? "—", phone: e.phone })) };
    }

    case "log_employee_performance": {
      const all = Object.values(getEmployees());
      const emp = all.find(e => e.name?.includes(input.name ?? "") || e.phone === input.phone);
      if (!emp) return { error: "עובד לא נמצא — הוסף אותו קודם עם save_employee" };
      logEmployeeEvent(emp.phone, input.event_type, { note: input.note });
      return { success: true };
    }

    case "get_employee_ranking":
      return { ranking: getEmployeeRanking() };

    // ── Vendors ────────────────────────────────────────────────────────────────
    case "save_vendor":
      return { success: true, vendor: saveVendor(input) };

    case "list_vendors": {
      const vs = Object.values(getVendors());
      return { vendors: vs.map(v => ({ name: v.name, phone: v.phone, services: v.services, rating: v.rating })) };
    }

    case "rate_vendor": {
      const vs = Object.values(getVendors());
      const vendor = vs.find(v => v.name?.includes(input.vendor_name));
      if (!vendor) return { error: "ספק לא נמצא — הוסף אותו קודם עם save_vendor" };
      return { success: true, vendor: rateVendor(vendor.id, input.rating, input.note) };
    }

    // ── Projects ───────────────────────────────────────────────────────────────
    case "create_project":
      return { success: true, project: saveProject({ name: input.name, status: input.status, owner: input.owner, team: input.team, budget: input.budget, startDate: input.start_date, endDate: input.end_date, description: input.description }) };

    case "list_projects": {
      const ps = Object.values(getProjects());
      const filtered = input.status ? ps.filter(p => p.status === input.status) : ps;
      return { projects: filtered.map(p => ({ name: p.name, status: p.status, owner: p.owner, updatedAt: p.updatedAt, lastUpdate: p.updates?.slice(-1)[0]?.update ?? "—" })) };
    }

    case "add_project_update": {
      const ps = Object.values(getProjects());
      const proj = ps.find(p => p.name?.includes(input.project_name));
      if (!proj) return { error: "פרויקט לא נמצא — צור אותו קודם עם create_project" };
      return { success: true, project: addProjectUpdate(proj.id, input.update, input.author) };
    }

    // ── Decisions ──────────────────────────────────────────────────────────────
    case "log_decision":
      return { success: true, decision: logDecision({ topic: input.topic, content: input.content, madeBy: input.made_by, context: input.context, followUp: input.follow_up }) };

    case "search_decisions":
      return { decisions: searchDecisions(input.query) };

    // ── Reports & Analytics ────────────────────────────────────────────────────
    case "generate_daily_report":
      return { report: generateDailyReport() };

    case "generate_weekly_report":
      return { report: generateWeeklyReport() };

    case "generate_audit_report":
      return { report: generateAuditReport(input.topic) };

    case "detect_patterns":
      return { patterns: detectPatterns() };

    case "get_task_analytics":
      return getTaskAnalytics(input.days ?? 7);

    case "get_employee_insights":
      return getEmployeeInsights();

    // ── Search & History ───────────────────────────────────────────────────────
    case "search_history": {
      const msgs = searchMessages(input.query);
      const tasks = getTasks().filter(t => t.title?.includes(input.query) || t.notes?.includes(input.query));
      const decisions = searchDecisions(input.query);
      return {
        messages: msgs.slice(0, 10).map(m => ({ name: m.name, text: m.text, timestamp: m.timestamp })),
        tasks: tasks.slice(0, 5).map(t => ({ title: t.title, status: t.done ? "הושלם" : "פתוח", created: t.createdAt })),
        decisions: decisions.slice(0, 5),
      };
    }

    case "add_task_with_priority": {
      const priority = scorePriority(input.title + " " + (input.notes ?? ""));
      const notes = [input.notes, input.assignee ? `אחראי: ${input.assignee}` : "", input.project ? `פרויקט: ${input.project}` : "", priority.reasons.join(" | ")].filter(Boolean).join("\n");
      const task = addTask({ title: input.title, dueDate: input.due_date, notes });
      // Store priority on task — patch the tasks file
      const { getTasks: gt } = await import("./memory.js");
      const all = gt();
      const t = all.find(x => x.id === task.id);
      if (t) { t.priority = priority.level; t.priorityScore = priority.score; }
      const { writeFileSync } = await import("fs");
      const { join, dirname } = await import("path");
      const { fileURLToPath } = await import("url");
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../data");
      writeFileSync(join(dir, "tasks.json"), JSON.stringify(all, null, 2));
      return { success: true, id: task.id.slice(0, 6), priority: priority.level, score: priority.score, reasons: priority.reasons };
    }

    default:
      return { error: `כלי לא מוכר: ${name}` };
  }
}

// Convert Anthropic tool schema → Gemini FunctionDeclaration format
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const result = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "type" && typeof v === "string") {
      result[k] = v.toUpperCase();
    } else if (k === "properties") {
      result[k] = Object.fromEntries(
        Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)])
      );
    } else if (k === "items") {
      result[k] = toGeminiSchema(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

export const GEMINI_TOOLS = TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: toGeminiSchema(tool.input_schema),
}));
