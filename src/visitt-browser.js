/**
 * Visitt browser-based integration using Playwright.
 * Used when VISITT_EMAIL + VISITT_PASSWORD are set (no Partner API token needed).
 * Logs in to the Visitt web app, intercepts the internal auth token,
 * then uses it to call Visitt's internal API directly.
 */
import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const SESSION_FILE = path.resolve("data/visitt-session.json");
const TOKEN_FILE = path.resolve("data/visitt-token.json");
const VISITT_APP = "https://app.visitt.io";
const TOKEN_TTL = 55 * 60 * 1000; // 55 minutes

let _mem = null; // { token, apiBase, expiresAt }

// ─── Public readiness check ───────────────────────────────────────────────────
export function isBrowserVisittReady() {
  return !!(process.env.VISITT_EMAIL && process.env.VISITT_PASSWORD);
}

// ─── Token management ─────────────────────────────────────────────────────────
function loadCached() {
  if (_mem && Date.now() < _mem.expiresAt) return _mem;
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
      if (saved?.token && Date.now() < saved.expiresAt) {
        _mem = saved;
        return _mem;
      }
    }
  } catch {}
  return null;
}

function saveCache(token, apiBase) {
  const entry = { token, apiBase, expiresAt: Date.now() + TOKEN_TTL };
  _mem = entry;
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(entry));
  } catch {}
}

function clearCache() {
  _mem = null;
  try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); } catch {}
  try { if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE); } catch {}
}

// ─── Browser launcher ─────────────────────────────────────────────────────────
function launchChromium() {
  const executablePath = "/opt/pw-browsers/chromium";
  return chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
}

// ─── Login & token capture ────────────────────────────────────────────────────
async function captureToken() {
  const browser = await launchChromium();
  let capturedToken = null;
  let capturedApiBase = null;

  try {
    const storageState = fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined;
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    // Intercept all API requests to grab the auth header
    page.on("request", (req) => {
      const url = req.url();
      const auth = req.headers()["authorization"];
      if (
        auth && auth.length > 30 &&
        !url.includes("google") && !url.includes("facebook") &&
        (url.includes("visitt") || url.includes("/api/") || url.includes("/graphql"))
      ) {
        capturedToken = auth;
        const m = url.match(/^(https?:\/\/[^\/]+)/);
        if (m) capturedApiBase = m[1];
      }
    });

    await page.goto(VISITT_APP, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const url = page.url();
    const needsLogin = url.includes("login") || url.includes("auth") || url.includes("sign") || !capturedToken;
    if (needsLogin) {
      await doLogin(page);
    }

    // Navigate to work-orders to trigger API calls
    if (!capturedToken) {
      await page.goto(`${VISITT_APP}/work-orders`, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Try localStorage as fallback
    if (!capturedToken) {
      capturedToken = await page.evaluate(() => {
        const candidates = ["token", "authToken", "access_token", "jwt", "id_token", "accessToken"];
        for (const k of candidates) {
          const v = localStorage.getItem(k);
          if (v && v.length > 30) return v.startsWith("Bearer ") ? v : `Bearer ${v}`;
        }
        for (let i = 0; i < localStorage.length; i++) {
          const v = localStorage.getItem(localStorage.key(i));
          if (v?.startsWith("eyJ") && v.length > 100) return `Bearer ${v}`;
        }
        return null;
      });
    }

    await context.storageState({ path: SESSION_FILE }).catch(() => {});

    if (!capturedToken) throw new Error("לא נמצא טוקן. בדוק פרטי כניסה ל-Visitt.");
    saveCache(capturedToken, capturedApiBase ?? VISITT_APP);
    return { token: capturedToken, apiBase: capturedApiBase ?? VISITT_APP };
  } finally {
    await browser.close();
  }
}

async function doLogin(page) {
  const email = process.env.VISITT_EMAIL;
  const pw = process.env.VISITT_PASSWORD;
  if (!email || !pw) throw new Error("VISITT_EMAIL ו-VISITT_PASSWORD חסרים ב-.env");

  try {
    await page.fill(
      'input[type="email"], input[name="email"], input[placeholder*="mail" i], #email',
      email, { timeout: 8000 }
    );
    await page.fill(
      'input[type="password"], input[name="password"], #password, [placeholder*="password" i]',
      pw, { timeout: 8000 }
    );
    await page.click(
      'button[type="submit"], input[type="submit"], .login-btn, button:has-text("Login"), button:has-text("Sign in"), button:has-text("כניסה")',
      { timeout: 8000 }
    );
    await page.waitForNavigation({ timeout: 20_000, waitUntil: "networkidle" }).catch(() => {});
  } catch (err) {
    console.error("⚠️ Visitt login error:", err.message?.slice(0, 100));
    throw new Error("כניסה ל-Visitt נכשלה — בדוק VISITT_EMAIL ו-VISITT_PASSWORD");
  }
}

async function getToken() {
  const cached = loadCached();
  if (cached) return cached;
  return captureToken();
}

// ─── API caller ───────────────────────────────────────────────────────────────
async function callApi(endpoint, method = "GET", body = null) {
  const { token, apiBase } = await getToken();
  const { default: axios } = await import("axios");
  const url = endpoint.startsWith("http") ? endpoint : `${apiBase}${endpoint}`;
  try {
    const { data } = await axios({
      method,
      url,
      headers: { Authorization: token, "Content-Type": "application/json" },
      data: body ?? undefined,
      timeout: 15_000,
    });
    return data;
  } catch (err) {
    // Token may have expired — clear cache and retry once
    if (err.response?.status === 401) {
      clearCache();
      const fresh = await captureToken();
      const { data } = await axios({
        method, url,
        headers: { Authorization: fresh.token, "Content-Type": "application/json" },
        data: body ?? undefined,
        timeout: 15_000,
      });
      return data;
    }
    throw err;
  }
}

async function gql(query, variables = {}) {
  const { token, apiBase } = await getToken();
  const { default: axios } = await import("axios");

  // Try common GraphQL endpoints
  const endpoints = [
    `${apiBase}/graphql`,
    "https://api.visitt.io/graphql",
    "https://app.visitt.io/graphql",
    "https://partner-api.visitt.io/graphql",
  ];

  let lastErr;
  for (const url of endpoints) {
    try {
      const { data } = await axios.post(
        url,
        { query, variables },
        { headers: { Authorization: token, "Content-Type": "application/json" }, timeout: 15_000 }
      );
      if (data.errors?.length) throw new Error(data.errors[0].message);
      return data.data;
    } catch (err) {
      lastErr = err;
      if (err.response?.status === 404) continue;
      throw err;
    }
  }
  throw lastErr;
}

// ─── Scrape work orders (HTML fallback) ──────────────────────────────────────
export async function scrapeWorkOrders() {
  const browser = await launchChromium();
  try {
    const storageState = fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined;
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    const intercepted = [];
    page.on("response", async (resp) => {
      const url = resp.url();
      if (resp.status() === 200 && (url.includes("work") || url.includes("order") || url.includes("task"))) {
        try {
          const ct = resp.headers()["content-type"] ?? "";
          if (ct.includes("json")) {
            const json = await resp.json();
            const items =
              json.data?.workOrders ?? json.workOrders ?? json.items ?? json.results ?? json.data ?? [];
            if (Array.isArray(items) && items.length) intercepted.push(...items);
          }
        } catch {}
      }
    });

    await page.goto(`${VISITT_APP}/work-orders`, { waitUntil: "networkidle", timeout: 30_000 });

    // If redirected to login, do login
    if (page.url().includes("login") || page.url().includes("auth")) {
      await doLogin(page);
      await page.goto(`${VISITT_APP}/work-orders`, { waitUntil: "networkidle", timeout: 30_000 });
    }

    await context.storageState({ path: SESSION_FILE }).catch(() => {});
    return intercepted;
  } finally {
    await browser.close();
  }
}

// ─── Public data functions (mirror visitt.js API) ────────────────────────────
export async function getWorkOrdersBrowser({ status, limit = 50, priority } = {}) {
  try {
    const data = await gql(
      `query GetWorkOrders($status: String, $priority: String, $limit: Int) {
        workOrders(status: $status, priority: $priority, limit: $limit) {
          _id title description status priority
          category { name }
          assignedTo { name email }
          location dueDate createdAt updatedAt
        }
      }`,
      { status: status ?? null, priority: priority ?? null, limit }
    );
    return data.workOrders ?? [];
  } catch {
    // Fallback: scrape directly
    const items = await scrapeWorkOrders();
    return items.slice(0, limit);
  }
}

export async function getStatsBrowser() {
  const all = await getWorkOrdersBrowser({ limit: 200 });

  const byStatus = {};
  const byCategory = {};

  for (const wo of all) {
    const s = wo.status ?? "unknown";
    const c = wo.category?.name ?? wo.categoryName ?? "אחר";
    byStatus[s] = (byStatus[s] ?? 0) + 1;
    byCategory[c] = (byCategory[c] ?? 0) + 1;
  }

  const open = all.filter(w => !["completed", "closed", "cancelled"].includes((w.status ?? "").toLowerCase()));
  const overdue = open.filter(w => w.dueDate && new Date(w.dueDate) < new Date());
  const critical = all.filter(w => ["critical", "urgent"].includes((w.priority ?? "").toLowerCase()));

  return {
    total: all.length,
    open: open.length,
    overdue: overdue.length,
    critical: critical.length,
    byStatus, byCategory,
    recentOpen: open.slice(0, 10),
    overdueList: overdue.slice(0, 10),
    criticalList: critical.filter(w => !["completed", "closed"].includes((w.status ?? "").toLowerCase())).slice(0, 10),
  };
}

export async function createWorkOrderBrowser({ title, description, categoryId, location, priority, assigneeId, dueDate }) {
  return gql(
    `mutation CreateWorkOrder($input: WorkOrderInput!) {
      createWorkOrder(input: $input) { _id title status priority }
    }`,
    { input: { title, description: description ?? "", categoryId: categoryId ?? null, location: location ?? "", priority: priority ?? "normal", assigneeId: assigneeId ?? null, dueDate: dueDate ?? null } }
  ).then(d => d.createWorkOrder);
}

export async function updateWorkOrderBrowser(id, updates) {
  return gql(
    `mutation UpdateWorkOrders($ids: [ID!]!, $input: UpdateWorkOrderInput!) {
      updateWorkOrders(ids: $ids, input: $input) { _id title status updatedAt }
    }`,
    { ids: [id], input: updates }
  ).then(d => d.updateWorkOrders?.[0]);
}
