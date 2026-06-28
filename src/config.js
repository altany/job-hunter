import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.JOB_HUNTER_CONFIG || path.join(__dirname, "../config.json");

/**
 * Load configuration from one of two sources, in priority order:
 *
 *   1. Environment (for hosted / remote deploys — no files on disk):
 *      - JOB_HUNTER_CONFIG_JSON      full config object as a JSON string
 *      - GOOGLE_SERVICE_ACCOUNT_JSON the service-account key as a JSON string
 *      - SPREADSHEET_ID              overrides google_sheets.spreadsheet_id
 *      - CV_FILE_PATH                overrides cv_file_path
 *
 *   2. A local config.json file (for stdio / desktop use — exactly as before).
 *
 * Secrets are NEVER read from source — only from the environment or a
 * gitignored config.json. See config.example.json for the shape.
 */
export function loadConfig() {
  let config = {};

  if (process.env.JOB_HUNTER_CONFIG_JSON) {
    try {
      config = JSON.parse(process.env.JOB_HUNTER_CONFIG_JSON);
    } catch (e) {
      throw new Error(`JOB_HUNTER_CONFIG_JSON is not valid JSON: ${e.message}`);
    }
  } else if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } else {
    throw new Error(
      `No configuration found. Either set JOB_HUNTER_CONFIG_JSON (hosted) ` +
        `or copy config.example.json to config.json (local). Looked at: ${CONFIG_PATH}`
    );
  }

  config.google_sheets = config.google_sheets || {};

  // Environment overrides — let a hosted deploy inject secrets without a file.
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      config.google_sheets.service_account_json = JSON.parse(
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON
      );
    } catch (e) {
      throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${e.message}`);
    }
  }
  if (process.env.SPREADSHEET_ID) {
    config.google_sheets.spreadsheet_id = process.env.SPREADSHEET_ID;
  }
  if (process.env.CV_FILE_PATH) {
    config.cv_file_path = process.env.CV_FILE_PATH;
  }

  return config;
}
