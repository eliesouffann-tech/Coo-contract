#!/usr/bin/env node
/**
 * Manual report generation script.
 * Usage: npm run generate-report -- Q1 2025
 *        npm run generate-report -- annual 2024
 */

import "dotenv/config";
import { createReport, REPORT_TYPES } from "../src/nursingHomeReporter.js";

const [type, yearArg] = process.argv.slice(2);
const year = yearArg ? parseInt(yearArg) : new Date().getFullYear();

if (!type || !REPORT_TYPES.includes(type.toUpperCase())) {
  console.log(`
שימוש: npm run generate-report -- <סוג> [שנה]

סוגים: ${REPORT_TYPES.join(", ")}

דוגמאות:
  npm run generate-report -- Q1 2025
  npm run generate-report -- H1 2025
  npm run generate-report -- ANNUAL 2024
`);
  process.exit(1);
}

console.log(`\n📊 מייצר דוח ${type.toUpperCase()} ${year}...`);

createReport(type.toUpperCase(), year)
  .then((result) => {
    console.log(`\n✅ הדוח נוצר בהצלחה!`);
    console.log(`📁 נשמר ב: ${result.filePath}`);
    console.log(`📄 שקופיות: ${result.slideCount}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\n❌ שגיאה: ${err.message}`);
    process.exit(1);
  });
