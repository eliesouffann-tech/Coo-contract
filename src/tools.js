import { randomUUID } from "crypto";
import { addReminder, removeReminder, getUpcoming } from "./scheduler.js";
import {
  saveNote, deleteNote, getAllNotesText,
  getProfile, saveProfile,
  saveContact, getContactName, getAllContactsText,
  addTask, completeTask, deleteTask, getTasksText,
} from "./memory.js";
import { createEvent, listEvents, deleteEvent, isCalendarReady } from "./calendar.js";
import { sendEmail, isEmailReady } from "./email.js";

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

    default:
      return { error: `כלי לא מוכר: ${name}` };
  }
}
