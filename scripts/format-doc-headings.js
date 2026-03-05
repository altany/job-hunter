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