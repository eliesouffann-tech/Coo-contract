# WhatsApp AI Agent

סוכן AI אישי מלא ל-WhatsApp — עונה בשמך, קורא מסמכים, מקבע פגישות, מזכיר, זוכר הכל.

---

## יכולות

| יכולת | דוגמה |
|---|---|
| 🤖 עונה בשמך | כשמישהו כותב לך, הסוכן עונה בסגנון שלך |
| 📄 קורא מסמכים | שלח PDF/תמונה → ניתוח מידי |
| 🔔 תזכורות | "תזכיר לי מחר ב-9 לצלצל לדוד" |
| ✅ משימות | "תוסיף משימה: לשלוח הצעת מחיר" |
| 📅 Google Calendar | "תקבע פגישה עם רון ביום שלישי ב-14:00" |
| 🧠 זיכרון ארוך | "תזכור שהסיסמה של הנהלת חשבונות..." |
| 👥 אנשי קשר | זוכר שמות למספרי טלפון |
| 👁 התראות | כשעונה לאחרים — שולח לך עדכון |
| 🔀 n8n אוטומציות | "הפעל workflow ב-n8n" — מחבר לכל אפליקציה |

---

## הפעלה

```bash
# פעם אחת — הגדרה
npm run setup

# חיבור Google Calendar (אופציונלי)
npm run auth-google

# הפעלה
npm start
```

---

## פקודות WhatsApp

| פקודה | פעולה |
|---|---|
| `/profile` | הגדר שם, תפקיד, סגנון כתיבה |
| `/notes` | הצג זיכרון שמור |
| `/tasks` | הצג משימות |
| `/reminders` | הצג תזכורות |
| `/calendar` | סטטוס Google Calendar |
| `/email` | סטטוס שליחת מייל |
| `/n8n` | סטטוס אינטגרציית n8n |
| `/reset` | נקה היסטוריית שיחה |
| `/help` | עזרה |

---

## אינטגרציית n8n

חבר את הסוכן ל-n8n לאוטומציות ללא קוד.

### הגדרה מהירה

הוסף ל-`.env`:
```env
N8N_WEBHOOK_URL=https://your-n8n.instance/webhook
N8N_API_KEY=my-secret-key
```

### REST API

הסוכן חושף API מלא ב-`/api` שn8n יכול לקרוא:

| Endpoint | פעולה |
|---|---|
| `POST /api/send` | שלח הודעת WhatsApp |
| `POST /api/broadcast` | שלח לרשימת טלפונים |
| `GET/POST /api/tasks` | ניהול משימות |
| `GET/POST /api/memory` | ניהול זיכרון |
| `GET/POST /api/contacts` | ניהול אנשי קשר |
| `GET/POST /api/reminders` | ניהול תזכורות |

### Workflows מוכנים לייבוא

```
n8n/workflows/
├── 01-morning-briefing.json      # בריפינג יומי ב-8:00 בוקר
├── 02-whatsapp-broadcast.json    # שידור להמוני
├── 03-new-lead-to-whatsapp.json  # התראת ליד חדש
└── 04-task-sync-notion.json      # סנכרון משימות חיצוניות
```

ייבוא ב-n8n: **Settings → Import → Upload File**

פרטים נוספים: [`n8n/README.md`](n8n/README.md)

---

## מבנה הקוד

```
src/
├── index.js       # שרת + ngrok + הודעות לבעלים
├── claude.js      # Groq/Llama + tool use + קונטקסט עשיר
├── tools.js       # כל הכלים: זיכרון/תזכורות/משימות/קלנדר/אנשי קשר/n8n
├── memory.js      # אחסון מתמיד: הערות/משימות/אנשי קשר/שיחות
├── scheduler.js   # מנוע תזכורות (node-cron)
├── calendar.js    # Google Calendar API
├── whatsapp.js    # WhatsApp Cloud API
├── media.js       # קריאת PDF/תמונות
├── api.js         # REST API לשימוש n8n
├── n8n.js         # קריאה ל-n8n webhooks מהסוכן
└── email.js       # שליחת מיילים (Gmail)
scripts/
├── setup.js       # אשף הגדרה ראשונית
└── auth-google.js # חיבור חד-פעמי ל-Google Calendar
n8n/
├── README.md      # מדריך אינטגרציית n8n
└── workflows/     # Workflow JSON מוכנים לייבוא
data/              # נוצר אוטומטית
├── profile.json
├── notes.json
├── contacts.json
├── tasks.json
├── reminders.json
├── conversations.json
└── google-token.json
```
