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

export const TOOLS = [
  // ── Memory ──────────────────────────────────────────────────────────────────
  {
    name: "save_to_memory",
    description: "שומר מידע חשוב לזיכרון ארוך-טווח: עובדות, תאריכים, מספרי טלפון, פרטים חשובים.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "נושא קצר, למשל: 'רכב', 'רופא', 'חשבון בנק'" },
        value: { type: "string", description: "תוכן המידע" },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "delete_from_memory",
    description: "מוחק מידע מהזיכרון",
    input_schema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "get_memory",
    description: "מביא את כל המידע השמור בזיכרון",
    input_schema: { type: "object", properties: {} },
  },

  // ── Contacts ─────────────────────────────────────────────────────────────────
  {
    name: "save_contact",
    description: "שומר איש קשר — שם למספר טלפון. קרא לכלי זה כשמישהו מציין את שמו או כשהבעלים מבקש לשמור איש קשר.",
    input_schema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "מספר טלפון (כולל קידומת מדינה, ללא +)" },
        name: { type: "string", description: "שם מלא" },
        notes: { type: "string", description: "פרטים נוספים (תפקיד, קשר לבעלים וכו')" },
      },
      required: ["phone", "name"],
    },
  },
  {
    name: "get_all_contacts",
    description: "מביא את כל אנשי הקשר השמורים",
    input_schema: { type: "object", properties: {} },
  },

  // ── Tasks ─────────────────────────────────────────────────────────────────────
  {
    name: "add_task",
    description: "מוסיף משימה לרשימת המשימות",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "תיאור המשימה" },
        due_date: { type: "string", description: "תאריך יעד בפורמט ISO (אופציונלי)" },
        notes: { type: "string", description: "פרטים נוספים (אופציונלי)" },
      },
      required: ["title"],
    },
  },
  {
    name: "list_tasks",
    description: "מציג את רשימת המשימות",
    input_schema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["pending", "all"], description: "pending = פתוחות בלבד, all = הכל" },
      },
    },
  },
  {
    name: "complete_task",
    description: "מסמן משימה כהושלמה",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "מזהה המשימה (6 תווים ראשונים מספיקים)" } },
      required: ["id"],
    },
  },
  {
    name: "delete_task",
    description: "מוחק משימה",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },

  // ── Reminders ────────────────────────────────────────────────────────────────
  {
    name: "set_reminder",
    description: "קובע תזכורת שתישלח ב-WhatsApp בזמן מסוים. השתמש כשמישהו אומר 'תזכיר לי...'",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string" },
        datetime: { type: "string", description: "ISO 8601, למשל 2024-12-25T09:00:00" },
        phone: { type: "string" },
      },
      required: ["message", "datetime", "phone"],
    },
  },
  {
    name: "cancel_reminder",
    description: "מבטל תזכורת לפי מזהה",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "list_reminders",
    description: "מציג תזכורות פעילות",
    input_schema: {
      type: "object",
      properties: { phone: { type: "string" } },
      required: ["phone"],
    },
  },

  // ── Google Calendar ───────────────────────────────────────────────────────────
  {
    name: "create_calendar_event",
    description: "יוצר אירוע ב-Google Calendar של הבעלים. השתמש כשמבקשים לקבוע פגישה.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "שם הפגישה/אירוע" },
        start_datetime: { type: "string", description: "ISO 8601" },
        end_datetime: { type: "string", description: "ISO 8601" },
        description: { type: "string", description: "פרטים נוספים" },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "כתובות אימייל של משתתפים",
        },
      },
      required: ["title", "start_datetime", "end_datetime"],
    },
  },
  {
    name: "list_calendar_events",
    description: "מציג אירועים ב-Google Calendar לתאריך מסוים (ברירת מחדל: היום)",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "ISO date, למשל 2024-12-25 (ברירת מחדל: היום)" },
      },
    },
  },
  {
    name: "delete_calendar_event",
    description: "מוחק אירוע מ-Google Calendar",
    input_schema: {
      type: "object",
      properties: { event_id: { type: "string" } },
      required: ["event_id"],
    },
  },

  // ── Email ─────────────────────────────────────────────────────────────────────
  {
    name: "send_email",
    description: "שולח אימייל מכתובת האימייל של הבעלים. השתמש כשמבקשים לשלוח מייל.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "כתובת אימייל של הנמען" },
        subject: { type: "string", description: "נושא המייל" },
        body: { type: "string", description: "גוף המייל" },
        reply_to: { type: "string", description: "כתובת reply-to (אופציונלי)" },
      },
      required: ["to", "subject", "body"],
    },
  },

  // ── Profile ───────────────────────────────────────────────────────────────────
  {
    name: "update_profile",
    description: "מעדכן את הפרופיל של הבעלים — שם, תפקיד, סגנון כתיבה",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role: { type: "string" },
        style: { type: "string", description: "תיאור סגנון כתיבה" },
        ownerPhone: { type: "string" },
      },
    },
  },

  // ── n8n Automation ────────────────────────────────────────────────────────────
  {
    name: "trigger_n8n_workflow",
    description: "מפעיל workflow ב-n8n דרך webhook.",
    input_schema: {
      type: "object",
      properties: {
        webhook_path: { type: "string" },
        data: { type: "object" },
        description: { type: "string" },
      },
      required: ["webhook_path"],
    },
  },

  // ── EMPLOYEES ─────────────────────────────────────────────────────────────────
  {
    name: "save_employee",
    description: "שומר או מעדכן כרטיס עובד. קרא לכלי זה כשנאמר 'הוסף עובד', 'שמור עובד', או כשמתוודעים לעובד חדש.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        role: { type: "string" },
        department: { type: "string" },
        notes: { type: "string" },
        start_date: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_employee",
    description: "מביא כרטיס עובד עם נתוני ביצוע — לפי שם או מספר טלפון.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "שם עובד, מספר טלפון, או מחלקה" } },
      required: ["query"],
    },
  },
  {
    name: "list_employees",
    description: "מציג את רשימת כל העובדים עם דירוג ביצועים.",
    input_schema: { type: "object", properties: { department: { type: "string" } } },
  },
  {
    name: "log_employee_performance",
    description: "מתעד אירוע ביצועים לעובד — השלמת משימה, איחור, יוזמה, תלונה, שבח.",
    input_schema: {
      type: "object",
      properties: {
        phone: { type: "string" },
        name: { type: "string" },
        event_type: { type: "string", enum: ["task_completed", "task_overdue", "task_assigned", "positive_note", "negative_note"] },
        note: { type: "string" },
      },
      required: ["event_type", "note"],
    },
  },
  {
    name: "get_employee_ranking",
    description: "מציג דירוג ביצועים של כל העובדים — מי הכי טוב, מי דורש שיפור.",
    input_schema: { type: "object", properties: {} },
  },

  // ── VENDORS ───────────────────────────────────────────────────────────────────
  {
    name: "save_vendor",
    description: "שומר ספק או קבלן עם פרטי קשר ושירותים.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        contact: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        services: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_vendors",
    description: "מציג רשימת כל הספקים עם דירוגים.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "rate_vendor",
    description: "מדרג ביצועי ספק (1-5 כוכבים) ומתעד הערה.",
    input_schema: {
      type: "object",
      properties: {
        vendor_name: { type: "string" },
        rating: { type: "number" },
        note: { type: "string" },
      },
      required: ["vendor_name", "rating"],
    },
  },

  // ── PROJECTS ──────────────────────────────────────────────────────────────────
  {
    name: "create_project",
    description: "יוצר פרויקט חדש עם בעלים, צוות, תקציב ותאריכים.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        status: { type: "string", enum: ["פעיל", "מושהה", "הושלם", "בתכנון"] },
        owner: { type: "string" },
        team: { type: "array", items: { type: "string" } },
        budget: { type: "number" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        description: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_projects",
    description: "מציג את כל הפרויקטים עם סטטוס ועדכונים אחרונים.",
    input_schema: {
      type: "object",
      properties: { status: { type: "string", description: "סנן לפי סטטוס (אופציונלי)" } },
    },
  },
  {
    name: "add_project_update",
    description: "מוסיף עדכון לפרויקט — מה קרה, מה הושג, מה הבא.",
    input_schema: {
      type: "object",
      properties: {
        project_name: { type: "string" },
        update: { type: "string" },
        author: { type: "string" },
      },
      required: ["project_name", "update"],
    },
  },

  // ── DECISIONS LOG ─────────────────────────────────────────────────────────────
  {
    name: "log_decision",
    description: "מתעד החלטה ניהולית בספר ההחלטות הארגוני. השתמש כשמתקבלת החלטה משמעותית.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "נושא ההחלטה (מילה או שתיים)" },
        content: { type: "string", description: "תוכן ההחלטה" },
        made_by: { type: "string", description: "מי קיבל את ההחלטה" },
        context: { type: "string", description: "הקשר — מה הוביל להחלטה זו" },
        follow_up: { type: "string", description: "פעולות המשך שנדרשות" },
      },
      required: ["topic", "content"],
    },
  },
  {
    name: "search_decisions",
    description: "מחפש בספר ההחלטות — 'מה הוחלט על ספק X?', 'מה ההחלטה לגבי הגנרטור?'",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },

  // ── ANALYTICS & REPORTS ───────────────────────────────────────────────────────
  {
    name: "generate_daily_report",
    description: "מפיק דוח תפעולי יומי — משימות, קריטיות, איחורים, תובנות. שלח כל בוקר לבעלים.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "generate_weekly_report",
    description: "מפיק דוח ניהולי שבועי מלא עם KPIs, דירוג עובדים, דפוסים, המלצות.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "generate_audit_report",
    description: "מכין תיק ביקורת מסודר — למשרד הבריאות, כיבוי אש, מכון התקנים. בלחיצה אחת.",
    input_schema: {
      type: "object",
      properties: { topic: { type: "string", description: "סוג הביקורת: בריאות, בטיחות, כיבוי אש, כללי" } },
    },
  },
  {
    name: "detect_patterns",
    description: "מזהה דפוסים חוזרים — תקלות, עיכובים, בעיות מבניות, ספקים בעייתיים.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_task_analytics",
    description: "נתוני ניתוח משימות — כמה נפתחו, נסגרו, זמן סגירה ממוצע, עמידה ביעדים.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "מספר ימים אחורה (ברירת מחדל: 7)" } },
    },
  },
  {
    name: "get_employee_insights",
    description: "תובנות על ביצועי עובדים — מי מצטיין, מי דורש תשומת לב, ממוצע ציונים.",
    input_schema: { type: "object", properties: {} },
  },

  // ── SEARCH & HISTORY ──────────────────────────────────────────────────────────
  {
    name: "search_history",
    description: "מחפש בכל ההיסטוריה — הודעות, משימות, זיכרון. 'מה ביקש אייל לפני חודש?', 'מתי דיברנו על המטבח?'",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        person: { type: "string", description: "לחיפוש לפי אדם ספציפי (שם או טלפון)" },
      },
      required: ["query"],
    },
  },
  {
    name: "add_task_with_priority",
    description: "מוסיף משימה עם ניתוח עדיפות חכם אוטומטי (בטיחות, רגולציה, דיירים, עלות).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        due_date: { type: "string" },
        notes: { type: "string" },
        assignee: { type: "string" },
        project: { type: "string" },
      },
      required: ["title"],
    },
  },
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
