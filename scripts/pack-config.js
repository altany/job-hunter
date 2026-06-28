#!/usr/bin/env node
/**
 * pack-config — bundle local config + CV + context into the single JSON blob
 * that the hosted (HTTP) server reads from JOB_HUNTER_CONFIG_JSON.
 *
 * It reads config.json + the CV file + context/*.md from disk, inlines the CV
 * (`cv_text`) and context (`context_text`), and strips the local-only key-file
 * path (the service-account key is its own secret on the host). The result is
 * printed to stdout as minified JSON.
 *
 * Usage:
 *   npm run pack-config | pbcopy     # copy, then paste into Render's
 *                                    # JOB_HUNTER_CONFIG_JSON env var
 *   npm run pack-config > blob.json  # or save to a (gitignored) file
 *
 * The service-account key (GOOGLE_SERVICE_ACCOUNT_JSON) and MCP_AUTH_TOKEN are
 * separate env vars and are NOT included here.
 */
import { loadConfig } from "../src/config.js";
import { loadCV } from "../src/cv.js";
import { loadContextFiles } from "../src/createServer.js";

const config = loadConfig();
const { cvText } = await loadCV(config);
const contextText = loadContextFiles(config);

const hosted = {
  ...config,
  google_sheets: { ...config.google_sheets },
  cv_text: cvText,
  context_text: contextText,
};
delete hosted.cv_file_path; // CV is inlined as cv_text
delete hosted.google_sheets.service_account_key_file; // key comes from its own secret

process.stdout.write(JSON.stringify(hosted));

// A short summary to stderr so it doesn't pollute the piped stdout.
process.stderr.write(
  `\n[pack-config] cv_text ${cvText.length} chars · context_text ${contextText.length} chars · ` +
    `${(JSON.stringify(hosted).length / 1024).toFixed(1)} KB total\n`
);
