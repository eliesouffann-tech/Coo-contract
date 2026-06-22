# WhatsApp AI Agent

סוכן AI אישי ל-WhatsApp — עונה על הכל, זוכר את השיחה, עובד 24/7.

---

## איך מתחילים — 2 פקודות בלבד

### פקודה 1: הגדרה (פעם אחת בלבד)

```bash
npm run setup
```

הסקריפט ישאל אותך 4 שאלות ויסביר לך היכן למצוא כל דבר:
- מפתח Anthropic (Claude AI)
- WhatsApp Access Token
- Phone Number ID
- ngrok Authtoken (בחינם)

### פקודה 2: הפעלה

```bash
npm start
```

השרת עולה, מפעיל ngrok אוטומטית, ומדפיס לך הוראות מדויקות
לחיבור אחד-פעמי ב-Meta Developers Console.

---

## פקודות בתוך WhatsApp

| פקודה | פעולה |
|---|---|
| `/reset` | מאפס את היסטוריית השיחה |

---

## מבנה הקוד

```
src/
├── index.js          # שרת + ngrok + הדרכה אוטומטית
├── whatsapp.js       # שליחה/קבלה של הודעות
├── claude.js         # Claude Opus 4.8 עם זיכרון
└── conversations.js  # היסטוריית שיחה לכל משתמש
scripts/
└── setup.js          # אשף הגדרה אינטראקטיבי
```
