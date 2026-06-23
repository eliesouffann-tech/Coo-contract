import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, "nursing_home.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    onedrive_id TEXT UNIQUE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_type TEXT,
    category TEXT,
    subcategory TEXT,
    date_document TEXT,
    date_modified TEXT,
    content_summary TEXT,
    raw_content TEXT,
    is_image INTEGER DEFAULT 0,
    image_description TEXT,
    processed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS maintenance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER,
    call_number TEXT,
    date_opened TEXT,
    date_closed TEXT,
    department TEXT,
    location TEXT,
    description TEXT,
    worker TEXT,
    status TEXT,
    resolution_time_hours REAL,
    category TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id)
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER,
    project_name TEXT NOT NULL,
    status TEXT,
    start_date TEXT,
    end_date TEXT,
    planned_budget REAL,
    actual_cost REAL,
    description TEXT,
    department TEXT,
    contractor TEXT,
    before_image_ids TEXT DEFAULT '[]',
    after_image_ids TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id)
  );

  CREATE TABLE IF NOT EXISTS budget_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER,
    period TEXT,
    year INTEGER,
    quarter INTEGER,
    month INTEGER,
    category TEXT,
    subcategory TEXT,
    planned_amount REAL DEFAULT 0,
    actual_amount REAL DEFAULT 0,
    variance REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id)
  );

  CREATE TABLE IF NOT EXISTS safety_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER,
    date TEXT,
    type TEXT,
    description TEXT,
    severity TEXT,
    location TEXT,
    corrective_action TEXT,
    status TEXT,
    regulatory_body TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id)
  );

  CREATE TABLE IF NOT EXISTS report_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type TEXT,
    period TEXT,
    year INTEGER,
    generated_at TEXT DEFAULT (datetime('now')),
    file_path TEXT,
    pages INTEGER,
    status TEXT
  );

  CREATE TABLE IF NOT EXISTS scan_state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Documents ────────────────────────────────────────────────────────────────

export function upsertDocument(doc) {
  return db.prepare(`
    INSERT OR REPLACE INTO documents
      (onedrive_id, file_name, file_path, file_type, category, subcategory,
       date_document, date_modified, content_summary, raw_content,
       is_image, image_description, processed)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    doc.onedriveId, doc.fileName, doc.filePath, doc.fileType,
    doc.category ?? null, doc.subcategory ?? null,
    doc.dateDocument ?? null, doc.dateModified ?? null,
    doc.contentSummary ?? null, doc.rawContent ?? null,
    doc.isImage ? 1 : 0, doc.imageDescription ?? null,
    doc.processed ? 1 : 0,
  );
}

export function getDocumentByOnedriveId(id) {
  return db.prepare("SELECT * FROM documents WHERE onedrive_id = ?").get(id);
}

export function getUnprocessedDocuments() {
  return db.prepare("SELECT * FROM documents WHERE processed = 0 ORDER BY created_at ASC").all();
}

export function markDocumentProcessed(id, category, subcategory, summary) {
  db.prepare(`
    UPDATE documents SET processed=1, category=?, subcategory=?, content_summary=? WHERE id=?
  `).run(category, subcategory, summary, id);
}

export function getAllDocuments(year = null) {
  if (year) {
    return db.prepare("SELECT * FROM documents WHERE strftime('%Y', date_document) = ?").all(String(year));
  }
  return db.prepare("SELECT * FROM documents ORDER BY date_document DESC").all();
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

export function insertMaintenanceRecord(r) {
  return db.prepare(`
    INSERT INTO maintenance_records
      (document_id, call_number, date_opened, date_closed, department, location,
       description, worker, status, resolution_time_hours, category)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    r.documentId ?? null, r.callNumber ?? null, r.dateOpened ?? null,
    r.dateClosed ?? null, r.department ?? null, r.location ?? null,
    r.description ?? null, r.worker ?? null, r.status ?? "open",
    r.resolutionTimeHours ?? null, r.category ?? null,
  );
}

export function getMaintenanceStats(year, quarter = null) {
  const qMonths = { 1: ["01","02","03"], 2: ["04","05","06"], 3: ["07","08","09"], 4: ["10","11","12"] };
  let where = "WHERE strftime('%Y', date_opened) = ?";
  let params = [String(year)];
  if (quarter && qMonths[quarter]) {
    const ph = qMonths[quarter].map(() => "?").join(",");
    where += ` AND strftime('%m', date_opened) IN (${ph})`;
    params.push(...qMonths[quarter]);
  }
  return {
    total:         db.prepare(`SELECT COUNT(*) c FROM maintenance_records ${where}`).get(...params).c,
    open:          db.prepare(`SELECT COUNT(*) c FROM maintenance_records ${where} AND status='open'`).get(...params).c,
    closed:        db.prepare(`SELECT COUNT(*) c FROM maintenance_records ${where} AND status='closed'`).get(...params).c,
    avgHours:      db.prepare(`SELECT AVG(resolution_time_hours) v FROM maintenance_records ${where} AND status='closed'`).get(...params).v ?? 0,
    byDepartment:  db.prepare(`SELECT department, COUNT(*) c FROM maintenance_records ${where} GROUP BY department ORDER BY c DESC`).all(...params),
    byWorker:      db.prepare(`SELECT worker, COUNT(*) c FROM maintenance_records ${where} GROUP BY worker ORDER BY c DESC LIMIT 10`).all(...params),
    byCategory:    db.prepare(`SELECT category, COUNT(*) c FROM maintenance_records ${where} GROUP BY category ORDER BY c DESC`).all(...params),
    monthlyTrend:  db.prepare(`SELECT strftime('%m', date_opened) m, COUNT(*) c FROM maintenance_records ${where} GROUP BY m ORDER BY m`).all(...params),
  };
}

// ─── Projects ────────────────────────────────────────────────────────────────

export function upsertProject(p) {
  return db.prepare(`
    INSERT OR REPLACE INTO projects
      (document_id, project_name, status, start_date, end_date, planned_budget,
       actual_cost, description, department, contractor, before_image_ids, after_image_ids)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    p.documentId ?? null, p.projectName, p.status ?? "active",
    p.startDate ?? null, p.endDate ?? null,
    p.plannedBudget ?? null, p.actualCost ?? null,
    p.description ?? null, p.department ?? null, p.contractor ?? null,
    JSON.stringify(p.beforeImageIds ?? []), JSON.stringify(p.afterImageIds ?? []),
  );
}

export function getProjects(year = null) {
  if (year) {
    return db.prepare("SELECT * FROM projects WHERE strftime('%Y', start_date) = ? OR strftime('%Y', end_date) = ?").all(String(year), String(year));
  }
  return db.prepare("SELECT * FROM projects ORDER BY start_date DESC").all();
}

// ─── Budget ──────────────────────────────────────────────────────────────────

export function insertBudgetItem(b) {
  const variance = (b.plannedAmount ?? 0) - (b.actualAmount ?? 0);
  return db.prepare(`
    INSERT INTO budget_items
      (document_id, period, year, quarter, month, category, subcategory,
       planned_amount, actual_amount, variance, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    b.documentId ?? null, b.period ?? null, b.year ?? null, b.quarter ?? null,
    b.month ?? null, b.category ?? null, b.subcategory ?? null,
    b.plannedAmount ?? 0, b.actualAmount ?? 0, variance, b.notes ?? null,
  );
}

export function getBudgetSummary(year, quarter = null) {
  let where = "WHERE year = ?";
  let params = [year];
  if (quarter) { where += " AND quarter = ?"; params.push(quarter); }
  return {
    totalPlanned: db.prepare(`SELECT SUM(planned_amount) v FROM budget_items ${where}`).get(...params).v ?? 0,
    totalActual:  db.prepare(`SELECT SUM(actual_amount) v FROM budget_items ${where}`).get(...params).v ?? 0,
    byCategory:   db.prepare(`
      SELECT category,
             SUM(planned_amount) planned,
             SUM(actual_amount)  actual,
             SUM(variance)       variance
      FROM budget_items ${where}
      GROUP BY category
      ORDER BY ABS(variance) DESC
    `).all(...params),
  };
}

// ─── Safety ──────────────────────────────────────────────────────────────────

export function insertSafetyRecord(r) {
  return db.prepare(`
    INSERT INTO safety_records
      (document_id, date, type, description, severity, location,
       corrective_action, status, regulatory_body)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    r.documentId ?? null, r.date ?? null, r.type ?? null, r.description ?? null,
    r.severity ?? null, r.location ?? null, r.correctiveAction ?? null,
    r.status ?? null, r.regulatoryBody ?? null,
  );
}

export function getSafetyStats(year, quarter = null) {
  const qMonths = { 1: ["01","02","03"], 2: ["04","05","06"], 3: ["07","08","09"], 4: ["10","11","12"] };
  let where = "WHERE strftime('%Y', date) = ?";
  let params = [String(year)];
  if (quarter && qMonths[quarter]) {
    const ph = qMonths[quarter].map(() => "?").join(",");
    where += ` AND strftime('%m', date) IN (${ph})`;
    params.push(...qMonths[quarter]);
  }
  return {
    total:      db.prepare(`SELECT COUNT(*) c FROM safety_records ${where}`).get(...params).c,
    bySeverity: db.prepare(`SELECT severity, COUNT(*) c FROM safety_records ${where} GROUP BY severity`).all(...params),
    byType:     db.prepare(`SELECT type, COUNT(*) c FROM safety_records ${where} GROUP BY type`).all(...params),
    byStatus:   db.prepare(`SELECT status, COUNT(*) c FROM safety_records ${where} GROUP BY status`).all(...params),
    openItems:  db.prepare(`SELECT * FROM safety_records ${where} AND status != 'closed' ORDER BY severity DESC`).all(...params),
  };
}

// ─── Scan state ───────────────────────────────────────────────────────────────

export function getScanState(key) {
  const row = db.prepare("SELECT value FROM scan_state WHERE key = ?").get(key);
  return row?.value ?? null;
}

export function setScanState(key, value) {
  db.prepare(`
    INSERT OR REPLACE INTO scan_state (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
  `).run(key, value);
}

// ─── Report history ───────────────────────────────────────────────────────────

export function logReport(type, period, year, filePath, pages, status) {
  return db.prepare(`
    INSERT INTO report_history (report_type, period, year, file_path, pages, status)
    VALUES (?,?,?,?,?,?)
  `).run(type, period, year, filePath, pages, status);
}

export function getReportHistory(limit = 10) {
  return db.prepare("SELECT * FROM report_history ORDER BY generated_at DESC LIMIT ?").all(limit);
}

export { db };
