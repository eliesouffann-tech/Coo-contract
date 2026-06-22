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
| `/reset` | נקה היסטוריית שיחה |
| `/help` | עזרה |

---

## מבנה הקוד

```
src/
├── index.js       # שרת + ngrok + הודעות לבעלים
├── claude.js      # Claude Opus 4.8 + tool use + קונטקסט עשיר
├── tools.js       # כל הכלים: זיכרון/תזכורות/משימות/קלנדר/אנשי קשר
├── memory.js      # אחסון מתמיד: הערות/משימות/אנשי קשר/שיחות
├── scheduler.js   # מנוע תזכורות (node-cron)
├── calendar.js    # Google Calendar API
├── whatsapp.js    # WhatsApp Cloud API
└── media.js       # קריאת PDF/תמונות
scripts/
├── setup.js       # אשף הגדרה ראשונית
└── auth-google.js # חיבור חד-פעמי ל-Google Calendar
data/              # נוצר אוטומטית
├── profile.json
├── notes.json
├── contacts.json
├── tasks.json
├── reminders.json
├── conversations.json
└── google-token.json
```
