# n8n Integration

Connect your WhatsApp AI Agent with n8n to build powerful automations without code.

---

## Architecture

```
n8n Workflows  ←──→  Agent REST API (/api/*)  ←──→  WhatsApp Cloud API
                              ↓
                      AI (Groq/Llama) + Memory + Tools
```

The agent exposes a REST API at `/api` that n8n can call. The AI can also trigger n8n webhooks directly when asked via WhatsApp.

---

## Setup

### 1. Configure the Agent

Add to `.env`:
```env
N8N_WEBHOOK_URL=https://your-n8n.instance/webhook   # n8n base URL
N8N_API_KEY=change-me-to-a-random-secret            # protects /api endpoints
```

### 2. Configure n8n

In n8n, create an **HTTP Header Auth** credential:
- **Name**: `Agent API Key`
- **Header name**: `x-api-key`
- **Header value**: same as `N8N_API_KEY`

Set environment variables in n8n:
| Variable | Value |
|---|---|
| `AGENT_URL` | Your agent URL (e.g. `https://your-agent.railway.app`) |
| `OWNER_PHONE` | Owner phone with country code, no `+` (e.g. `972501234567`) |

### 3. Import Workflows

In n8n: **Settings → Import → Upload File** → select any JSON from `n8n/workflows/`.

---

## REST API Reference

Base URL: `https://your-agent.com/api`  
Auth header: `x-api-key: YOUR_N8N_API_KEY`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/profile` | Get owner profile |
| PUT | `/api/profile` | Update profile |
| POST | `/api/send` | Send WhatsApp message |
| POST | `/api/broadcast` | Send to multiple phones |
| GET | `/api/memory` | Get all saved notes |
| POST | `/api/memory` | Save a note |
| DELETE | `/api/memory/:key` | Delete a note |
| GET | `/api/tasks` | List tasks (`?filter=pending`) |
| POST | `/api/tasks` | Create task |
| PATCH | `/api/tasks/:id/complete` | Mark task complete |
| DELETE | `/api/tasks/:id` | Delete task |
| GET | `/api/contacts` | List contacts |
| POST | `/api/contacts` | Save contact |
| GET | `/api/reminders` | List reminders (`?phone=972...`) |
| POST | `/api/reminders` | Create reminder |
| DELETE | `/api/reminders/:id` | Cancel reminder |

### Examples

**Send a WhatsApp message:**
```json
POST /api/send
{ "phone": "972501234567", "message": "Hello from n8n! 👋" }
```

**Broadcast to multiple:**
```json
POST /api/broadcast
{ "phones": ["972501234567", "972509876543"], "message": "Team update 📢" }
```

**Save a note:**
```json
POST /api/memory
{ "key": "client_x", "value": "Call them every Monday at 10:00" }
```

**Add a task:**
```json
POST /api/tasks
{ "title": "Send invoice to client", "due_date": "2024-12-31", "notes": "Amount: $5000" }
```

---

## Included Workflows

| File | Trigger | What It Does |
|---|---|---|
| `01-morning-briefing.json` | Daily at 8:00 AM | Sends tasks + reminders summary via WhatsApp |
| `02-whatsapp-broadcast.json` | Webhook POST | Broadcasts a message to a list of phones |
| `03-new-lead-to-whatsapp.json` | Webhook POST | Saves lead as contact + task + notifies owner |
| `04-task-sync-notion.json` | Schedule + Webhook | Task summary every 6h, or receive tasks from external tools |

---

## Trigger n8n from WhatsApp

Once `N8N_WEBHOOK_URL` is set, you can ask the AI:

> "הפעל workflow ב-n8n עם הנתיב crm-update ושלח שם את הנתונים של לקוח X"

The AI will call the `trigger_n8n_workflow` tool and POST to your n8n webhook.

Check status via WhatsApp: `/n8n`
