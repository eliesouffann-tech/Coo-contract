# WhatsApp AI Agent

סוכן AI אישי ל-WhatsApp מבוסס Claude Opus 4.8. עונה על כל שאלה, עוזר בכל משימה — ישירות מ-WhatsApp.

## מה הוא עושה?

- מקבל הודעות WhatsApp ועונה עם Claude AI
- שומר היסטוריית שיחה לכל משתמש (זיכרון לאורך השיחה)
- עונה בשפה שבה המשתמש כותב (עברית, אנגלית וכו')
- פקודה `/reset` לאיפוס השיחה

---

## דרישות

- **Node.js 18+**
- **חשבון Anthropic** — [console.anthropic.com](https://console.anthropic.com/)
- **חשבון Meta for Developers** עם אפליקציית WhatsApp Business

---

## הגדרה

### 1. התקן תלויות

```bash
npm install
```

### 2. הגדר משתני סביבה

```bash
cp .env.example .env
```

ערוך את `.env` עם הערכים שלך:

| משתנה | מה זה |
|---|---|
| `ANTHROPIC_API_KEY` | מפתח API מ-[console.anthropic.com](https://console.anthropic.com/) |
| `WHATSAPP_TOKEN` | Access Token מ-Meta for Developers |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone Number ID מ-Meta for Developers |
| `VERIFY_TOKEN` | מחרוזת סודית שאתה בוחר (משמשת לאימות ה-webhook) |

### 3. הפעל את השרת

```bash
npm start
# או בסביבת פיתוח עם hot-reload:
npm run dev
```

### 4. חשוף את השרת לאינטרנט

השרת חייב להיות נגיש מ-Meta. לפיתוח מקומי השתמש ב-[ngrok](https://ngrok.com/):

```bash
ngrok http 3000
```

קבל URL כמו: `https://abc123.ngrok.io`

### 5. הגדר Webhook ב-Meta for Developers

1. כנס ל-[developers.facebook.com](https://developers.facebook.com/) → האפליקציה שלך → **WhatsApp → Configuration**
2. הגדר **Callback URL**: `https://your-ngrok-url.ngrok.io/webhook`
3. הגדר **Verify Token**: הערך שהגדרת ב-`VERIFY_TOKEN`
4. לחץ **Verify and Save**
5. מתחת ל-**Webhook fields**, הפעל **messages**

---

## מבנה הקוד

```
src/
├── index.js          # שרת Express + endpoints לוובהוק
├── whatsapp.js       # שליחה וקריאה של הודעות WhatsApp
├── claude.js         # אינטגרציה עם Claude AI
└── conversations.js  # ניהול היסטוריית שיחה בזיכרון
```

---

## פריסה לפרודקשן

ניתן לפרוס על כל שרת עם Node.js — למשל:

- **Railway** / **Render** / **Fly.io** — פריסה פשוטה מ-GitHub
- **AWS EC2** / **DigitalOcean Droplet** — שרת VPS
- **Google Cloud Run** / **AWS Lambda** — serverless (דורש התאמות)

ודא שמשתני הסביבה מוגדרים בסביבת הפריסה ושה-URL הוא `https://`.

---

## פקודות

| פקודה | פעולה |
|---|---|
| `/reset` | מנקה את היסטוריית השיחה ומתחיל מחדש |
