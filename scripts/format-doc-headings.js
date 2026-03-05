/**
 * format-doc-headings.js
 *
 * Converts ASCII divider headings in a Google Doc into proper Heading styles,
 * and processes inline Markdown formatting within paragraph text.
 *
 * HEADING LEVEL MAPPING:
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   → deleted
 *   SECTION NAME (between two long ━━━ lines)   → HEADING_2  (major sections)
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   → deleted
 *
 *   ━━━━━━━━━━━━━━━━━━━━━━   → deleted
 *   SUBSECTION NAME           → HEADING_3  (between shorter ━━━ lines)
 *   ━━━━━━━━━━━━━━━━━━━━━━   → deleted
 *
 *   --- TOPIC NAME ---        → HEADING_4  (triple dash, topics within a sub-section)
 *   -- ITEM NAME --           → HEADING_5  (double dash, named items within a topic)
 *
 * TABLE STYLING:
 *   All tables     → dark header row + alternating row colours + subtle borders
 *
 * INLINE MARKDOWN FORMATTING:
 *   ***text*** or **_text_**  → bold + italic
 *   **text**                  → bold
 *   _text_ or *text*          → italic
 *   `text`                    → inline code (monospace + light background colour)
 *   ~~text~~                  → strikethrough
 *
 * Usage (run from inside the job-hunter repo):
 *   node scripts/format-doc-headings.js <docId>
 *
 * Example:
 *   node scripts/format-doc-headings.js 1HCpkACzu-kTVnRwf_GddXzxGyumtWQ360ABU7E2PSXw
 */

import { google } from "googleapis";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, "../config.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

const auth = new google.auth.GoogleAuth({
  keyFile: config.google_sheets.service_account_key_file,
  scopes: [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive",
  ],
});

const docs = google.docs({ version: "v1", auth });

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function paraText(el) {
  if (!el?.paragraph?.elements) return "";
  return el.paragraph.elements
    .map((e) => e.textRun?.content || "")
    .join("")
    .replace(/\n$/, "");
}

function isRule(text) {
  return /^━{10,}$/.test(text.trim());
}

function isDashHeading(text) {
  return /^[-—]{2} \S/.test(text) && / [-—]{2}$/.test(text) && !/^[-—]{3}/.test(text);
}

function isTripleDashHeading(text) {
  return /^[-—]{3} \S/.test(text) && / [-—]{3}$/.test(text);
}

// ─────────────────────────────────────────────
// HEADING DETECTION
// ─────────────────────────────────────────────

function findHeadings(body) {
  const found = [];
  for (let i = 0; i < body.length; i++) {
    const el = body[i];
    if (!el.paragraph) continue;
    const text = paraText(el);

    // Triple pattern: ━━━ / TEXT / ━━━
    if (isRule(text) && i + 2 < body.length) {
      const mid = body[i + 1];
      const after = body[i + 2];
      if (!mid?.paragraph || !after?.paragraph) continue;
      const midText = paraText(mid).trim();
      const afterText = paraText(after);
      if (isRule(afterText) && midText.length > 0) {
        const ruleLen = text.trim().length;
        const level = ruleLen >= 35 ? "HEADING_2" : "HEADING_3";
        found.push({ type: "triple", level, headingText: midText });
        i += 2;
        continue;
      }
    }

    // Inline: --- HEADING ---
    if (isTripleDashHeading(text)) {
      const headingText = text.replace(/^[-—]{3} /, "").replace(/ [-—]{3}$/, "");
      found.push({ type: "inline", level: "HEADING_4", headingText, originalText: text });
    }

    // Inline: -- HEADING --
    if (isDashHeading(text)) {
      const headingText = text.replace(/^[-—]{2} /, "").replace(/ [-—]{2}$/, "");
      found.push({ type: "inline", level: "HEADING_5", headingText, originalText: text });
    }
  }
  return found;
}

// ─────────────────────────────────────────────
// INLINE MARKDOWN DETECTION
// ─────────────────────────────────────────────

/**
 * Parse a plain text string into segments with formatting info.
 * Returns array of: { text, bold, italic, code, strikethrough }
 *
 * Order of precedence (most specific first):
 *   ***text***  → bold + italic
 *   **text**    → bold
 *   _text_      → italic
 *   *text*      → italic  (single asterisk, not double)
 *   `text`      → code
 *   ~~text~~    → strikethrough
 */
function parseInlineMarkdown(text) {
  // Token regex — order matters: longer patterns first
  const TOKEN = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|_(.+?)_|\*(.+?)\*|`(.+?)`|~~(.+?)~~)/g;

  const segments = [];
  let last = 0;
  let match;

  while ((match = TOKEN.exec(text)) !== null) {
    // Plain text before this match
    if (match.index > last) {
      segments.push({ text: text.slice(last, match.index), bold: false, italic: false, code: false, strikethrough: false });
    }

    const full = match[0];
    if (full.startsWith("***")) {
      segments.push({ text: match[2], bold: true, italic: true, code: false, strikethrough: false });
    } else if (full.startsWith("**")) {
      segments.push({ text: match[3], bold: true, italic: false, code: false, strikethrough: false });
    } else if (full.startsWith("_")) {
      segments.push({ text: match[4], bold: false, italic: true, code: false, strikethrough: false });
    } else if (full.startsWith("*")) {
      segments.push({ text: match[5], bold: false, italic: true, code: false, strikethrough: false });
    } else if (full.startsWith("`")) {
      segments.push({ text: match[6], bold: false, italic: false, code: true, strikethrough: false });
    } else if (full.startsWith("~~")) {
      segments.push({ text: match[7], bold: false, italic: false, code: false, strikethrough: true });
    }

    last = match.index + full.length;
  }

  // Remaining plain text
  if (last < text.length) {
    segments.push({ text: text.slice(last), bold: false, italic: false, code: false, strikethrough: false });
  }

  return segments;
}

function hasMarkdown(text) {
  return /(\*\*\*|\*\*|(?<!\*)\*(?!\*)|_[^_]+_|`[^`]+`|~~)/.test(text);
}

/**
 * Find all paragraphs that contain inline markdown and need processing.
 * Returns { paragraphIndex, startIndex, endIndex, fullText, segments }
 */
function findInlineMarkdown(body) {
  const found = [];
  for (const el of body) {
    if (!el.paragraph) continue;
    const text = paraText(el);
    if (!hasMarkdown(text)) continue;
    const segments = parseInlineMarkdown(text);
    // Only include if at least one segment has formatting
    if (segments.some((s) => s.bold || s.italic || s.code || s.strikethrough)) {
      found.push({
        startIndex: el.startIndex,
        endIndex: el.endIndex,
        fullText: text,
        segments,
      });
    }
  }
  return found;
}

// ─────────────────────────────────────────────
// HEADING PROCESSORS
// ─────────────────────────────────────────────

async function processTriple(docId, headingText, level) {
  const res = await docs.documents.get({ documentId: docId });
  const body = res.data.body.content;

  for (let i = 0; i < body.length; i++) {
    const text = paraText(body[i]);
    if (!isRule(text)) continue;
    if (i + 2 >= body.length) continue;
    const midText = paraText(body[i + 1]).trim();
    const afterText = paraText(body[i + 2]);
    if (midText !== headingText || !isRule(afterText)) continue;

    const ruleBefore = body[i];
    const heading = body[i + 1];
    const ruleAfter = body[i + 2];

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            updateParagraphStyle: {
              range: { startIndex: heading.startIndex, endIndex: heading.endIndex - 1 },
              paragraphStyle: { namedStyleType: level },
              fields: "namedStyleType",
            },
          },
          {
            deleteContentRange: {
              range: { startIndex: ruleAfter.startIndex, endIndex: ruleAfter.endIndex },
            },
          },
          {
            deleteContentRange: {
              range: { startIndex: ruleBefore.startIndex, endIndex: ruleBefore.endIndex },
            },
          },
        ],
      },
    });
    return true;
  }
  return false;
}

async function processInline(docId, headingText, originalText, level) {
  const res = await docs.documents.get({ documentId: docId });
  const body = res.data.body.content;

  for (const el of body) {
    if (!el.paragraph) continue;
    const text = paraText(el);
    if (!isDashHeading(text) && !isTripleDashHeading(text)) continue;

    const parsed = isTripleDashHeading(text)
      ? text.replace(/^[-—]{3} /, "").replace(/ [-—]{3}$/, "")
      : text.replace(/^[-—]{2} /, "").replace(/ [-—]{2}$/, "");

    if (parsed !== headingText) continue;

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            updateParagraphStyle: {
              range: { startIndex: el.startIndex, endIndex: el.endIndex - 1 },
              paragraphStyle: { namedStyleType: level },
              fields: "namedStyleType",
            },
          },
          {
            insertText: {
              location: { index: el.startIndex },
              text: headingText,
            },
          },
        ],
      },
    });

    const res2 = await docs.documents.get({ documentId: docId });
    for (const el2 of res2.data.body.content) {
      if (!el2.paragraph) continue;
      const t2 = paraText(el2);
      if (t2 === headingText + originalText) {
        await docs.documents.batchUpdate({
          documentId: docId,
          requestBody: {
            requests: [
              {
                deleteContentRange: {
                  range: {
                    startIndex: el2.startIndex + headingText.length,
                    endIndex: el2.endIndex - 1,
                  },
                },
              },
            ],
          },
        });
        break;
      }
    }
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────
// INLINE MARKDOWN PROCESSOR
// ─────────────────────────────────────────────

/**
 * Process a single paragraph: replace its content with properly formatted runs.
 *
 * Strategy:
 *   1. Delete the entire paragraph content (keep the newline).
 *   2. Insert plain text for each segment from the end backwards
 *      (so indices stay valid).
 *   3. Apply text style (bold/italic/code/strikethrough) to each segment.
 *
 * We process from the end to avoid index shifting.
 */
async function processMarkdownParagraph(docId, paraInfo) {
  const { startIndex, endIndex, fullText, segments } = paraInfo;

  // Step 1: delete existing paragraph content (not the trailing \n)
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          deleteContentRange: {
            range: { startIndex, endIndex: endIndex - 1 },
          },
        },
      ],
    },
  });

  // Step 2: insert segments from last to first (to keep index stable at startIndex)
  // We insert all at startIndex in reverse order so final order is correct.
  for (let i = segments.length - 1; i >= 0; i--) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: startIndex },
              text: segments[i].text,
            },
          },
        ],
      },
    });
  }

  // Step 3: apply text styles — re-fetch to get correct indices
  const res = await docs.documents.get({ documentId: docId });
  const body = res.data.body.content;

  // Find the paragraph at startIndex
  const para = body.find((el) => el.paragraph && el.startIndex === startIndex);
  if (!para) return;

  // Walk segments and build style requests
  const requests = [];
  let cursor = startIndex;

  for (const seg of segments) {
    const segStart = cursor;
    const segEnd = cursor + seg.text.length;
    cursor = segEnd;

    if (!seg.bold && !seg.italic && !seg.code && !seg.strikethrough) continue;

    const textStyle = {};
    const fields = [];

    if (seg.bold) { textStyle.bold = true; fields.push("bold"); }
    if (seg.italic) { textStyle.italic = true; fields.push("italic"); }
    if (seg.strikethrough) { textStyle.strikethrough = true; fields.push("strikethrough"); }
    if (seg.code) {
      // Monospace font + light grey background for inline code
      textStyle.weightedFontFamily = { fontFamily: "Courier New", weight: 400 };
      textStyle.backgroundColor = { color: { rgbColor: { red: 0.95, green: 0.95, blue: 0.95 } } };
      fields.push("weightedFontFamily", "backgroundColor");
    }

    requests.push({
      updateTextStyle: {
        range: { startIndex: segStart, endIndex: segEnd },
        textStyle,
        fields: fields.join(","),
      },
    });
  }

  if (requests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests },
    });
  }
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────


// ─────────────────────────────────────────────
// MARKDOWN TABLE CONVERSION + STYLING
// ─────────────────────────────────────────────

// Colours — Cleo palette
const TABLE_HEADER_BG  = { red: 0.278, green: 0.125, blue: 0.110 }; // #47201C
const TABLE_HEADER_FG  = { red: 1,     green: 1,     blue: 1     }; // #ffffff
const TABLE_ROW_ALT_BG = { red: 0.973, green: 0.965, blue: 0.957 }; // #F8F6F2
const TABLE_BORDER_CLR = { red: 0.941, green: 0.929, blue: 0.918 }; // #F0EDEA

/**
 * Parse a markdown table pipe row into cell text values.
 * "| foo | bar | baz |" → ["foo", "bar", "baz"]
 */
function parsePipeRow(text) {
  return text
    .split("|")
    .map((s) => s.trim())
    .filter((_, i, arr) => i > 0 && i < arr.length - 1); // drop empty first/last
}

function isSeparatorRow(text) {
  // |---|---| or |:---|:---:| etc.
  return /^\|[-| :]+\|$/.test(text.trim());
}

function isPipeRow(text) {
  const t = text.trim();
  return t.startsWith("|") && t.endsWith("|") && !isSeparatorRow(t);
}

/**
 * Scan body for groups of consecutive pipe-row paragraphs that form a markdown table.
 * Returns array of { startIndex, endIndex, headerCells, dataRows }
 * where startIndex/endIndex cover all the paragraphs to delete.
 */
function findMarkdownTables(body) {
  const tables = [];
  let i = 0;

  while (i < body.length) {
    const el = body[i];
    if (!el.paragraph) { i++; continue; }

    const text = paraText(el);
    if (!isPipeRow(text)) { i++; continue; }

    // Collect consecutive pipe rows
    const group = [];
    let j = i;
    while (j < body.length) {
      const el2 = body[j];
      if (!el2.paragraph) break;
      const t2 = paraText(el2);
      if (!isPipeRow(t2) && !isSeparatorRow(t2)) break;
      group.push({ el: el2, text: t2, isSep: isSeparatorRow(t2) });
      j++;
    }

    // Need at least header + separator + 1 data row
    const sepIdx = group.findIndex((r) => r.isSep);
    if (sepIdx === 1 && group.length >= 3) {
      const headerCells = parsePipeRow(group[0].text);
      const dataRows = group
        .slice(sepIdx + 1)
        .filter((r) => !r.isSep)
        .map((r) => parsePipeRow(r.text));

      const firstEl = group[0].el;
      const lastEl  = group[group.length - 1].el;

      tables.push({
        startIndex: firstEl.startIndex,
        endIndex:   lastEl.endIndex,
        headerCells,
        dataRows,
        numRows: group.length,
      });
    }

    i = j;
  }

  return tables;
}

/**
 * Convert a single markdown table to a real Google Docs table with styling.
 *
 * Strategy:
 *   1. Delete all the pipe-row paragraphs.
 *   2. Insert a real table at that position.
 *   3. Fill each cell.
 *   4. Apply header + alternating row styling.
 */
async function convertMarkdownTable(docId, tableInfo) {
  const { startIndex, endIndex, headerCells, dataRows } = tableInfo;
  const numCols = headerCells.length;
  const numRows = 1 + dataRows.length; // header + data

  // Step 1: delete the markdown text (keep trailing newline of last para)
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [{
        deleteContentRange: {
          range: { startIndex, endIndex: endIndex - 1 },
        },
      }],
    },
  });

  // Step 2: insert real table at startIndex
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [{
        insertTable: {
          rows: numRows,
          columns: numCols,
          location: { index: startIndex },
        },
      }],
    },
  });

  // Step 3: re-fetch to get the new table's cell indices
  const res = await docs.documents.get({ documentId: docId });
  const body = res.data.body.content;

  // Find the newly inserted table (first table at or after startIndex)
  let tableEl = null;
  for (const el of body) {
    if (el.table && el.startIndex >= startIndex) {
      tableEl = el;
      break;
    }
  }
  if (!tableEl) throw new Error("Could not find inserted table");

  // Step 4: fill cells — build all insert + style requests
  const allRows = [headerCells, ...dataRows];
  const insertRequests = [];
  const styleRequests = [];

  for (let r = 0; r < tableEl.table.tableRows.length; r++) {
    const row = tableEl.table.tableRows[r];
    const isHeader = r === 0;
    const isAlt    = !isHeader && r % 2 === 0;

    const bgColor = isHeader ? TABLE_HEADER_BG
                  : isAlt    ? TABLE_ROW_ALT_BG
                             : { red: 1, green: 1, blue: 1 };

    for (let c = 0; c < row.tableCells.length; c++) {
      const cell     = row.tableCells[c];
      const cellText = (allRows[r] && allRows[r][c]) ? allRows[r][c] : "";

      // The cell has one empty paragraph — insert text at its start
      const cellContentStart = cell.content[0].startIndex;

      if (cellText) {
        insertRequests.push({
          insertText: {
            location: { index: cellContentStart },
            text: cellText,
          },
        });
      }

      // Cell background + borders
      styleRequests.push({
        updateTableCellStyle: {
          tableRange: {
            tableCellLocation: {
              tableStartLocation: { index: tableEl.startIndex },
              rowIndex: r,
              columnIndex: c,
            },
            rowSpan: 1,
            columnSpan: 1,
          },
          tableCellStyle: {
            backgroundColor: { color: { rgbColor: bgColor } },
            borderLeft:   { color: { color: { rgbColor: TABLE_BORDER_CLR } }, width: { magnitude: 1, unit: "PT" }, dashStyle: "SOLID" },
            borderRight:  { color: { color: { rgbColor: TABLE_BORDER_CLR } }, width: { magnitude: 1, unit: "PT" }, dashStyle: "SOLID" },
            borderTop:    { color: { color: { rgbColor: TABLE_BORDER_CLR } }, width: { magnitude: 1, unit: "PT" }, dashStyle: "SOLID" },
            borderBottom: { color: { color: { rgbColor: TABLE_BORDER_CLR } }, width: { magnitude: 1, unit: "PT" }, dashStyle: "SOLID" },
          },
          fields: "backgroundColor,borderLeft,borderRight,borderTop,borderBottom",
        },
      });
    }
  }

  // Insert all text — must be done in reverse order to preserve indices
  const reversedInserts = [...insertRequests].reverse();
  const BATCH = 20;
  for (let i = 0; i < reversedInserts.length; i += BATCH) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: reversedInserts.slice(i, i + BATCH) },
    });
  }

  // Apply cell styles
  for (let i = 0; i < styleRequests.length; i += BATCH) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: styleRequests.slice(i, i + BATCH) },
    });
  }

  // Apply bold + white text to header row
  // Re-fetch once more to get correct text indices after inserts
  const res2 = await docs.documents.get({ documentId: docId });
  const tableEl2 = res2.data.body.content.find(
    (el) => el.table && el.startIndex >= startIndex
  );
  if (!tableEl2) return;

  const headerTextRequests = [];
  const headerRow = tableEl2.table.tableRows[0];
  for (const cell of headerRow.tableCells) {
    for (const paraEl of cell.content || []) {
      if (!paraEl.paragraph) continue;
      for (const elem of paraEl.paragraph.elements || []) {
        if (!elem.textRun || elem.startIndex === elem.endIndex) continue;
        headerTextRequests.push({
          updateTextStyle: {
            range: { startIndex: elem.startIndex, endIndex: elem.endIndex },
            textStyle: {
              bold: true,
              foregroundColor: { color: { rgbColor: TABLE_HEADER_FG } },
            },
            fields: "bold,foregroundColor",
          },
        });
      }
    }
  }

  if (headerTextRequests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: headerTextRequests },
    });
  }
}


async function reformatDoc(docId) {
  console.log(`\n📄 Fetching doc: ${docId}`);
  let res = await docs.documents.get({ documentId: docId });

  // ── 1. Headings ──────────────────────────────
  const headings = findHeadings(res.data.body.content);

  if (headings.length === 0) {
    console.log("  ✅ No ASCII headings found.");
  } else {
    console.log(`\n🔖 Found ${headings.length} heading(s) to reformat:`);
    headings.forEach((h) => console.log(`  [${h.level}] ${h.headingText}`));
    console.log("");

    for (const h of headings) {
      process.stdout.write(`  Formatting [${h.level}] "${h.headingText}"... `);
      try {
        let ok;
        if (h.type === "triple") {
          ok = await processTriple(docId, h.headingText, h.level);
        } else {
          ok = await processInline(docId, h.headingText, h.originalText, h.level);
        }
        console.log(ok ? "✅" : "⚠️  not found");
      } catch (err) {
        console.log(`❌ ${err.message}`);
      }
    }
  }

  // ── 2. Inline markdown ───────────────────────
  // Re-fetch after heading changes (indices may have shifted)
  res = await docs.documents.get({ documentId: docId });
  const markdownParas = findInlineMarkdown(res.data.body.content);

  if (markdownParas.length === 0) {
    console.log("  ✅ No inline markdown found.");
  } else {
    console.log(`\n✍️  Found ${markdownParas.length} paragraph(s) with inline markdown:`);
    markdownParas.forEach((p) => {
      const preview = p.fullText.length > 60 ? p.fullText.slice(0, 60) + "…" : p.fullText;
      console.log(`  "${preview}"`);
    });
    console.log("");

    // Process from bottom to top so indices stay valid
    const sorted = [...markdownParas].sort((a, b) => b.startIndex - a.startIndex);

    for (const para of sorted) {
      const preview = para.fullText.length > 50 ? para.fullText.slice(0, 50) + "…" : para.fullText;
      process.stdout.write(`  Formatting "${preview}"... `);
      try {
        await processMarkdownParagraph(docId, para);
        console.log("✅");
      } catch (err) {
        console.log(`❌ ${err.message}`);
      }
    }
  }


  // ── 3. Markdown tables → real Google Docs tables ──
  // Re-fetch after markdown changes (indices may have shifted)
  res = await docs.documents.get({ documentId: docId });
  const mdTables = findMarkdownTables(res.data.body.content);

  if (mdTables.length === 0) {
    console.log("  ✅ No markdown tables found.");
  } else {
    console.log(`\n📊 Found ${mdTables.length} markdown table(s) to convert:`);
    console.log("");

    // Process bottom-to-top so indices stay valid after deletions
    const sorted = [...mdTables].sort((a, b) => b.startIndex - a.startIndex);

    for (const t of sorted) {
      process.stdout.write(`  Converting table (${1 + t.dataRows.length} rows × ${t.headerCells.length} cols): "${t.headerCells.join(" | ")}"... `);
      try {
        await convertMarkdownTable(docId, t);
        console.log("✅");
        // Re-fetch between tables so indices are always fresh
        res = await docs.documents.get({ documentId: docId });
      } catch (err) {
        console.log(`❌ ${err.message}`);
      }
    }
  }

  console.log(`\n✅ Done!`);
  console.log(`   https://docs.google.com/document/d/${docId}/edit\n`);
}

const docId = process.argv[2];
if (!docId) {
  console.error("\nUsage: node scripts/format-doc-headings.js <docId>\n");
  console.error("Example:");
  console.error("  node scripts/format-doc-headings.js 1HCpkACzu-kTVnRwf_GddXzxGyumtWQ360ABU7E2PSXw\n");
  process.exit(1);
}

reformatDoc(docId).catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});