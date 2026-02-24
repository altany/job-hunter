/**
 * format-doc-headings.js
 *
 * Converts ASCII divider headings in a Google Doc into proper Heading styles
 * so the document outline and pageless mode work correctly.
 *
 * Heading level mapping:
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
  // Matches exactly 2 dash-like chars (- or —) as delimiter, not 3
  return /^[-—]{2} \S/.test(text) && / [-—]{2}$/.test(text) && !/^[-—]{3}/.test(text);
}

function isTripleDashHeading(text) {
  // Matches exactly 3 dash-like chars (- or —) as delimiter
  return /^[-—]{3} \S/.test(text) && / [-—]{3}$/.test(text);
}

// Scan body for all heading patterns, return list of what to change
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

    // Inline: --- HEADING --- (triple dash → HEADING_4)
    if (isTripleDashHeading(text)) {
      const headingText = text.replace(/^[-—]{3} /, "").replace(/ [-—]{3}$/, "");
      found.push({ type: "inline", level: "HEADING_4", headingText, originalText: text });
    }

    // Inline: -- HEADING -- (double dash → HEADING_5)
    if (isDashHeading(text)) {
      const headingText = text.replace(/^[-—]{2} /, "").replace(/ [-—]{2}$/, "");
      found.push({ type: "inline", level: "HEADING_5", headingText, originalText: text });
    }
  }
  return found;
}

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

    // FIX: use the correct stripping regex based on which pattern matched
    const parsed = isTripleDashHeading(text)
      ? text.replace(/^[-—]{3} /, "").replace(/ [-—]{3}$/, "")
      : text.replace(/^[-—]{2} /, "").replace(/ [-—]{2}$/, "");

    if (parsed !== headingText) continue;

    // Insert clean heading text, apply the correct style, then delete original text
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            updateParagraphStyle: {
              range: { startIndex: el.startIndex, endIndex: el.endIndex - 1 },
              paragraphStyle: { namedStyleType: level }, // FIX: use passed-in level, not hardcoded HEADING_4
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

    // Re-fetch and delete the old text (now after the inserted heading text)
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

async function reformatDoc(docId) {
  console.log(`\n📄 Fetching doc: ${docId}`);
  const res = await docs.documents.get({ documentId: docId });
  const headings = findHeadings(res.data.body.content);

  if (headings.length === 0) {
    console.log("✅ No ASCII headings found — doc may already be formatted.");
    return;
  }

  console.log(`\nFound ${headings.length} headings to reformat:`);
  headings.forEach((h) => console.log(`  [${h.level}] ${h.headingText}`));
  console.log("");

  for (const h of headings) {
    process.stdout.write(`  Formatting [${h.level}] "${h.headingText}"... `);
    try {
      let ok;
      if (h.type === "triple") {
        ok = await processTriple(docId, h.headingText, h.level);
      } else {
        ok = await processInline(docId, h.headingText, h.originalText, h.level); // FIX: pass h.level
      }
      console.log(ok ? "✅" : "⚠️  not found");
    } catch (err) {
      console.log(`❌ ${err.message}`);
    }
  }

  console.log(`\n✅ Done!`);
  console.log(`   https://docs.google.com/document/d/${docId}/edit`);
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