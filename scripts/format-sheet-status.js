/**
 * format-sheet-status.js
 *
 * Applies formatting to the job tracker sheet:
 * - Conditional background colours per Status (whole row)
 * - Color scale on Rating column
 * - Strikethrough + pale font for Rejected/Withdrawn
 * - Paler font for Saved
 * - Dropdown validation on Status column
 * - Custom sort by Status priority order
 *
 * Usage (run from inside the job-hunter repo):
 *   node scripts/format-sheet-status.js
 */

import { google } from "googleapis";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, "../config.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID";
const SHEET_ID = 0;

const auth = new google.auth.GoogleAuth({
  keyFile: config.google_sheets.service_account_key_file,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const STATUS_COL_INDEX = 8;  // Column I (0-based)
const RATING_COL_INDEX = 7;  // Column H (0-based)
const TOTAL_COLS = 20;

// Custom sort order
const STATUS_ORDER = ["Offer", "Interview", "Applied", "Phone Screen", "Saved", "Rejected", "Withdrawn"];

const VALID_STATUSES = ["Saved", "Applied", "Phone Screen", "Interview", "Offer", "Rejected", "Withdrawn"];

const STATUS_COLOURS = {
  Interview: { red: 0.85, green: 0.94, blue: 0.85 },
  Applied:   { red: 0.85, green: 0.90, blue: 0.98 },
  // Saved handled separately (background + pale font combined)
  Rejected:  { red: 0.98, green: 0.87, blue: 0.87 },
  Withdrawn: { red: 0.92, green: 0.92, blue: 0.92 },
  Offer:     { red: 0.83, green: 0.97, blue: 0.90 },
  "Phone Screen": { red: 0.91, green: 0.88, blue: 0.98 },
};

function fullRowRange() {
  return {
    sheetId: SHEET_ID,
    startRowIndex: 1,
    startColumnIndex: 0,
    endColumnIndex: TOTAL_COLS,
  };
}

function statusRule(status, format) {
  return {
    addConditionalFormatRule: {
      rule: {
        ranges: [fullRowRange()],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: `=$I2="${status}"` }],
          },
          format,
        },
      },
      index: 0,
    },
  };
}

async function sortByStatus() {
  console.log("  Sorting rows by status priority...");

  // Step 1: Write a numeric sort key into a helper column (col U = index 20)
  // sortRange API sorts safely without touching cell formatting, chips or links.
  const HELPER_COL = 20; // Column U (0-based), just past data

  const meta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Applications!I2:I1000`,
  });
  const statusValues = meta.data.values || [];
  if (statusValues.length === 0) {
    console.log("  No data rows found to sort.");
    return;
  }
  const numRows = statusValues.length;

  // Write sort keys to helper column U
  const sortKeys = statusValues.map(([status] = [""]) => {
    const rank = STATUS_ORDER.indexOf(status || "");
    return [rank === -1 ? 999 : rank];
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Applications!U2:U${1 + numRows}`,
    valueInputOption: "RAW",
    requestBody: { values: sortKeys },
  });

  // Step 2: sortRange — moves whole rows, preserves chips/links/formatting
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        sortRange: {
          range: {
            sheetId: SHEET_ID,
            startRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: HELPER_COL + 1,
          },
          sortSpecs: [
            {
              dimensionIndex: HELPER_COL,  // sort by helper col (custom order)
              sortOrder: "ASCENDING",
            },
            {
              dimensionIndex: RATING_COL_INDEX,  // secondary: rating descending
              sortOrder: "DESCENDING",
            },
          ],
        },
      }],
    },
  });

  // Step 3: Clear the helper column
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `Applications!U2:U${1 + numRows}`,
  });

  console.log(`  Sorted ${numRows} rows ✅`);
}

async function run() {
  console.log("🎨 Applying sheet formatting...\n");

  // 1. Clear existing conditional format rules
  const existing = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    includeGridData: false,
  });
  const sheet = existing.data.sheets.find(s => s.properties.sheetId === SHEET_ID);
  const existingRules = sheet?.conditionalFormats || [];
  if (existingRules.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: existingRules.map(() => ({
          deleteConditionalFormatRule: { sheetId: SHEET_ID, index: 0 },
        })),
      },
    });
    console.log(`  Cleared ${existingRules.length} existing conditional format rules`);
  }

  // 2. Clear stray data validation from all columns
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        setDataValidation: {
          range: {
            sheetId: SHEET_ID,
            startRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: TOTAL_COLS,
          },
        },
      }],
    },
  });
  console.log("  Cleared stray data validation");

  const requests = [
    // Background colours (added first = lower priority)
    ...Object.entries(STATUS_COLOURS).map(([status, colour]) =>
      statusRule(status, { backgroundColor: colour })
    ),

    // Paler font + background for Saved (combined into one rule)
    statusRule("Saved", {
      backgroundColor: { red: 0.99, green: 0.97, blue: 0.82 },
      textFormat: { foregroundColor: { red: 0.6, green: 0.6, blue: 0.6 } },
    }),

    // Strikethrough + background for Rejected & Withdrawn (highest priority)
    statusRule("Withdrawn", {
      backgroundColor: { red: 0.92, green: 0.92, blue: 0.92 },
      textFormat: {
        strikethrough: true,
        foregroundColor: { red: 0.6, green: 0.6, blue: 0.6 },
      },
    }),
    statusRule("Rejected", {
      backgroundColor: { red: 0.98, green: 0.87, blue: 0.87 },
      textFormat: {
        strikethrough: true,
        foregroundColor: { red: 0.6, green: 0.6, blue: 0.6 },
      },
    }),

    // Color scale on Rating column
    // NOTE: index is omitted here — this rule is added in a SEPARATE batchUpdate
    // after all booleanRules, so it ends up at index 0 (highest priority).
    // We use a placeholder here and handle it separately below.
    // -- handled in step 3 below --

    // Dropdown validation on Status column (I) only
    {
      setDataValidation: {
        range: {
          sheetId: SHEET_ID,
          startRowIndex: 1,
          startColumnIndex: STATUS_COL_INDEX,
          endColumnIndex: STATUS_COL_INDEX + 1,
        },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: VALID_STATUSES.map(s => ({ userEnteredValue: s })),
          },
          showCustomUi: true,
          strict: true,
        },
      },
    },
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests },
  });

  console.log("  Boolean formatting applied ✅");

  // 3. Re-write Rating column values as real numbers.
  //    The MCP tool writes ratings as strings ("8.5", "10") which means the Sheets
  //    gradient rule silently skips them — gradientRules only work on numeric cells.
  //    Reading and re-writing with valueInputOption USER_ENTERED forces Sheets to
  //    parse them as numbers in place.
  console.log("  Coercing Rating column to numbers...");
  const ratingRead = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Applications!H2:H1000`,
  });
  const ratingRows = ratingRead.data.values || [];
  if (ratingRows.length > 0) {
    const coerced = ratingRows.map(([v] = [""]) => {
      const n = parseFloat(v);
      return [isNaN(n) ? "" : n];
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Applications!H2:H${1 + ratingRows.length}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: coerced },
    });
    console.log(`  Coerced ${ratingRows.length} rating cells ✅`);
  }

  // 4. Gradient rule for Rating column — added in a SEPARATE batchUpdate so it
  //    gets index 0 (highest priority) and wins over the row-background booleanRules
  //    on the Rating cell only. Also uses colorStyle.rgbColor (not deprecated `color`).
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        addConditionalFormatRule: {
          rule: {
            ranges: [{
              sheetId: SHEET_ID,
              startRowIndex: 1,
              startColumnIndex: RATING_COL_INDEX,
              endColumnIndex: RATING_COL_INDEX + 1,
            }],
            gradientRule: {
              minpoint: {
                colorStyle: { rgbColor: { red: 0.96, green: 0.80, blue: 0.80 } },
                type: "NUMBER",
                value: "1",
              },
              midpoint: {
                colorStyle: { rgbColor: { red: 0.99, green: 0.97, blue: 0.82 } },
                type: "NUMBER",
                value: "5",
              },
              maxpoint: {
                colorStyle: { rgbColor: { red: 0.85, green: 0.94, blue: 0.85 } },
                type: "NUMBER",
                value: "10",
              },
            },
          },
          index: 0,
        },
      }],
    },
  });
  console.log("  Gradient rule applied to Rating column ✅");

  // 5. Sort rows by status priority
  await sortByStatus();

  console.log("\n✅ Done!");
  console.log("  • Background colours per status (whole row)");
  console.log("  • Strikethrough on Rejected & Withdrawn");
  console.log("  • Paler font on Saved");
  console.log("  • Color scale on Rating (H)");
  console.log("  • Dropdown on Status (I)");
  console.log("  • Sorted: Offer → Interview → Applied → Phone Screen → Saved → Rejected → Withdrawn");
  console.log("  • Secondary sort: Rating descending within each group");
}

run().catch(err => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});