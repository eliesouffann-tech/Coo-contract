import {
  isOneDriveReady,
  scanConfiguredFolders,
  getDelta,
  downloadFile,
} from "./onedrive.js";
import {
  upsertDocument,
  getDocumentByOnedriveId,
  getUnprocessedDocuments,
  markDocumentProcessed,
  insertMaintenanceRecord,
  upsertProject,
  insertBudgetItem,
  insertSafetyRecord,
  getScanState,
  setScanState,
} from "./database.js";
import { extractContent, detectDocumentDate, guessCategory } from "./documentProcessor.js";
import {
  categorizeDocument,
  extractMaintenanceRecords,
  extractBudgetData,
  extractProjectData,
  extractSafetyData,
  analyzeImage,
} from "./aiAnalyzer.js";

let scanInProgress = false;

const MIME_TYPES = {
  pdf:  "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  png:  "image/png",
  gif:  "image/gif",
  webp: "image/webp",
  bmp:  "image/bmp",
};

// ─── Full OneDrive scan ───────────────────────────────────────────────────────

export async function performFullScan() {
  if (!isOneDriveReady()) {
    throw new Error("OneDrive לא מחובר. הפעל: npm run setup-onedrive");
  }

  if (scanInProgress) {
    console.log("⏳ סריקה כבר מתבצעת...");
    return { skipped: true };
  }

  scanInProgress = true;
  console.log("\n🔍 מתחיל סריקת OneDrive...");

  try {
    const files = await scanConfiguredFolders();
    console.log(`📁 נמצאו ${files.length} קבצים`);

    let newCount = 0;
    let updatedCount = 0;

    for (const file of files) {
      const existing = getDocumentByOnedriveId(file.id);
      const modified = file.lastModifiedDateTime;

      if (existing && existing.date_modified === modified) continue;

      const result = upsertDocument({
        onedriveId:   file.id,
        fileName:     file.name,
        filePath:     file.filePath,
        fileType:     file.extension,
        dateModified: modified,
        processed:    false,
      });

      if (existing) updatedCount++;
      else newCount++;
    }

    console.log(`✅ סריקה הושלמה: ${newCount} חדשים, ${updatedCount} עודכנו`);
    return { total: files.length, new: newCount, updated: updatedCount };
  } finally {
    scanInProgress = false;
  }
}

// ─── Incremental delta scan ───────────────────────────────────────────────────

export async function performDeltaScan() {
  if (!isOneDriveReady()) return { skipped: true, reason: "OneDrive לא מחובר" };

  const deltaToken = getScanState("onedrive_delta_token");
  const { items, nextDeltaToken } = await getDelta(deltaToken);

  let newCount = 0;
  for (const item of items) {
    if (item.deleted || item.folder) continue;
    const ext = item.name?.split(".").pop()?.toLowerCase() ?? "";
    const supported = ["pdf","docx","doc","xlsx","xls","jpg","jpeg","png","gif","webp","bmp","txt","csv"];
    if (!supported.includes(ext)) continue;

    upsertDocument({
      onedriveId:   item.id,
      fileName:     item.name,
      filePath:     `${item.parentReference?.path ?? ""}/${item.name}`,
      fileType:     ext,
      dateModified: item.lastModifiedDateTime,
      processed:    false,
    });
    newCount++;
  }

  if (nextDeltaToken) setScanState("onedrive_delta_token", nextDeltaToken);

  console.log(`🔄 Delta sync: ${newCount} קבצים חדשים/עודכנו`);
  return { items: items.length, new: newCount };
}

// ─── Process unprocessed documents ───────────────────────────────────────────

export async function processUnprocessedDocuments(limit = 20) {
  const docs = getUnprocessedDocuments().slice(0, limit);
  if (docs.length === 0) {
    console.log("✅ כל המסמכים מעובדים");
    return { processed: 0 };
  }

  console.log(`\n📄 מעבד ${docs.length} מסמכים...`);
  let processedCount = 0;
  let errorCount = 0;

  for (const doc of docs) {
    try {
      console.log(`  📄 ${doc.file_name}`);

      // Download from OneDrive
      const buffer = await downloadFile(doc.onedrive_id);
      const mimeType = MIME_TYPES[doc.file_type] ?? "application/octet-stream";

      // Extract content
      const { type, content, buffer: imgBuffer } = await extractContent(buffer, doc.file_type);

      let category, subcategory, summary, imageDescription;

      if (type === "image") {
        // Image analysis
        imageDescription = await analyzeImage(buffer, mimeType, doc.file_name);
        category = guessCategory(doc.file_name, imageDescription);
        subcategory = "תמונה";
        summary = imageDescription?.slice(0, 300) ?? `תמונה: ${doc.file_name}`;

        markDocumentProcessed(doc.id, category, subcategory, summary);

        // Update with image info
        upsertDocument({
          ...doc,
          onedriveId:       doc.onedrive_id,
          fileName:         doc.file_name,
          filePath:         doc.file_path,
          fileType:         doc.file_type,
          dateModified:     doc.date_modified,
          isImage:          true,
          imageDescription,
          category,
          subcategory,
          contentSummary:   summary,
          processed:        true,
        });
      } else if (content) {
        // Text/Excel document analysis
        const aiResult = await categorizeDocument(content, doc.file_name);
        category    = aiResult.category ?? guessCategory(doc.file_name, content);
        subcategory = aiResult.subcategory;
        summary     = aiResult.summary;

        const docDate = aiResult.documentDate ?? detectDocumentDate(content, doc.file_name);

        // Update with extracted info
        upsertDocument({
          ...doc,
          onedriveId:     doc.onedrive_id,
          fileName:       doc.file_name,
          filePath:       doc.file_path,
          fileType:       doc.file_type,
          dateModified:   doc.date_modified,
          dateDocument:   docDate,
          category,
          subcategory,
          contentSummary: summary,
          rawContent:     content?.slice(0, 5000) ?? null,
          processed:      true,
        });

        markDocumentProcessed(doc.id, category, subcategory, summary);

        // Extract structured data based on category
        await extractAndStoreData(content, doc.id, category);
      } else {
        markDocumentProcessed(doc.id, "general", null, "לא ניתן לחלץ תוכן");
      }

      processedCount++;
      console.log(`  ✅ ${doc.file_name} → ${category}`);

      // Brief pause to avoid AI rate limits
      await new Promise((r) => setTimeout(r, 500));

    } catch (err) {
      errorCount++;
      console.error(`  ❌ ${doc.file_name}: ${err.message?.slice(0, 100)}`);
      // Mark as processed anyway to avoid infinite retry
      markDocumentProcessed(doc.id, "error", null, err.message?.slice(0, 200));
    }
  }

  console.log(`\n📊 עיבוד הסתיים: ${processedCount} הצליחו, ${errorCount} נכשלו`);
  return { processed: processedCount, errors: errorCount };
}

async function extractAndStoreData(content, documentId, category) {
  const categoryExtractors = {
    maintenance: async () => {
      const records = await extractMaintenanceRecords(content, documentId);
      for (const r of records) insertMaintenanceRecord(r);
      if (records.length) console.log(`     🔧 חולצו ${records.length} קריאות אחזקה`);
    },
    budget: async () => {
      const items = await extractBudgetData(content, documentId);
      for (const item of items) insertBudgetItem(item);
      if (items.length) console.log(`     💰 חולצו ${items.length} פריטי תקציב`);
    },
    projects: async () => {
      const projects = await extractProjectData(content, documentId);
      for (const p of projects) upsertProject(p);
      if (projects.length) console.log(`     🏗️ חולצו ${projects.length} פרויקטים`);
    },
    safety: async () => {
      const records = await extractSafetyData(content, documentId);
      for (const r of records) insertSafetyRecord(r);
      if (records.length) console.log(`     🛡️ חולצו ${records.length} אירועי בטיחות`);
    },
    regulatory: async () => {
      const records = await extractSafetyData(content, documentId);
      for (const r of records) insertSafetyRecord(r);
    },
  };

  const extractor = categoryExtractors[category];
  if (extractor) await extractor();

  // Always try to extract maintenance from maintenance-adjacent docs
  if (["water", "electricity", "garden"].includes(category)) {
    const records = await extractMaintenanceRecords(content, documentId);
    for (const r of records) insertMaintenanceRecord({ ...r, category: category });
  }
}

// ─── Status report ────────────────────────────────────────────────────────────

export function getScanStatus() {
  const total     = getUnprocessedDocuments().length;
  const lastScan  = getScanState("last_full_scan");
  const deltaToken = getScanState("onedrive_delta_token");
  return {
    unprocessed: total,
    lastFullScan: lastScan,
    hasDeltaToken: !!deltaToken,
    oneDriveReady: isOneDriveReady(),
    scanInProgress,
  };
}
