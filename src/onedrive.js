import axios from "axios";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

const TOKEN_FILE = join(DATA_DIR, "onedrive_tokens.json");
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const CLIENT_ID    = process.env.MICROSOFT_CLIENT_ID;
const TENANT_ID    = process.env.MICROSOFT_TENANT_ID ?? "common";
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";  // device code flow

// ─── Token storage ────────────────────────────────────────────────────────────

function loadTokens() {
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  } catch { return null; }
}

function saveTokens(tokens) {
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

// ─── OAuth2 Device Code Flow ──────────────────────────────────────────────────

export async function startDeviceCodeFlow() {
  if (!CLIENT_ID) throw new Error("MICROSOFT_CLIENT_ID חסר ב-.env");
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/devicecode`;
  const { data } = await axios.post(url,
    new URLSearchParams({
      client_id: CLIENT_ID,
      scope: "offline_access Files.Read.All Files.ReadWrite.All User.Read",
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return data; // contains device_code, user_code, verification_uri, expires_in, interval
}

export async function pollDeviceCodeToken(deviceCode, interval = 5) {
  if (!CLIENT_ID) throw new Error("MICROSOFT_CLIENT_ID חסר ב-.env");
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  while (true) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    try {
      const { data } = await axios.post(url,
        new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: CLIENT_ID,
          device_code: deviceCode,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      data.expires_at = Date.now() + data.expires_in * 1000;
      saveTokens(data);
      console.log("✅ OneDrive מחובר!");
      return data;
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === "authorization_pending") continue;
      if (code === "slow_down") { interval += 5; continue; }
      throw err;
    }
  }
}

async function refreshAccessToken(tokens) {
  if (!CLIENT_ID) throw new Error("MICROSOFT_CLIENT_ID חסר ב-.env");
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const { data } = await axios.post(url,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: tokens.refresh_token,
      scope: "offline_access Files.Read.All Files.ReadWrite.All User.Read",
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  data.expires_at = Date.now() + data.expires_in * 1000;
  saveTokens(data);
  return data;
}

async function getAccessToken() {
  let tokens = loadTokens();
  if (!tokens) throw new Error("OneDrive לא מחובר. הפעל: npm run setup-onedrive");
  if (Date.now() >= (tokens.expires_at ?? 0) - 60000) {
    tokens = await refreshAccessToken(tokens);
  }
  return tokens.access_token;
}

export function isOneDriveReady() {
  return existsSync(TOKEN_FILE) && !!CLIENT_ID;
}

// ─── Graph API helpers ────────────────────────────────────────────────────────

async function graph(method, path, data = null, responseType = "json") {
  const token = await getAccessToken();
  const resp = await axios({
    method,
    url: `${GRAPH_BASE}${path}`,
    data,
    responseType,
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.data;
}

// ─── Drive operations ─────────────────────────────────────────────────────────

export async function getDriveRoot() {
  return graph("GET", "/me/drive/root");
}

export async function listFolder(itemIdOrPath = "root", skipHidden = true) {
  const path = itemIdOrPath === "root"
    ? "/me/drive/root/children"
    : `/me/drive/items/${itemIdOrPath}/children`;

  const items = [];
  let url = `${GRAPH_BASE}${path}?$top=200&$select=id,name,file,folder,size,createdDateTime,lastModifiedDateTime,parentReference`;

  while (url) {
    const token = await getAccessToken();
    const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    for (const item of data.value ?? []) {
      if (skipHidden && item.name.startsWith(".")) continue;
      items.push(item);
    }
    url = data["@odata.nextLink"] ?? null;
  }
  return items;
}

export async function downloadFile(itemId) {
  const token = await getAccessToken();
  const { data } = await axios.get(
    `${GRAPH_BASE}/me/drive/items/${itemId}/content`,
    { headers: { Authorization: `Bearer ${token}` }, responseType: "arraybuffer" }
  );
  return Buffer.from(data);
}

export async function uploadFile(parentId, fileName, buffer) {
  const token = await getAccessToken();
  const url = `${GRAPH_BASE}/me/drive/items/${parentId}:/${encodeURIComponent(fileName)}:/content`;
  const { data } = await axios.put(url, buffer, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
  });
  return data;
}

export async function createFolder(parentId, folderName) {
  return graph("POST", `/me/drive/items/${parentId}/children`, {
    name: folderName,
    folder: {},
    "@microsoft.graph.conflictBehavior": "rename",
  });
}

// ─── Incremental delta sync ───────────────────────────────────────────────────

export async function getDelta(deltaToken = null) {
  let url = deltaToken
    ? `https://graph.microsoft.com/v1.0/me/drive/root/delta?$deltatoken=${deltaToken}`
    : `${GRAPH_BASE}/me/drive/root/delta?$select=id,name,file,folder,deleted,createdDateTime,lastModifiedDateTime,parentReference`;

  const items = [];
  let nextDeltaToken = null;

  while (url) {
    const token = await getAccessToken();
    const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    items.push(...(data.value ?? []));
    url = data["@odata.nextLink"] ?? null;
    if (data["@odata.deltaLink"]) {
      const urlObj = new URL(data["@odata.deltaLink"]);
      nextDeltaToken = urlObj.searchParams.get("$deltatoken");
    }
  }
  return { items, nextDeltaToken };
}

// ─── Recursive folder scan ────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set([
  "pdf","docx","doc","xlsx","xls","csv",
  "jpg","jpeg","png","gif","bmp","webp",
  "pptx","ppt","txt",
]);

export async function scanAllFolders(rootId = "root", basePath = "") {
  const allFiles = [];
  const items = await listFolder(rootId);

  for (const item of items) {
    const itemPath = basePath ? `${basePath}/${item.name}` : item.name;
    if (item.folder) {
      const subFiles = await scanAllFolders(item.id, itemPath);
      allFiles.push(...subFiles);
    } else if (item.file) {
      const ext = item.name.split(".").pop()?.toLowerCase() ?? "";
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        allFiles.push({ ...item, filePath: itemPath, extension: ext });
      }
    }
  }
  return allFiles;
}

// ─── Targeted folder scan (by configured folders) ─────────────────────────────

export async function scanConfiguredFolders() {
  const foldersJson = process.env.ONEDRIVE_SCAN_FOLDERS;
  if (!foldersJson) {
    console.log("⚠️ ONEDRIVE_SCAN_FOLDERS לא מוגדר — סורק את כל ה-Drive");
    return scanAllFolders();
  }

  let folders;
  try { folders = JSON.parse(foldersJson); }
  catch { folders = foldersJson.split(",").map((f) => f.trim()); }

  const allFiles = [];
  for (const folderPath of folders) {
    try {
      const { data } = await axios.get(
        `${GRAPH_BASE}/me/drive/root:/${encodeURIComponent(folderPath)}`,
        { headers: { Authorization: `Bearer ${await getAccessToken()}` } }
      );
      console.log(`📂 סורק: ${folderPath}`);
      const files = await scanAllFolders(data.id, folderPath);
      allFiles.push(...files);
    } catch (err) {
      console.warn(`⚠️ תיקייה לא נמצאה: ${folderPath} — ${err.message}`);
    }
  }
  return allFiles;
}
