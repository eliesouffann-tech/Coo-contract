import { randomUUID } from "crypto";
import { addReminder, removeReminder, getUpcoming } from "./scheduler.js";
import { saveNote, deleteNote, getAllNotesText, getProfile, saveProfile } from "./memory.js";

export const TOOLS = [
  {
    name: "set_reminder",
    description: "קובע תזכורת שתישלח בזמן מסוים. השתמש בכלי זה כאשר המשתמש מבקש להיזכר על משהו.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "תוכן התזכורת" },
        datetime: {
          type: "string",
          description: "מתי לשלוח, בפורמט ISO 8601. לדוגמה: 2024-12-25T09:00:00",
        },
        phone: { type: "string", description: "מספר הטלפון לשלוח אליו" },
      },
      required: ["message", "datetime", "phone"],
    },
  },
  {
    name: "cancel_reminder",
    description: "מבטל תזכורת לפי המזהה שלה",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "מזהה התזכורת" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_reminders",
    description: "מציג את כל התזכורות הפעילות של מספר טלפון",
    input_schema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "מספר הטלפון" },
      },
      required: ["phone"],
    },
  },
  {
    name: "save_to_memory",
    description: "שומר מידע חשוב לזיכרון ארוך-טווח: פרטי אנשי קשר, תאריכים, משימות, העדפות וכל דבר שצריך לזכור.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "שם/נושא של המידע (קצר, כמו 'יום הולדת דוד' או 'עורך דין')" },
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
      properties: {
        key: { type: "string", description: "שם המידע למחיקה" },
      },
      required: ["key"],
    },
  },
  {
    name: "get_memory",
    description: "מביא את כל המידע השמור בזיכרון",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "update_profile",
    description: "מעדכן את הפרופיל של הבעלים — שם, תפקיד, וסגנון כתיבה",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "שם מלא" },
        role: { type: "string", description: "תפקיד / מקצוע" },
        style: {
          type: "string",
          description: "תיאור סגנון הכתיבה. לדוגמה: 'כותב קצר ולעניין, משתמש בהרבה אמוג'י, פחות פורמלי'",
        },
        ownerPhone: { type: "string", description: "מספר הטלפון של הבעלים" },
      },
    },
  },
];

export async function executeTool(name, input) {
  switch (name) {
    case "set_reminder": {
      const id = randomUUID();
      addReminder({ id, phone: input.phone, message: input.message, datetime: input.datetime });
      return {
        success: true,
        id,
        scheduledFor: new Date(input.datetime).toLocaleString("he-IL", {
          timeZone: "Asia/Jerusalem",
        }),
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
          scheduledFor: new Date(r.datetime).toLocaleString("he-IL", {
            timeZone: "Asia/Jerusalem",
          }),
        })),
      };
    }

    case "save_to_memory":
      saveNote(input.key, input.value);
      return { success: true };

    case "delete_from_memory":
      deleteNote(input.key);
      return { success: true };

    case "get_memory":
      return { notes: getAllNotesText() };

    case "update_profile": {
      const current = getProfile();
      const updated = { ...current, ...input };
      saveProfile(updated);
      return { success: true, profile: updated };
    }

    default:
      return { error: `כלי לא מוכר: ${name}` };
  }
}
