import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleSheetsClient } from "./sheets.js";
import { loadCV, loadPreferences } from "./cv.js";
import { loadConfig } from "./config.js";
import { tools, toolsByName } from "./tools/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadContextFiles(config = {}) {
  // Hosted deploys supply the context inline (config.context_text) since the
  // gitignored context/ folder isn't shipped to the server. Local stdio use
  // keeps reading context/*.md from disk.
  if (config.context_text && config.context_text.trim()) {
    return config.context_text;
  }

  const contextDir = path.join(__dirname, "../context");
  if (!fs.existsSync(contextDir)) return "";

  const files = fs.readdirSync(contextDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (files.length === 0) return "";

  const sections = files.map((file) => {
    const title = file.replace(/\.md$/, "").replace(/[-_]/g, " ");
    const content = fs.readFileSync(path.join(contextDir, file), "utf8").trim();
    return `### ${title}\n${content}`;
  });

  return `## Additional Context\n${sections.join("\n\n")}`;
}

const INSTRUCTIONS = `
This server is a personal job-search tracker backed by Google Sheets (one row per application) and, optionally, one Google Doc per application for long-form notes.

Typical flow: rate_job (research + score a role) → add_application (save it) → update_application (keep it current as it progresses) → create_application_doc / get_application_doc / update_application_doc (long-form notes) → prep_interview (before a call).

Rules that avoid the common mistakes:
- To change ANYTHING about an application that is already in the tracker — status, rating, notes, next step, salary, work type, location, or a linked doc — use update_application. Do NOT use add_application for a company that already exists; that creates a duplicate row. add_application is only for a company/role not yet tracked.
- Applications are matched leniently by company + role. If update_application says it can't find the row, call get_applications to see the exact company/role text, then retry with that (or use delete_application to remove a duplicate).
- Each application can have one linked Google Doc for long-form notes. Use create_application_doc to make one (it's created automatically, owned by the user), get_application_doc to read it, and update_application_doc to append a section (it auto-creates the doc if none is linked yet). The user can also paste an existing doc's link as doc_url. There is one doc per application — the tools won't create a duplicate if one is already linked. (If doc creation ever errors that OAuth isn't set up, the user needs to run 'npm run auth' once; a service account alone can't create Docs.)
- rate_job, tailor_cv, generate_cover_letter and prep_interview return an instruction prompt for you to carry out. They already include the user's CV, preferences and background, so don't ask the user for those.
- Notes are appended, never overwritten. Statuses: Saved, Applied, Phone Screen, Interview, Offer, Rejected, Withdrawn.
`.trim();

export function createServer() {
  const server = new Server(
    { name: "job-hunter", version: "1.0.0" },
    { capabilities: { tools: { listChanged: true } }, instructions: INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => t.definition),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const config = loadConfig();
    const sheets = new GoogleSheetsClient(config);
    const { cvText } = await loadCV(config);
    const preferences = loadPreferences(config);
    const contextFiles = loadContextFiles(config);

    const { name, arguments: args } = request.params;
    const tool = toolsByName[name];

    if (!tool) {
      return {
        content: [{ type: "text", text: `❌ Error: Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      return await tool.handler(args, { config, sheets, cvText, preferences, contextFiles });
    } catch (err) {
      return {
        content: [{ type: "text", text: `❌ Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  return server;
}
