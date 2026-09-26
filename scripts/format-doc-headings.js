/**
 * format-doc-headings.js
 *
 * CLI wrapper around src/docFormatter.js. Formats a Google Doc: ASCII / markdown
 * headings → Heading styles, inline markdown → bold/italic/code, bullets,
 * horizontal rules, code blocks and markdown tables. See src/docFormatter.js
 * for the full markup mapping.
 *
 * The server runs the same formatter automatically after every doc write, so
 * you only need this for docs edited by hand.
 *
 * Usage (run from inside the job-hunter repo):
 *   node scripts/format-doc-headings.js <docId>
 *
 * Example:
 *   node scripts/format-doc-headings.js 1HCpkACzu-kTVnRwf_GddXzxGyumtWQ360ABU7E2PSXw
 */

import { loadConfig } from "../src/config.js";
import { GoogleSheetsClient } from "../src/sheets.js";
import { createFormatter } from "../src/docFormatter.js";

const docId = process.argv[2];
if (!docId) {
  console.error("\nUsage: node scripts/format-doc-headings.js <docId>\n");
  console.error("Example:");
  console.error("  node scripts/format-doc-headings.js 1HCpkACzu-kTVnRwf_GddXzxGyumtWQ360ABU7E2PSXw\n");
  process.exit(1);
}

const client = new GoogleSheetsClient(loadConfig());
const formatDoc = createFormatter(client.docs, (msg) => process.stdout.write(msg));

formatDoc(docId)
  .then(({ errors }) => process.exit(errors.length ? 1 : 0))
  .catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
