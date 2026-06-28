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

export function createServer() {
  const server = new Server(
    { name: "job-hunter", version: "1.0.0" },
    { capabilities: { tools: { listChanged: true } } }
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
