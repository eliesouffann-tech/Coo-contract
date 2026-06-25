import axios from "axios";

const GRAPHQL_URL = "https://partner-api.visitt.io/graphql";

function getToken() { return process.env.VISITT_API_TOKEN; }
export function isVisittReady() { return !!getToken(); }

async function gql(query, variables = {}) {
  const token = getToken();
  if (!token) throw new Error("VISITT_API_TOKEN לא מוגדר ב-.env");
  const { data } = await axios.post(
    GRAPHQL_URL,
    { query, variables },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
      },
      timeout: 15_000,
    }
  );
  if (data.errors?.length) throw new Error(data.errors[0].message);
  return data.data;
}

// ─── WORK ORDERS ─────────────────────────────────────────────────────────────
export async function getWorkOrders({ status, limit = 50, priority } = {}) {
  const data = await gql(
    `query GetWorkOrders($status: String, $priority: String, $limit: Int) {
      workOrders(status: $status, priority: $priority, limit: $limit) {
        _id title description status priority
        category { name }
        assignedTo { name email }
        location
        dueDate createdAt updatedAt
      }
    }`,
    { status, priority, limit }
  );
  return data.workOrders ?? [];
}

export async function createWorkOrder({ title, description, categoryId, location, priority, assigneeId, dueDate }) {
  const data = await gql(
    `mutation CreateWorkOrder($input: WorkOrderInput!) {
      createWorkOrder(input: $input) {
        _id title status priority
      }
    }`,
    {
      input: {
        title,
        description: description ?? "",
        categoryId: categoryId ?? null,
        location: location ?? "",
        priority: priority ?? "normal",
        assigneeId: assigneeId ?? null,
        dueDate: dueDate ?? null,
      },
    }
  );
  return data.createWorkOrder;
}

export async function updateWorkOrder(id, { status, priority, assigneeId, note }) {
  const data = await gql(
    `mutation UpdateWorkOrders($ids: [ID!]!, $input: UpdateWorkOrderInput!) {
      updateWorkOrders(ids: $ids, input: $input) {
        _id title status updatedAt
      }
    }`,
    {
      ids: [id],
      input: {
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(note ? { note } : {}),
      },
    }
  );
  return data.updateWorkOrders?.[0];
}

export async function getCategories() {
  const data = await gql(
    `query { categories { _id name subcategories { _id name } } }`
  );
  return data.categories ?? [];
}

// ─── STATISTICS (derived from work orders) ───────────────────────────────────
export async function getStats() {
  const all = await getWorkOrders({ limit: 200 });

  const byStatus = {};
  const byPriority = {};
  const byCategory = {};

  for (const wo of all) {
    const s = wo.status ?? "unknown";
    const p = wo.priority ?? "normal";
    const c = wo.category?.name ?? "אחר";
    byStatus[s] = (byStatus[s] ?? 0) + 1;
    byPriority[p] = (byPriority[p] ?? 0) + 1;
    byCategory[c] = (byCategory[c] ?? 0) + 1;
  }

  const open = all.filter(w => !["completed", "closed", "cancelled"].includes(w.status?.toLowerCase()));
  const overdue = open.filter(w => w.dueDate && new Date(w.dueDate) < new Date());
  const critical = all.filter(w => w.priority === "critical" || w.priority === "urgent");

  return {
    total: all.length,
    open: open.length,
    overdue: overdue.length,
    critical: critical.length,
    byStatus, byPriority, byCategory,
    recentOpen: open.slice(0, 10),
    overdueList: overdue.slice(0, 10),
    criticalList: critical.filter(w => !["completed", "closed"].includes(w.status?.toLowerCase())).slice(0, 10),
  };
}

// ─── WEBHOOK REGISTRATION ─────────────────────────────────────────────────────
export async function registerWebhook(url) {
  const data = await gql(
    `mutation RegisterWebhook($url: String!, $events: [String!]!) {
      registerWebhook(url: $url, events: $events) {
        _id url events active
      }
    }`,
    {
      url,
      events: [
        "workOrder.created",
        "workOrder.statusUpdated",
        "workOrder.assignedTo",
        "workOrder.commented",
      ],
    }
  );
  return data.registerWebhook;
}

export async function listWebhooks() {
  const data = await gql(`query { webhooks { _id url events active createdAt } }`);
  return data.webhooks ?? [];
}

// ─── Hebrew helpers ───────────────────────────────────────────────────────────
export function statusHe(status) {
  const map = {
    open: "פתוח", "in-progress": "בביצוע", inprogress: "בביצוע",
    completed: "הושלם", closed: "סגור", cancelled: "בוטל",
    pending: "ממתין", "on-hold": "מושהה",
  };
  return map[status?.toLowerCase()] ?? status ?? "—";
}

export function priorityHe(priority) {
  const map = { critical: "קריטי", urgent: "דחוף", high: "גבוה", normal: "רגיל", low: "נמוך" };
  return map[priority?.toLowerCase()] ?? priority ?? "—";
}

export function priorityEmoji(priority) {
  const map = { critical: "🔴", urgent: "🟠", high: "🟡", normal: "🟢", low: "⚪" };
  return map[priority?.toLowerCase()] ?? "⚪";
}
